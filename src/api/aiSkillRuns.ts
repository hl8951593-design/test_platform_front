import { requestEventStreamWithAuth, requestWithAuth } from "./client";

export type AiSkillRunStatus = "queued" | "running" | "completed" | "failed";

export interface AiSkillRunCreatePayload<TInput = unknown> {
  operation: string;
  project_id: number;
  environment_id?: number;
  source_id?: number;
  input: TInput;
}

export interface AiSkillRunQueued {
  runId: string;
  skillId: string;
  operation: string;
  status: AiSkillRunStatus;
}

export interface AiSkillRunEvent {
  id?: string;
  sequence?: number;
  event: string;
  payload: Record<string, unknown>;
  createdAt?: string;
}

export interface AiSkillRunSnapshot {
  runId: string;
  skillId: string;
  operation: string;
  projectId: number;
  status: AiSkillRunStatus;
  events: AiSkillRunEvent[];
  result?: unknown;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

type BackendRecord = Record<string, unknown>;

function asRecord(value: unknown): BackendRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as BackendRecord : {};
}

function mapQueued(value: unknown): AiSkillRunQueued {
  const source = asRecord(value);
  return {
    runId: String(source.run_id ?? source.runId ?? ""),
    skillId: String(source.skill_id ?? source.skillId ?? ""),
    operation: String(source.operation ?? ""),
    status: String(source.status ?? "queued") as AiSkillRunStatus,
  };
}

function mapEvent(value: unknown): AiSkillRunEvent {
  const source = asRecord(value);
  return {
    id: source.id === undefined ? undefined : String(source.id),
    sequence: source.sequence === undefined ? undefined : Number(source.sequence),
    event: String(source.event ?? source.type ?? "message"),
    payload: asRecord(source.payload ?? source.data),
    createdAt: source.created_at === undefined && source.createdAt === undefined
      ? undefined
      : String(source.created_at ?? source.createdAt),
  };
}

function mapSnapshot(value: unknown): AiSkillRunSnapshot {
  const source = asRecord(value);
  return {
    runId: String(source.run_id ?? source.runId ?? ""),
    skillId: String(source.skill_id ?? source.skillId ?? ""),
    operation: String(source.operation ?? ""),
    projectId: Number(source.project_id ?? source.projectId ?? 0),
    status: String(source.status ?? "queued") as AiSkillRunStatus,
    events: Array.isArray(source.events) ? source.events.map(mapEvent) : [],
    result: source.result,
    errorMessage: source.error_message === undefined && source.errorMessage === undefined
      ? undefined
      : String(source.error_message ?? source.errorMessage),
    createdAt: String(source.created_at ?? source.createdAt ?? ""),
    updatedAt: String(source.updated_at ?? source.updatedAt ?? ""),
  };
}

function parseSseChunk(chunk: string): AiSkillRunEvent | undefined {
  let id: string | undefined;
  let event = "message";
  let data = "";

  chunk.split("\n").forEach((line) => {
    if (line.startsWith("id:")) id = line.slice(3).trim();
    if (line.startsWith("event:")) event = line.slice(6).trim();
    if (line.startsWith("data:")) data += line.slice(5).trim();
  });

  if (!event && !data) return undefined;
  const rawPayload = data ? JSON.parse(data) : {};
  const recordPayload = asRecord(rawPayload);
  if ((event === "message" || event === "") && (recordPayload.event !== undefined || recordPayload.type !== undefined)) {
    return mapEvent({
      ...recordPayload,
      id: recordPayload.id ?? id,
      sequence: recordPayload.sequence ?? (id === undefined ? undefined : Number(id)),
    });
  }
  const payload = asRecord(recordPayload.payload ?? recordPayload.data ?? recordPayload);
  return {
    id,
    sequence: id === undefined ? undefined : Number(id),
    event,
    payload,
  };
}

export async function createAiSkillRun<TInput>(
  skillId: string,
  payload: AiSkillRunCreatePayload<TInput>,
) {
  const result = await requestWithAuth<BackendRecord>(`/ai/skills/${skillId}/runs`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return mapQueued(result);
}

export async function getAiSkillRun(runId: string) {
  const result = await requestWithAuth<BackendRecord>(`/ai/skill-runs/${runId}`);
  return mapSnapshot(result);
}

export async function subscribeAiSkillRunEvents(
  runId: string,
  onEvent: (event: AiSkillRunEvent) => void,
  options: { lastEventId?: number; signal?: AbortSignal } = {},
) {
  const headers = new Headers();
  if (options.lastEventId !== undefined) headers.set("Last-Event-ID", String(options.lastEventId));
  const response = await requestEventStreamWithAuth(`/ai/skill-runs/${runId}/events`, {
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
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";
    chunks.forEach((chunk) => {
      const event = parseSseChunk(chunk);
      if (event) onEvent(event);
    });
  }
}
