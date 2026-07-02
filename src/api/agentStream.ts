import { requestEventStreamWithAuth } from "./client";
import { requestWithAuth } from "./client";
import type { AgentContextCompaction, AgentRunEvent, AgentRunEventSnapshot, AgentRunSnapshot } from "../types/agents";

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
  const payload = asRecord(source.payload_json ?? source.payload ?? source.data);
  return {
    id: optionalString(source.id),
    itemId: optionalString(source.item_id ?? source.itemId),
    schemaVersion: optionalString(source.schema_version ?? source.schemaVersion),
    sequence: optionalNumber(source.event_seq ?? source.sequence),
    runId: optionalString(source.run_id ?? source.runId),
    projectId: optionalNumber(source.project_id ?? source.projectId),
    event: String(source.event_type ?? source.event ?? source.type ?? "message"),
    payload,
    modelResponseItemId: optionalString(source.model_response_item_id ?? source.modelResponseItemId ?? payload.model_response_item_id ?? payload.modelResponseItemId),
    occurredAt: optionalString(source.occurred_at ?? source.occurredAt),
    createdAt: optionalString(source.created_at ?? source.createdAt),
  };
}

function mapSnapshotRun(value: unknown): AgentRunSnapshot | undefined {
  const source = asRecord(value);
  const runId = optionalString(source.run_id ?? source.runId);
  if (!runId) return undefined;
  const blockingToolCallIds = source.blocking_tool_call_ids_json ?? source.blockingToolCallIds;
  return {
    itemId: optionalString(source.item_id ?? source.itemId),
    runId,
    projectId: Number(source.project_id ?? source.projectId ?? 0),
    userId: optionalNumber(source.user_id ?? source.userId),
    conversationId: optionalString(source.conversation_id ?? source.conversationId),
    intent: String(source.intent ?? ""),
    status: String(source.status ?? "queued") as AgentRunSnapshot["status"],
    currentIteration: Number(source.current_iteration ?? source.currentIteration ?? 0),
    currentStepIndex: Number(source.current_step_index ?? source.currentStepIndex ?? 0),
    maxIterations: Number(source.max_iterations ?? source.maxIterations ?? 0),
    autoComplete: Boolean(source.auto_complete ?? source.autoComplete ?? false),
    runtimeSnapshotId: optionalString(source.runtime_snapshot_id ?? source.runtimeSnapshotId),
    lastCheckpointId: optionalNumber(source.last_checkpoint_id ?? source.lastCheckpointId),
    lastEventSequence: optionalNumber(source.last_event_sequence ?? source.lastEventSequence),
    migrationBlockCount: Number(source.migration_block_count ?? source.migrationBlockCount ?? 0),
    blockingToolCallIds: Array.isArray(blockingToolCallIds)
      ? blockingToolCallIds.map(String)
      : [],
    migrationReasonPrimary: optionalString(source.migration_reason_primary ?? source.migrationReasonPrimary),
    errorCode: optionalString(source.error_code ?? source.errorCode),
    errorMessage: optionalString(source.error_message ?? source.errorMessage),
    events: [],
    toolCalls: [],
    approvals: [],
    migrationBlocks: [],
    contextBuilds: [],
    loopObservations: [],
    result: source.result ?? source.result_json,
    createdAt: optionalString(source.created_at ?? source.createdAt),
    updatedAt: optionalString(source.updated_at ?? source.updatedAt),
    startedAt: optionalString(source.started_at ?? source.startedAt),
    completedAt: optionalString(source.completed_at ?? source.completedAt),
  };
}

function mapContextCompaction(value: unknown): AgentContextCompaction {
  const source = asRecord(value);
  return {
    itemId: optionalString(source.item_id ?? source.itemId),
    runId: optionalString(source.run_id ?? source.runId),
    sequence: optionalNumber(source.event_seq ?? source.sequence),
    eventType: optionalString(source.event_type ?? source.eventType ?? source.event),
    payload: asRecord(source.payload_json ?? source.payload),
    createdAt: optionalString(source.created_at ?? source.createdAt),
  };
}

function mapEventSnapshot(value: unknown): AgentRunEventSnapshot {
  const source = asRecord(value);
  const contextCompactions = source.context_compactions ?? source.contextCompactions;
  return {
    run: mapSnapshotRun(source.run),
    events: Array.isArray(source.events) ? source.events.map(mapEvent) : [],
    contextCompactions: Array.isArray(contextCompactions)
      ? contextCompactions.map(mapContextCompaction)
      : [],
    afterSequence: optionalNumber(source.after_sequence ?? source.afterSequence),
    eventCount: optionalNumber(source.event_count ?? source.eventCount),
    latestEventSequence: optionalNumber(source.latest_event_sequence ?? source.latestEventSequence),
    nextAfterSequence: optionalNumber(source.next_after_sequence ?? source.nextAfterSequence),
    terminal: Boolean(source.terminal ?? false),
    generatedAt: optionalString(source.generated_at ?? source.generatedAt),
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
    itemId: optionalString(recordPayload.item_id ?? recordPayload.itemId),
    schemaVersion: optionalString(recordPayload.schema_version ?? recordPayload.schemaVersion),
    runId: optionalString(recordPayload.run_id ?? recordPayload.runId),
    projectId: optionalNumber(recordPayload.project_id ?? recordPayload.projectId),
    modelResponseItemId: optionalString(recordPayload.model_response_item_id ?? recordPayload.modelResponseItemId),
    occurredAt: optionalString(recordPayload.occurred_at ?? recordPayload.occurredAt),
    createdAt: optionalString(recordPayload.created_at ?? recordPayload.createdAt),
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
