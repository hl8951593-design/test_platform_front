import { requestEventStreamWithAuth } from "./client";
import type { AgentRunEvent } from "../types/agents";

type BackendRecord = Record<string, unknown>;

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

export async function subscribeAgentRunEvents(
  runId: string,
  onEvent: (event: AgentRunEvent) => void,
  options: { lastEventId?: number; signal?: AbortSignal } = {},
) {
  const headers = new Headers();
  if (options.lastEventId !== undefined) headers.set("Last-Event-ID", String(options.lastEventId));
  const response = await requestEventStreamWithAuth(`/agents/runs/${runId}/events`, {
    headers,
    signal: options.signal,
  });
  const reader = response.body!.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split(/\n\n|\r\n\r\n/);
    buffer = chunks.pop() ?? "";
    chunks.forEach((chunk) => {
      const event = parseAgentSseChunk(chunk);
      if (event) onEvent(event);
    });
  }

  buffer += decoder.decode();
  const event = buffer.trim() ? parseAgentSseChunk(buffer) : undefined;
  if (event) onEvent(event);
}
