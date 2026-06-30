import { requestEventStreamWithAuth } from "./client";
import { requestWithAuth } from "./client";
import type { AgentRunEvent, AgentRunEventSnapshot } from "../types/agents";

type BackendRecord = Record<string, unknown>;
export interface AgentRunEventStreamResult {
  eventCount: number;
  heartbeatCount: number;
}

function asRecord(value: unknown): BackendRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as BackendRecord : {};
}

function optionalString(value: unknown) {
  return value === undefined || value === null ? undefined : String(value);
}

function optionalNumber(value: unknown) {
  const next = Number(value);
  return Number.isFinite(next) ? next : undefined;
}

function mapEvent(value: unknown): AgentRunEvent {
  const source = asRecord(value);
  return {
    id: optionalString(source.id),
    sequence: optionalNumber(source.event_seq ?? source.sequence),
    runId: optionalString(source.run_id ?? source.runId),
    event: String(source.event_type ?? source.event ?? source.type ?? "message"),
    payload: asRecord(source.payload_json ?? source.payload ?? source.data),
    createdAt: optionalString(source.created_at ?? source.createdAt),
  };
}

function mapEventSnapshot(value: unknown): AgentRunEventSnapshot {
  const source = asRecord(value);
  return {
    events: Array.isArray(source.events) ? source.events.map(mapEvent) : [],
    nextAfterSequence: optionalNumber(source.next_after_sequence ?? source.nextAfterSequence),
    terminal: Boolean(source.terminal ?? false),
  };
}

export function parseAgentSseChunk(chunk: string): AgentRunEvent | undefined {
  let id: string | undefined;
  let event = "message";
  const dataLines: string[] = [];

  for (const rawLine of chunk.replace(/\r\n/g, "\n").split("\n")) {
    const line = rawLine.trimEnd();
    if (!line || line.startsWith(":")) continue;
    if (line.startsWith("id:")) id = line.slice(3).trim();
    if (line.startsWith("event:")) event = line.slice(6).trim();
    if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
  }

  if (event === "heartbeat") return undefined;
  if (!dataLines.length && event === "message") return undefined;

  const data = dataLines.join("\n");
  const rawPayload = data ? JSON.parse(data) : {};
  const recordPayload = asRecord(rawPayload);
  if ((event === "message" || event === "") && (recordPayload.event_type !== undefined || recordPayload.event !== undefined || recordPayload.type !== undefined)) {
    return mapEvent({
      ...recordPayload,
      id: recordPayload.id ?? id,
      event_seq: recordPayload.event_seq ?? recordPayload.sequence ?? (id === undefined ? undefined : Number(id)),
    });
  }

  return {
    id,
    sequence: id === undefined ? undefined : Number(id),
    event,
    payload: asRecord(recordPayload.payload_json ?? recordPayload.payload ?? recordPayload.data ?? recordPayload),
  };
}

export function isAgentHeartbeatSseChunk(chunk: string) {
  let event = "message";
  let hasData = false;

  for (const rawLine of chunk.replace(/\r\n/g, "\n").split("\n")) {
    const line = rawLine.trimEnd();
    if (!line) continue;
    if (line.startsWith(":")) return true;
    if (line.startsWith("event:")) event = line.slice(6).trim();
    if (line.startsWith("data:")) hasData = true;
  }

  return event === "heartbeat" || (!hasData && event === "message");
}

export async function getAgentRunEventSnapshot(runId: string, afterSequence?: number) {
  const query = afterSequence === undefined ? "" : `?after_sequence=${encodeURIComponent(String(afterSequence))}`;
  const result = await requestWithAuth<BackendRecord>(`/agents/runs/${runId}/events/snapshot${query}`);
  return mapEventSnapshot(result);
}

export async function subscribeAgentRunEvents(
  runId: string,
  onEvent: (event: AgentRunEvent) => void,
  options: { lastEventId?: number; signal?: AbortSignal } = {},
): Promise<AgentRunEventStreamResult> {
  const headers = new Headers();
  if (options.lastEventId !== undefined) headers.set("Last-Event-ID", String(options.lastEventId));
  const response = await requestEventStreamWithAuth(`/agents/runs/${runId}/events`, {
    headers,
    signal: options.signal,
  });
  const reader = response.body!.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let eventCount = 0;
  let heartbeatCount = 0;

  const consumeChunk = (chunk: string) => {
    if (isAgentHeartbeatSseChunk(chunk)) {
      heartbeatCount += 1;
      return;
    }
    const event = parseAgentSseChunk(chunk);
    if (event) {
      eventCount += 1;
      onEvent(event);
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split(/\n\n|\r\n\r\n/);
    buffer = chunks.pop() ?? "";
    chunks.forEach(consumeChunk);
  }

  buffer += decoder.decode();
  if (buffer.trim()) consumeChunk(buffer);
  return { eventCount, heartbeatCount };
}
