import { requestWithAuth } from "./client";

const API_BASE_URL =
  (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.VITE_API_BASE_URL ??
  "http://127.0.0.1:8000/api/v1";

export interface ProjectPayload {
  name: string;
  description: string;
}

export interface EnvironmentPayload {
  name: string;
  base_url: string;
  description: string;
  is_default: boolean;
}

export interface BackendProject {
  id?: number | string;
  project_id?: number | string;
  name?: string;
  title?: string;
  description?: string | null;
  owner?: string;
  owner_name?: string;
  creator_name?: string;
  created_by_name?: string;
  created_at?: string;
  updated_at?: string;
  status?: string;
  is_active?: boolean;
  [key: string]: unknown;
}

export interface ProjectOption {
  id: number;
  name: string;
  description: string;
  owner: string;
  updatedAt: string;
  status: string;
}

export interface BackendEnvironment {
  id?: number | string;
  environment_id?: number | string;
  name?: string;
  base_url?: string;
  description?: string | null;
  is_default?: boolean;
  is_active?: boolean;
  [key: string]: unknown;
}

export interface EnvironmentOption {
  id: number;
  name: string;
  baseUrl: string;
  description: string;
  isDefault: boolean;
}

type ProjectListResult = BackendProject[] | { data?: BackendProject[]; items?: BackendProject[]; records?: BackendProject[] };
type EnvironmentListResult =
  | BackendEnvironment[]
  | { data?: BackendEnvironment[]; items?: BackendEnvironment[]; records?: BackendEnvironment[] };

function getAuthHeaders() {
  const token = localStorage.getItem("access_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request<T>(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  Object.entries(getAuthHeaders()).forEach(([key, value]) => headers.set(key, value));

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
  });
  const result = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      typeof result?.detail === "string"
        ? result.detail
        : typeof result?.message === "string"
          ? result.message
          : "项目接口请求失败，请稍后重试";
    throw new Error(message);
  }

  return (result && typeof result === "object" && "data" in result ? result.data : result) as T;
}

function unwrapProjects(result: ProjectListResult) {
  if (Array.isArray(result)) return result;
  return result.data ?? result.items ?? result.records ?? [];
}

function unwrapEnvironments(result: EnvironmentListResult) {
  if (Array.isArray(result)) return result;
  return result.data ?? result.items ?? result.records ?? [];
}

function formatDate(raw: unknown) {
  if (typeof raw !== "string" || !raw) return "-";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function mapProject(project: BackendProject): ProjectOption {
  const rawId = project.id ?? project.project_id ?? 0;
  const id = typeof rawId === "number" ? rawId : Number(rawId);

  return {
    id: Number.isFinite(id) ? id : 0,
    name: project.name ?? project.title ?? "未命名项目",
    description: project.description ?? "自动化测试项目",
    owner: project.owner_name ?? project.creator_name ?? project.created_by_name ?? project.owner ?? "当前用户",
    updatedAt: formatDate(project.updated_at ?? project.created_at),
    status: project.is_active === false || project.status === "disabled" ? "停用" : "正常",
  };
}

export function mapEnvironment(environment: BackendEnvironment): EnvironmentOption {
  const rawId = environment.id ?? environment.environment_id ?? 0;
  const id = typeof rawId === "number" ? rawId : Number(rawId);

  return {
    id: Number.isFinite(id) ? id : 0,
    name: environment.name ?? "未命名环境",
    baseUrl: environment.base_url ?? "",
    description: environment.description ?? "",
    isDefault: environment.is_default === true,
  };
}

export async function listProjects() {
  const result = await requestWithAuth<ProjectListResult>("/projects");
  return unwrapProjects(result).map(mapProject).filter((project) => project.id > 0);
}

export async function createProject(payload: ProjectPayload) {
  const result = await requestWithAuth<BackendProject>("/projects", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return mapProject(result);
}

export async function listProjectEnvironments(projectId: number) {
  const result = await requestWithAuth<EnvironmentListResult>(`/environment-configs?project_id=${projectId}`);
  return unwrapEnvironments(result).map(mapEnvironment).filter((environment) => environment.id > 0);
}

export async function createProjectEnvironment(projectId: number, payload: EnvironmentPayload) {
  const result = await requestWithAuth<BackendEnvironment>(`/environment-configs?project_id=${projectId}`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return mapEnvironment(result);
}
