import { requestWithAuth } from "./client";

export type DefectStatus = "new" | "active" | "confirmed" | "fixed" | "verified" | "closed" | "reopened";
export type DefectType = "functional" | "ui" | "performance" | "security" | "compatibility" | "data" | "other";
export type DefectUrgency = "low" | "medium" | "high" | "critical";

export interface DefectAttachment {
  id: number;
  originalFilename: string;
  contentType: string;
  sizeBytes: number;
  downloadUrl: string;
  createdAt: string;
}

export interface Defect {
  id: string;
  projectId: number;
  title: string;
  assignee: string;
  type: DefectType;
  urgency: DefectUrgency;
  status: DefectStatus;
  contentHtml: string;
  attachments: DefectAttachment[];
  reporter: string;
  createdAt: string;
  updatedAt: string;
}

export interface DefectInput {
  id?: string;
  title: string;
  assignee: string;
  type: DefectType;
  urgency: DefectUrgency;
  status: DefectStatus;
  contentHtml: string;
  mediaIds?: number[];
}

type BackendRecord = Record<string, unknown>;
type PaginatedResult = {
  items?: BackendRecord[];
  records?: BackendRecord[];
  data?: BackendRecord[];
};

function buildQuery(values: Record<string, string | number | undefined>) {
  const query = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined && value !== "") query.set(key, String(value));
  });
  return query.toString();
}

function asRecord(value: unknown): BackendRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as BackendRecord : {};
}

function unwrapItems(result: BackendRecord[] | PaginatedResult) {
  if (Array.isArray(result)) return result;
  return result.items ?? result.records ?? result.data ?? [];
}

function asDefectStatus(value: unknown): DefectStatus {
  const normalized = String(value ?? "new");
  return ["new", "active", "confirmed", "fixed", "verified", "closed", "reopened"].includes(normalized)
    ? normalized as DefectStatus
    : "new";
}

function asDefectType(value: unknown): DefectType {
  const normalized = String(value ?? "functional");
  return ["functional", "ui", "performance", "security", "compatibility", "data", "other"].includes(normalized)
    ? normalized as DefectType
    : "functional";
}

function asUrgency(value: unknown): DefectUrgency {
  const normalized = String(value ?? "medium");
  return ["low", "medium", "high", "critical"].includes(normalized) ? normalized as DefectUrgency : "medium";
}

export function mapDefectAttachment(value: unknown): DefectAttachment {
  const source = asRecord(value);
  return {
    id: Number(source.id ?? 0),
    originalFilename: String(source.original_filename ?? "image"),
    contentType: String(source.content_type ?? "application/octet-stream"),
    sizeBytes: Number(source.size_bytes ?? 0),
    downloadUrl: String(source.download_url ?? ""),
    createdAt: String(source.created_at ?? ""),
  };
}

export function mapDefect(value: unknown, projectId: number): Defect {
  const source = asRecord(value);
  return {
    id: String(source.id ?? source.defect_id ?? ""),
    projectId: Number(source.project_id ?? projectId),
    title: String(source.title ?? "未命名缺陷"),
    assignee: String(source.assignee ?? source.assignee_name ?? ""),
    type: asDefectType(source.bug_type ?? source.type),
    urgency: asUrgency(source.urgency ?? source.priority),
    status: asDefectStatus(source.status),
    contentHtml: String(source.content_html ?? source.content ?? ""),
    attachments: Array.isArray(source.attachments) ? source.attachments.map(mapDefectAttachment) : [],
    reporter: String(source.reporter ?? source.reporter_name ?? source.created_by_name ?? "-"),
    createdAt: String(source.created_at ?? ""),
    updatedAt: String(source.updated_at ?? source.created_at ?? ""),
  };
}

function defectPayload(input: DefectInput) {
  const payload: Record<string, unknown> = {
    title: input.title,
    assignee: input.assignee || null,
    bug_type: input.type,
    urgency: input.urgency,
    status: input.status,
    content_html: input.contentHtml,
  };
  if (input.mediaIds !== undefined) payload.media_ids = input.mediaIds;
  return payload;
}

export async function listDefects(
  projectId: number,
  filters: { keyword?: string; status?: DefectStatus | "all"; urgency?: DefectUrgency | "all" } = {},
) {
  const result = await requestWithAuth<BackendRecord[] | PaginatedResult>(`/defects?${buildQuery({
    project_id: projectId,
    keyword: filters.keyword,
    status: filters.status === "all" ? undefined : filters.status,
    urgency: filters.urgency === "all" ? undefined : filters.urgency,
    page_size: 200,
  })}`);
  return unwrapItems(result).map((item) => mapDefect(item, projectId));
}

export async function getDefect(projectId: number, defectId: string) {
  const result = await requestWithAuth<BackendRecord>(`/defects/${defectId}?project_id=${projectId}`);
  return mapDefect(result, projectId);
}

export async function saveDefect(projectId: number, input: DefectInput) {
  const editing = Boolean(input.id);
  const result = await requestWithAuth<BackendRecord>(
    editing ? `/defects/${input.id}?project_id=${projectId}` : `/defects?project_id=${projectId}`,
    {
      method: editing ? "PUT" : "POST",
      body: JSON.stringify(defectPayload(input)),
    },
  );
  return mapDefect(result, projectId);
}

export async function transitionDefect(projectId: number, defectId: string, status: DefectStatus) {
  const result = await requestWithAuth<BackendRecord>(`/defects/${defectId}/status?project_id=${projectId}`, {
    method: "PUT",
    body: JSON.stringify({ status }),
  });
  return mapDefect(result, projectId);
}

export function deleteDefect(projectId: number, defectId: string) {
  return requestWithAuth<unknown>(`/defects/${defectId}?project_id=${projectId}`, { method: "DELETE" });
}

export async function uploadDefectImage(projectId: number, file: File) {
  const body = new FormData();
  body.append("file", file);
  const result = await requestWithAuth<BackendRecord>(`/media/images?project_id=${projectId}`, {
    method: "POST",
    body,
  });
  return mapDefectAttachment(result);
}

export async function refreshDefectImageUrl(projectId: number, mediaId: number) {
  const result = await requestWithAuth<BackendRecord>(`/media/${mediaId}/url?project_id=${projectId}`);
  return String(result.url ?? "");
}

export function deleteDefectImage(projectId: number, mediaId: number) {
  return requestWithAuth<unknown>(`/media/${mediaId}?project_id=${projectId}`, { method: "DELETE" });
}
