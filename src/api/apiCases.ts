import { requestWithAuth } from "./client";

const API_BASE_URL =
  (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.VITE_API_BASE_URL ??
  "http://127.0.0.1:8000/api/v1";

export interface ApiKeyValue {
  key: string;
  value: string;
  enabled: boolean;
}

export interface TestCaseAssertion {
  type: "status_code" | "body_contains" | "json_equals";
  path?: string;
  expected: unknown;
}

export interface TestCaseRequestPayload {
  environment_id: number;
  environment_ids?: number[];
  method: string;
  path: string;
  headers: Record<string, string>;
  query_params: Record<string, string>;
  body_type: "none" | "json" | "form_urlencoded" | "multipart" | "raw_text" | "raw_json";
  body: unknown;
  assertions: TestCaseAssertion[];
  extractors: unknown[];
}

export interface TestCaseSavePayload extends TestCaseRequestPayload {
  name: string;
  description: string;
}

export type WebSocketMessageType = "text" | "json";

export interface WebSocketMessage {
  type: WebSocketMessageType;
  data: unknown;
}

export interface WebSocketAssertion {
  type: "message_count" | "message_contains" | "message_json_equals";
  message_index?: number;
  path?: string;
  expected: unknown;
}

export interface WebSocketExtractor {
  name: string;
  message_index: number;
  path: string;
}

export interface WebSocketTestCaseRequestPayload {
  environment_id?: number;
  environment_ids?: number[];
  path: string;
  headers: Record<string, string>;
  subprotocols: string[];
  connect_timeout_ms: number;
  receive_timeout_ms: number;
  receive_count: number;
  messages: WebSocketMessage[];
  assertions: WebSocketAssertion[];
  extractors: WebSocketExtractor[];
}

export interface WebSocketTestCaseSavePayload extends WebSocketTestCaseRequestPayload {
  name: string;
  description: string;
}

export type AnyTestCaseSavePayload = TestCaseSavePayload | WebSocketTestCaseSavePayload;

export interface AiTestCaseGeneratePayload {
  interface_text: string;
  request_method?: string;
  generate_count?: number;
  include_assertions?: boolean;
  extra_requirements?: string;
}

export interface AiTestCaseExpandPayload {
  requirement: string;
  generate_count?: number;
  expansion_types?: string[];
  include_assertions?: boolean;
}

export interface AiTestCaseGenerateResult {
  project_id: number;
  environment_id: number;
  environment_ids: number[];
  source_summary?: string;
  cases: AnyTestCaseSavePayload[];
  warnings?: string[];
}

export type BackendTestCase = Record<string, unknown>;
export type ApiResult<T> = T | { items?: T; records?: T; results?: T; data?: T };

function getAuthHeaders() {
  const token = localStorage.getItem("access_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function buildQuery(params: Record<string, string | number | undefined>) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined) query.set(key, String(value));
  });
  return query.toString();
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
          : "接口请求失败，请稍后重试";
    throw new Error(message);
  }

  if (result && typeof result === "object" && "data" in result) {
    return result.data as T;
  }

  return result as T;
}

export function listTestCases(projectId: number) {
  return requestWithAuth<ApiResult<BackendTestCase[]>>(`/test-cases?${buildQuery({ project_id: projectId })}`);
}

export function listWebSocketTestCases(projectId: number) {
  return requestWithAuth<ApiResult<BackendTestCase[]>>(`/websocket-test-cases?${buildQuery({ project_id: projectId })}`);
}

export function createTestCase(projectId: number, payload: TestCaseSavePayload) {
  return requestWithAuth<BackendTestCase>(`/test-cases?${buildQuery({ project_id: projectId })}`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateTestCase(projectId: number, testCaseId: string | number, payload: TestCaseSavePayload) {
  return requestWithAuth<BackendTestCase>(`/test-cases/${testCaseId}?${buildQuery({ project_id: projectId })}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function deleteTestCase(projectId: number, testCaseId: string | number) {
  return requestWithAuth<unknown>(`/test-cases/${testCaseId}?${buildQuery({ project_id: projectId })}`, {
    method: "DELETE",
  });
}

export function executeSavedTestCase(projectId: number, testCaseId: string | number, environmentId?: number) {
  return requestWithAuth<BackendTestCase>(
    `/test-cases/${testCaseId}/execute?${buildQuery({ project_id: projectId, environment_id: environmentId })}`,
    { method: "POST" },
  );
}

export function executeUnsavedTestCase(projectId: number, payload: TestCaseRequestPayload) {
  return requestWithAuth<BackendTestCase>(`/test-cases/execute-unsaved?${buildQuery({ project_id: projectId })}`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function generateAiTestCases(projectId: number, environmentId: number, payload: AiTestCaseGeneratePayload) {
  return requestWithAuth<AiTestCaseGenerateResult>(
    `/ai/test-cases/generate?${buildQuery({ project_id: projectId, environment_id: environmentId })}`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}

export function expandAiTestCase(
  projectId: number,
  testCaseId: string | number,
  payload: AiTestCaseExpandPayload,
  environmentId?: number,
) {
  return requestWithAuth<AiTestCaseGenerateResult>(
    `/ai/test-cases/${testCaseId}/expand?${buildQuery({ project_id: projectId, environment_id: environmentId })}`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}

export function createWebSocketTestCase(projectId: number, payload: WebSocketTestCaseSavePayload) {
  return requestWithAuth<BackendTestCase>(`/websocket-test-cases?${buildQuery({ project_id: projectId })}`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateWebSocketTestCase(
  projectId: number,
  testCaseId: string | number,
  payload: WebSocketTestCaseSavePayload,
) {
  return requestWithAuth<BackendTestCase>(
    `/websocket-test-cases/${testCaseId}?${buildQuery({ project_id: projectId })}`,
    {
      method: "PUT",
      body: JSON.stringify(payload),
    },
  );
}

export function deleteWebSocketTestCase(projectId: number, testCaseId: string | number) {
  return requestWithAuth<unknown>(`/websocket-test-cases/${testCaseId}?${buildQuery({ project_id: projectId })}`, {
    method: "DELETE",
  });
}

export function executeSavedWebSocketTestCase(projectId: number, testCaseId: string | number, environmentId?: number) {
  return requestWithAuth<BackendTestCase>(
    `/websocket-test-cases/${testCaseId}/execute?${buildQuery({ project_id: projectId, environment_id: environmentId })}`,
    { method: "POST" },
  );
}

export function executeUnsavedWebSocketTestCase(projectId: number, payload: WebSocketTestCaseRequestPayload) {
  return requestWithAuth<BackendTestCase>(
    `/websocket-test-cases/execute-unsaved?${buildQuery({ project_id: projectId })}`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}
