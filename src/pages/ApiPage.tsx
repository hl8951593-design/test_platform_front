import { type MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createTestCase,
  createWebSocketTestCase,
  deleteTestCase,
  deleteWebSocketTestCase,
  expandAiTestCase,
  executeSavedTestCase,
  executeSavedWebSocketTestCase,
  executeUnsavedTestCase,
  executeUnsavedWebSocketTestCase,
  generateAiTestCases,
  listTestCases,
  listWebSocketTestCases,
  updateTestCase,
  updateWebSocketTestCase,
  type AiTestCaseExpandPayload,
  type AiTestCaseGenerateResult,
  type AnyTestCaseSavePayload,
  type ApiKeyValue,
  type ApiResult,
  type BackendTestCase,
  type TestCaseAssertion,
  type TestCaseRequestPayload,
  type TestCaseSavePayload,
  type WebSocketMessage,
  type WebSocketAssertion,
  type WebSocketExtractor,
  type WebSocketTestCaseRequestPayload,
  type WebSocketTestCaseSavePayload,
} from "../api/apiCases";
import {
  deleteEnvironmentVariable,
  listEnvironmentVariables,
  type BackendEnvironmentVariable,
  upsertEnvironmentVariable,
} from "../api/environmentConfigs";
import { Icon } from "../components/Icon";
import type { EnvironmentOption } from "../api/projects";
import type { ActionHandler } from "../types";

interface ApiCase {
  id: string;
  backendId?: string | number;
  group: string;
  method: string;
  name: string;
  path: string;
  owner: string;
  updatedAt: string;
  status: "已启用" | "草稿";
  lastExecutionStatus: string;
  description?: string;
  environmentId?: number;
  environmentIds: number[];
  params?: ApiKeyValue[];
  headers?: ApiKeyValue[];
  bodyType?: BodyType;
  jsonBody?: string;
  formBody?: ApiKeyValue[];
  urlEncodedBody?: ApiKeyValue[];
  rawBody?: string;
  assertions?: string[];
  exampleResponse?: string;
  protocol: CaseProtocol;
  subprotocols?: string[];
  connectTimeoutMs?: number;
  responseTimeoutMs?: number;
  receiveCount?: number;
  messages?: WebSocketMessage[];
  extractors?: WebSocketExtractor[];
}

type KeyValueRow = ApiKeyValue;
type CaseProtocol = "http" | "websocket";
type EditorTab = "params" | "headers" | "body" | "message" | "assertions" | "response";
type EditorMode = "create" | "edit";
type BodyType = "JSON" | "Form Data" | "x-www-form-urlencoded" | "Raw Text";
type CaseStatusFilter = "all" | ApiCase["status"];
type ListResponse = ApiResult<BackendTestCase[]>;
type VariableFormState = { name: string; value: string; isSecret: boolean };
type EnvironmentVariableView = { id: string; name: string; value: string; isSecret: boolean };
type RunFeedback = {
  caseId: string;
  caseName: string;
  message: string;
  status: "success" | "error";
};
type DebugResponseTab = "request" | "headers" | "body" | "assertions";
type DebugExecutionView = {
  assertionResults: string;
  assertionStatus: "pass" | "notpass" | "empty";
  createdAt?: string;
  durationMs?: string | number;
  errorMessage?: string | null;
  requestSnapshot: string;
  responseBody: string;
  responseHeaders: string;
  status?: string;
  statusCode?: string | number;
};
type LiveWebSocketStatus = "disconnected" | "connecting" | "connected" | "error";
type LiveWebSocketLog = {
  id: string;
  direction: "sent" | "received" | "system";
  message: string;
  timestamp: string;
};

const httpMethods = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;
const requestMethods = [...httpMethods, "WS"] as const;
const protocolLabels: Record<CaseProtocol, string> = { http: "HTTP", websocket: "WebSocket" };

function normalizeMethod(method: string) {
  return method === "DEL" ? "DELETE" : method;
}

const commonHeaderValues: Record<string, string[]> = {
  Accept: ["application/json", "application/xml", "text/plain", "*/*"],
  Authorization: ["Bearer {{access_token}}", "Basic {{credentials}}"],
  "Cache-Control": ["no-cache", "no-store", "max-age=0"],
  "Content-Type": ["application/json", "application/x-www-form-urlencoded", "multipart/form-data", "text/plain"],
  "X-Request-Id": ["{{request_id}}", "{{uuid}}"],
  "X-Tenant-Id": ["{{tenant_id}}", "{{project_id}}"],
};

const commonHeaderKeys = Object.keys(commonHeaderValues);

function createDraftCase(nextIndex: number, environmentId?: number, protocol: CaseProtocol = "http"): ApiCase {
  return {
    id: `${protocol === "websocket" ? "WS" : "API"}-NEW-${String(nextIndex).padStart(3, "0")}`,
    group: "未分组",
    method: protocol === "websocket" ? "WS" : "GET",
    name: protocol === "websocket" ? "新建 WebSocket 测试用例" : "新建接口测试用例",
    path: "",
    owner: "平台团队",
    updatedAt: "刚刚",
    status: "草稿",
    lastExecutionStatus: "未执行",
    environmentId,
    environmentIds: environmentId ? [environmentId] : [],
    protocol,
    subprotocols: [],
    connectTimeoutMs: 5000,
    responseTimeoutMs: 10000,
    receiveCount: 1,
    messages: [],
    extractors: [],
  };
}

function unwrapListResponse(result: ListResponse): BackendTestCase[] {
  if (Array.isArray(result)) return result;
  const nested = result.items ?? result.records ?? result.results ?? result.data;
  return Array.isArray(nested) ? nested : [];
}

function readString(source: BackendTestCase, keys: string[], fallback = "") {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value;
    if (typeof value === "number") return String(value);
  }
  return fallback;
}

function readNumber(source: BackendTestCase, keys: string[]) {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "number") return value;
    if (typeof value === "string" && Number.isFinite(Number(value))) return Number(value);
  }
  return undefined;
}

function readNumberList(source: BackendTestCase, keys: string[]) {
  const values: number[] = [];
  keys.forEach((key) => {
    const raw = source[key];
    if (Array.isArray(raw)) {
      raw.forEach((item) => {
        if (typeof item === "number" && Number.isFinite(item)) values.push(item);
        if (typeof item === "string" && Number.isFinite(Number(item))) values.push(Number(item));
        if (item && typeof item === "object") {
          const nested = item as Record<string, unknown>;
          const nestedId = nested.id ?? nested.environment_id;
          if (typeof nestedId === "number" && Number.isFinite(nestedId)) values.push(nestedId);
          if (typeof nestedId === "string" && Number.isFinite(Number(nestedId))) values.push(Number(nestedId));
        }
      });
    }
  });
  return Array.from(new Set(values));
}

function readNestedString(source: BackendTestCase, objectKeys: string[], valueKeys: string[]) {
  for (const objectKey of objectKeys) {
    const nested = source[objectKey];
    if (!nested || typeof nested !== "object" || Array.isArray(nested)) continue;
    const value = readString(nested as BackendTestCase, valueKeys);
    if (value) return value;
  }
  return "";
}

function formatExecutionStatus(rawStatus: string) {
  const normalized = rawStatus.trim().toLowerCase();
  if (!normalized) return "未执行";
  if (["passed", "pass", "success", "succeeded", "ok"].includes(normalized)) return "通过";
  if (["failed", "fail", "failure", "error"].includes(normalized)) return "失败";
  if (["running", "processing", "pending"].includes(normalized)) return "运行中";
  if (["skipped", "skip"].includes(normalized)) return "跳过";
  return rawStatus;
}

function readLastExecutionStatus(source: BackendTestCase) {
  const directStatus = readString(source, [
    "last_execution_status",
    "last_run_status",
    "latest_execution_status",
    "execution_status",
  ]);
  const nestedStatus = readNestedString(source, ["last_execution", "latest_execution", "last_result"], ["status"]);
  return formatExecutionStatus(directStatus || nestedStatus);
}

function mapEnvironmentVariable(source: BackendEnvironmentVariable, index: number): EnvironmentVariableView {
  const id = source.id ?? `${source.name ?? "variable"}-${index}`;
  return {
    id: String(id),
    isSecret: source.is_secret === true,
    name: typeof source.name === "string" ? source.name : "未命名变量",
    value: typeof source.value === "string" ? source.value : "",
  };
}

function joinEnvironmentUrl(prefix: string, path: string) {
  if (!prefix) return path;
  if (!path) return prefix;
  return `${prefix.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function buildCaseEditorUrl(apiCase: ApiCase, environment?: EnvironmentOption) {
  const path = apiCase.path.trim();
  if (!path || /^(?:https?|wss?):\/\//i.test(path) || path.startsWith("{{")) return apiCase.path;

  const hostVariable = environment?.variables?.find(
    (variable) => variable.name.trim().toLowerCase() === "host",
  );
  const prefix = hostVariable ? `{{${hostVariable.name}}}` : environment?.baseUrl ?? "";
  return joinEnvironmentUrl(prefix, apiCase.path);
}

function getEnvironmentName(environmentId: number | undefined, environments: EnvironmentOption[]) {
  if (!environmentId) return "未分组";
  return environments.find((item) => item.id === environmentId)?.name ?? "未分组";
}

function executionStatusClass(status: string) {
  if (status === "通过") return "status status-通过";
  if (status === "失败") return "status status-失败";
  if (status === "运行中") return "status status-运行中";
  if (status === "跳过") return "status status-警告";
  return "status status-muted";
}

function readOwner(source: BackendTestCase) {
  const creator = source.creator;
  if (creator && typeof creator === "object") {
    const username = (creator as Record<string, unknown>).username;
    if (typeof username === "string") return username;
  }
  return readString(source, ["owner", "creator_name", "created_by_name", "created_by"], "未知");
}

function formatBackendDate(source: BackendTestCase) {
  const raw = readString(source, ["updated_at", "last_execution_time", "last_executed_at", "created_at"], "-");
  if (raw === "-") return raw;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function objectToRows(value: unknown): KeyValueRow[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value as Record<string, unknown>).map(([key, rowValue]) => ({
    key,
    value: typeof rowValue === "string" ? rowValue : JSON.stringify(rowValue),
    enabled: true,
  }));
}

function rowsToObject(rows: KeyValueRow[]) {
  return rows.reduce<Record<string, string>>((result, row) => {
    if (row.enabled && row.key.trim()) result[row.key.trim()] = row.value;
    return result;
  }, {});
}

function stringifyBody(body: unknown) {
  if (body === null || body === undefined || body === "") return "";
  if (typeof body === "string") {
    try {
      return JSON.stringify(JSON.parse(body), null, 2);
    } catch {
      return body;
    }
  }
  return JSON.stringify(body, null, 2);
}

function readObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function formatExecutionValue(value: unknown, fallback = "-") {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "string") {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  return JSON.stringify(value, null, 2);
}

function formatAssertionValue(value: unknown) {
  if (typeof value === "string") return value;
  if (value === undefined) return "未返回";
  return JSON.stringify(value);
}

function formatAssertionFailureReason(item: Record<string, unknown>, index: number) {
  const directReason = item.reason ?? item.message ?? item.error_message ?? item.error;
  if (typeof directReason === "string" && directReason.trim()) return directReason.trim();

  const assertion = readObject(item.assertion);
  const type = typeof assertion.type === "string" ? assertion.type : "assertion";
  const path = typeof assertion.path === "string" && assertion.path ? `（${assertion.path}）` : "";
  return `断言 ${index + 1} ${type}${path} 失败：期望 ${formatAssertionValue(assertion.expected)}，实际 ${formatAssertionValue(item.actual)}`;
}

function formatAssertionResult(value: unknown): Pick<DebugExecutionView, "assertionResults" | "assertionStatus"> {
  if (!Array.isArray(value) || value.length === 0) {
    return { assertionResults: "暂无断言结果", assertionStatus: "empty" };
  }

  const assertionItems = value.map(readObject);
  const failedItems = assertionItems.filter((item) => item.passed === false);
  const hasPassedResult = assertionItems.some((item) => item.passed === true);

  if (failedItems.length > 0) {
    const reasons = failedItems.map(formatAssertionFailureReason);
    return {
      assertionResults: `notpass\n失败原因：\n${reasons.map((reason) => `- ${reason}`).join("\n")}`,
      assertionStatus: "notpass",
    };
  }
  if (hasPassedResult) return { assertionResults: "pass", assertionStatus: "pass" };
  return { assertionResults: "暂无断言结果", assertionStatus: "empty" };
}

function formatDebugExecution(result: BackendTestCase): DebugExecutionView {
  const responseSnapshot = readObject(result.response_snapshot);
  const responseBody =
    responseSnapshot.json !== null && responseSnapshot.json !== undefined
      ? responseSnapshot.json
      : responseSnapshot.body ?? responseSnapshot.received_messages ?? responseSnapshot.messages ?? responseSnapshot.message;

  const assertionResult = formatAssertionResult(result.assertion_results);

  return {
    ...assertionResult,
    createdAt: typeof result.created_at === "string" ? result.created_at : undefined,
    durationMs: typeof result.duration_ms === "string" || typeof result.duration_ms === "number" ? result.duration_ms : undefined,
    errorMessage: typeof result.error_message === "string" ? result.error_message : null,
    requestSnapshot: formatExecutionValue(result.request_snapshot ?? result.session_snapshot, "暂无请求快照"),
    responseBody: formatExecutionValue(responseBody, "响应体为空"),
    responseHeaders: formatExecutionValue(responseSnapshot.headers, "暂无响应头"),
    status: typeof result.status === "string" ? result.status : undefined,
    statusCode:
      typeof responseSnapshot.status_code === "string" || typeof responseSnapshot.status_code === "number"
        ? responseSnapshot.status_code
        : undefined,
  };
}

function bodyTypeFromBackend(value: unknown): BodyType {
  if (value === "multipart") return "Form Data";
  if (value === "form_urlencoded") return "x-www-form-urlencoded";
  if (value === "raw_text" || value === "raw_json") return "Raw Text";
  return "JSON";
}

function mapBackendCase(source: BackendTestCase, index: number): ApiCase {
  const backendId = source.id ?? source.test_case_id ?? source.case_id ?? `API-${index + 1}`;
  const bodyType = bodyTypeFromBackend(source.body_type);
  const body = source.body;
  const singleEnvironmentId = readNumber(source, ["environment_id"]);
  const environmentIds = readNumberList(source, [
    "environment_ids",
    "bound_environment_ids",
    "environment_config_ids",
    "environments",
    "environment_configs",
  ]);
  if (singleEnvironmentId && !environmentIds.includes(singleEnvironmentId)) environmentIds.unshift(singleEnvironmentId);
  const protocolValue = readString(source, ["protocol", "case_type", "request_type"]).toLowerCase();
  const protocol: CaseProtocol =
    protocolValue === "websocket" || protocolValue === "ws" || source.messages !== undefined ? "websocket" : "http";

  return {
    id: readString(
      source,
      ["case_no", "code", "serial_no"],
      `${protocol === "websocket" ? "WS" : "API"}-${String(index + 1).padStart(3, "0")}`,
    ),
    backendId: typeof backendId === "string" || typeof backendId === "number" ? backendId : undefined,
    group: readString(source, ["group", "collection", "suite", "module_name"], "未分组"),
    method: protocol === "websocket" ? "WS" : normalizeMethod(readString(source, ["method"], "GET")),
    name: readString(source, ["name", "title"], "未命名测试用例"),
    path: readString(source, ["path", "url", "api_path"], ""),
    owner: readOwner(source),
    updatedAt: formatBackendDate(source),
    status: source.is_active === false || source.status === "draft" ? "草稿" : "已启用",
    lastExecutionStatus: readLastExecutionStatus(source),
    description: readString(source, ["description"], ""),
    environmentId: singleEnvironmentId ?? environmentIds[0],
    environmentIds,
    params: objectToRows(source.query_params),
    headers: objectToRows(source.headers),
    bodyType,
    jsonBody: bodyType === "JSON" ? stringifyBody(body) : "",
    formBody: bodyType === "Form Data" ? objectToRows(body) : [],
    urlEncodedBody: bodyType === "x-www-form-urlencoded" ? objectToRows(body) : [],
    rawBody: bodyType === "Raw Text" && typeof body === "string" ? body : "",
    assertions: Array.isArray(source.assertions) ? source.assertions.map(formatAssertionLine) : undefined,
    exampleResponse: stringifyBody(source.response_example ?? source.example_response ?? source.last_response),
    protocol,
    subprotocols: Array.isArray(source.subprotocols) ? source.subprotocols.map(String) : [],
    connectTimeoutMs: readNumber(source, ["connect_timeout_ms"]) ?? 5000,
    responseTimeoutMs: readNumber(source, ["receive_timeout_ms"]) ?? 10000,
    receiveCount: readNumber(source, ["receive_count"]) ?? 1,
    messages: Array.isArray(source.messages)
      ? source.messages.map((message) => {
          const item = readObject(message);
          return { type: item.type === "json" ? "json" : "text", data: item.data ?? "" } as WebSocketMessage;
        })
      : [],
    extractors: Array.isArray(source.extractors)
      ? source.extractors.map((extractor) => {
          const item = readObject(extractor);
          return {
            name: typeof item.name === "string" ? item.name : "",
            message_index: typeof item.message_index === "number" ? item.message_index : 0,
            path: typeof item.path === "string" ? item.path : "",
          };
        })
      : [],
  };
}

function formatAssertionLine(assertion: unknown) {
  if (!assertion || typeof assertion !== "object") return String(assertion);
  const item = assertion as Record<string, unknown>;
  if (item.type === "status_code") return `status == ${String(item.expected ?? "")}`;
  if (item.type === "json_equals") return `body.${String(item.path ?? "")} == ${String(item.expected ?? "")}`;
  if (item.type === "body_contains") return `body contains ${String(item.expected ?? "")}`;
  if (item.type === "message_count") return `message_count == ${String(item.expected ?? "")}`;
  if (item.type === "message_contains") {
    return `message[${String(item.message_index ?? 0)}] contains ${String(item.expected ?? "")}`;
  }
  if (item.type === "message_json_equals") {
    return `message[${String(item.message_index ?? 0)}].${String(item.path ?? "")} == ${String(item.expected ?? "")}`;
  }
  return JSON.stringify(item);
}

function parseExpectedValue(value: string) {
  const trimmed = value.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null") return null;
  if (trimmed !== "" && Number.isFinite(Number(trimmed))) return Number(trimmed);
  return trimmed.replace(/^["']|["']$/g, "");
}

function parseAssertions(lines: string[]): TestCaseAssertion[] {
  return lines
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const statusMatch = line.match(/^status\s*==\s*(\d+)$/i);
      if (statusMatch) return { type: "status_code", expected: Number(statusMatch[1]) };

      const jsonMatch = line.match(/^body\.([\w.[\]-]+)\s*==\s*(.+)$/i);
      if (jsonMatch) return { type: "json_equals", path: jsonMatch[1], expected: parseExpectedValue(jsonMatch[2]) };

      const containsMatch = line.match(/^body\s+contains\s+(.+)$/i);
      if (containsMatch) return { type: "body_contains", expected: parseExpectedValue(containsMatch[1]) };

      return { type: "body_contains", expected: line };
    });
}

function parseWebSocketAssertions(lines: string[]): WebSocketAssertion[] {
  return lines
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const countMatch = line.match(/^message_count\s*==\s*(\d+)$/i);
      if (countMatch) return { type: "message_count", expected: Number(countMatch[1]) };

      const jsonMatch = line.match(/^message\[(\d+)\]\.([\w.[\]-]+)\s*==\s*(.+)$/i);
      if (jsonMatch) {
        return {
          type: "message_json_equals",
          message_index: Number(jsonMatch[1]),
          path: jsonMatch[2],
          expected: parseExpectedValue(jsonMatch[3]),
        };
      }

      const containsMatch = line.match(/^message\[(\d+)\]\s+contains\s+(.+)$/i);
      if (containsMatch) {
        return {
          type: "message_contains",
          message_index: Number(containsMatch[1]),
          expected: parseExpectedValue(containsMatch[2]),
        };
      }

      return { type: "message_contains", message_index: 0, expected: line };
    });
}

function splitUrlQuery(value: string) {
  if (!value.includes("?")) return { cleanUrl: value, queryEntries: [] as Array<[string, string]> };

  try {
    const parsedUrl = new URL(value);
    const queryEntries = Array.from(parsedUrl.searchParams.entries());
    parsedUrl.search = "";
    return { cleanUrl: parsedUrl.toString(), queryEntries };
  } catch {
    const [cleanUrl, queryPart = ""] = value.split("?");
    const searchParams = new URLSearchParams(queryPart.split("#")[0]);
    return { cleanUrl, queryEntries: Array.from(searchParams.entries()) };
  }
}

function mergeUrlQueryParams(rows: KeyValueRow[], queryEntries: Array<[string, string]>) {
  if (queryEntries.length === 0) return rows;
  const nextRows = [...rows];

  queryEntries.forEach(([key, value]) => {
    if (!key.trim()) return;
    const matchedIndex = nextRows.findIndex((row) => row.key === key);
    if (matchedIndex >= 0) {
      nextRows[matchedIndex] = { ...nextRows[matchedIndex], value, enabled: true };
      return;
    }
    nextRows.push({ key, value, enabled: true });
  });

  return nextRows;
}

export function ApiPage({
  environmentError,
  environmentId,
  environmentLoading,
  environments,
  onAction,
  projectId,
}: {
  environmentError: string;
  environmentId?: number;
  environmentLoading: boolean;
  environments: EnvironmentOption[];
  onAction: ActionHandler;
  projectId?: number;
}) {
  const [cases, setCases] = useState<ApiCase[]>([]);
  const [editorState, setEditorState] = useState<{ mode: EditorMode; apiCase: ApiCase } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [caseTitleQuery, setCaseTitleQuery] = useState("");
  const [methodFilters, setMethodFilters] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState<CaseStatusFilter>("all");
  const [aiGenerateModalOpen, setAiGenerateModalOpen] = useState(false);
  const [aiExpandCase, setAiExpandCase] = useState<ApiCase | null>(null);
  const [variableModalOpen, setVariableModalOpen] = useState(false);
  const [variableForm, setVariableForm] = useState<VariableFormState>({ name: "", value: "", isSecret: false });
  const [variableErrors, setVariableErrors] = useState<{ name?: string; value?: string }>({});
  const [editingVariable, setEditingVariable] = useState<EnvironmentVariableView | null>(null);
  const [environmentVariables, setEnvironmentVariables] = useState<EnvironmentVariableView[]>([]);
  const [isLoadingVariables, setIsLoadingVariables] = useState(false);
  const [variableListError, setVariableListError] = useState("");
  const [isSavingVariable, setIsSavingVariable] = useState(false);
  const [deletingVariableId, setDeletingVariableId] = useState<string | null>(null);
  const [runningCaseIds, setRunningCaseIds] = useState<string[]>([]);
  const [deletingCaseIds, setDeletingCaseIds] = useState<string[]>([]);
  const [deleteCandidate, setDeleteCandidate] = useState<ApiCase | null>(null);
  const [runFeedback, setRunFeedback] = useState<RunFeedback | null>(null);
  const loadRequestId = useRef(0);
  const canCreateCase = useMemo(
    () => Boolean(projectId && environmentId && !environmentLoading && !environmentError),
    [environmentError, environmentId, environmentLoading, projectId],
  );
  const canCreateWebSocketCase = Boolean(projectId);
  const canCreateVariable = canCreateCase;
  const environmentVariableOptions = useMemo(
    () => environmentVariables.map((item) => `{{${item.name}}}`),
    [environmentVariables],
  );
  const filteredCases = useMemo(() => {
    const titleKeyword = caseTitleQuery.trim().toLowerCase();
    return cases.filter((item) => {
      const titleMatched = !titleKeyword || item.name.toLowerCase().includes(titleKeyword);
      const methodMatched = methodFilters.length === 0 || methodFilters.includes(item.method);
      const statusMatched = statusFilter === "all" || item.status === statusFilter;
      return titleMatched && methodMatched && statusMatched;
    });
  }, [caseTitleQuery, cases, methodFilters, statusFilter]);
  const hasActiveFilters = Boolean(caseTitleQuery.trim()) || methodFilters.length > 0 || statusFilter !== "all";
  const getCaseEnvironmentNames = (apiCase: ApiCase) => {
    const names = apiCase.environmentIds
      .map((id) => environments.find((item) => item.id === id)?.name)
      .filter((name): name is string => Boolean(name));
    if (names.length > 0) return names;
    if (apiCase.protocol === "websocket" && /^wss?:\/\//i.test(apiCase.path)) return ["无需环境"];
    return [apiCase.group];
  };

  const loadCases = useCallback(async () => {
    const requestId = loadRequestId.current + 1;
    loadRequestId.current = requestId;

    if (!projectId) {
      setCases([]);
      setListError("请先创建或选择项目，再维护接口测试用例。");
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setListError("");
    try {
      const [httpResult, websocketResult] = await Promise.all([listTestCases(projectId), listWebSocketTestCases(projectId)]);
      if (loadRequestId.current !== requestId) return;
      const httpCases = unwrapListResponse(httpResult).map(mapBackendCase);
      const websocketCases = unwrapListResponse(websocketResult).map((item, index) =>
        mapBackendCase({ ...item, protocol: "websocket" }, httpCases.length + index),
      );
      setCases([...httpCases, ...websocketCases]);
    } catch (error) {
      if (loadRequestId.current !== requestId) return;
      setListError(error instanceof Error ? error.message : "测试用例列表加载失败");
    } finally {
      if (loadRequestId.current === requestId) setIsLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void loadCases();
  }, [loadCases]);

  useEffect(() => {
    if (!runFeedback) return;
    const timer = window.setTimeout(() => setRunFeedback(null), 3000);
    return () => window.clearTimeout(timer);
  }, [runFeedback]);

  const loadEnvironmentVariableList = useCallback(async () => {
    if (!projectId || !environmentId) {
      setEnvironmentVariables([]);
      return;
    }
    setIsLoadingVariables(true);
    setVariableListError("");
    try {
      const result = await listEnvironmentVariables(projectId, environmentId);
      setEnvironmentVariables(Array.isArray(result) ? result.map(mapEnvironmentVariable) : []);
    } catch (error) {
      setVariableListError(error instanceof Error ? error.message : "环境变量加载失败");
    } finally {
      setIsLoadingVariables(false);
    }
  }, [environmentId, projectId]);

  const runCase = useCallback(async (apiCase: ApiCase, event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (runningCaseIds.includes(apiCase.id)) return;
    if (!apiCase.backendId) {
      onAction(`${apiCase.name} 尚未保存，无法从列表直接运行`);
      return;
    }
    if (!projectId) {
      onAction("请先选择项目");
      return;
    }
    const executionEnvironmentId = environmentId ?? apiCase.environmentIds[0] ?? apiCase.environmentId;
    if (!executionEnvironmentId && (apiCase.protocol === "http" || !/^wss?:\/\//i.test(apiCase.path))) {
      onAction("请先选择环境");
      return;
    }
    setRunningCaseIds((current) => [...current, apiCase.id]);
    setRunFeedback(null);
    setCases((current) =>
      current.map((item) => (item.id === apiCase.id ? { ...item, lastExecutionStatus: "运行中" } : item)),
    );
    try {
      const result =
        apiCase.protocol === "websocket"
          ? await executeSavedWebSocketTestCase(projectId, apiCase.backendId, executionEnvironmentId)
          : await executeSavedTestCase(projectId, apiCase.backendId, executionEnvironmentId);
      const nextExecutionStatus = formatExecutionStatus(readString(result, ["status"]));
      const durationMs = readNumber(result, ["duration_ms"]);
      const executionError = readString(result, ["error_message", "message"]);
      setCases((current) =>
        current.map((item) =>
          item.id === apiCase.id ? { ...item, lastExecutionStatus: nextExecutionStatus, updatedAt: "刚刚" } : item,
        ),
      );
      const resultMessage = `${apiCase.name} 运行${nextExecutionStatus === "通过" ? "通过" : nextExecutionStatus}${
        durationMs !== undefined ? `，耗时 ${durationMs}ms` : ""
      }${executionError ? `：${executionError}` : ""}`;
      setRunFeedback({
        caseId: apiCase.id,
        caseName: apiCase.name,
        message: resultMessage,
        status: nextExecutionStatus === "通过" ? "success" : "error",
      });
      onAction(resultMessage);
    } catch (error) {
      const message = error instanceof Error ? error.message : "运行失败，请稍后重试";
      setCases((current) =>
        current.map((item) => (item.id === apiCase.id ? { ...item, lastExecutionStatus: "失败", updatedAt: "刚刚" } : item)),
      );
      setRunFeedback({ caseId: apiCase.id, caseName: apiCase.name, message: `${apiCase.name} 运行失败：${message}`, status: "error" });
      onAction(message);
    } finally {
      setRunningCaseIds((current) => current.filter((id) => id !== apiCase.id));
    }
  }, [environmentId, onAction, projectId, runningCaseIds]);

  const openAiExpandModal = useCallback((apiCase: ApiCase, event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (apiCase.protocol === "websocket") {
      onAction("后端暂未提供 WebSocket AI 扩展接口");
      return;
    }
    if (!apiCase.backendId) {
      onAction(`${apiCase.name} 尚未保存，无法扩展`);
      return;
    }
    if (!projectId) {
      onAction("请先选择项目");
      return;
    }
    setAiExpandCase(apiCase);
  }, [onAction, projectId]);

  const requestDeleteCase = useCallback((apiCase: ApiCase, event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (!apiCase.backendId || !projectId || deletingCaseIds.includes(apiCase.id)) return;
    setDeleteCandidate(apiCase);
  }, [deletingCaseIds, projectId]);

  const deleteCase = useCallback(async (apiCase: ApiCase) => {
    if (!apiCase.backendId || !projectId || deletingCaseIds.includes(apiCase.id)) return;
    setDeletingCaseIds((current) => [...current, apiCase.id]);
    try {
      if (apiCase.protocol === "websocket") {
        await deleteWebSocketTestCase(projectId, apiCase.backendId);
      } else {
        await deleteTestCase(projectId, apiCase.backendId);
      }
      setCases((current) => current.filter((item) => item.id !== apiCase.id));
      setRunFeedback({
        caseId: apiCase.id,
        caseName: apiCase.name,
        message: `${apiCase.name} 已删除`,
        status: "success",
      });
      setDeleteCandidate(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "删除失败，请稍后重试";
      setRunFeedback({
        caseId: apiCase.id,
        caseName: apiCase.name,
        message: `${apiCase.name} 删除失败：${message}`,
        status: "error",
      });
    } finally {
      setDeletingCaseIds((current) => current.filter((id) => id !== apiCase.id));
    }
  }, [deletingCaseIds, projectId]);

  const saveCase = useCallback(async (nextCase: ApiCase, mode: EditorMode, payload: AnyTestCaseSavePayload) => {
    if (!projectId) {
      const error = new Error("请先选择项目");
      onAction(error.message);
      throw error;
    }
    if (!environmentId && nextCase.environmentIds.length === 0 && (nextCase.protocol === "http" || !/^wss?:\/\//i.test(nextCase.path))) {
      const error = new Error("请先选择环境");
      onAction(error.message);
      throw error;
    }
    try {
      const savedCase = nextCase.protocol === "websocket"
        ? mode === "create"
          ? await createWebSocketTestCase(projectId, payload as WebSocketTestCaseSavePayload)
          : await updateWebSocketTestCase(projectId, nextCase.backendId ?? nextCase.id, payload as WebSocketTestCaseSavePayload)
        : mode === "create"
          ? await createTestCase(projectId, payload as TestCaseSavePayload)
          : await updateTestCase(projectId, nextCase.backendId ?? nextCase.id, payload as TestCaseSavePayload);
      const mappedCase = savedCase ? mapBackendCase(savedCase, cases.length) : nextCase;
      setCases((current) => {
        const mergedCase = {
          ...mappedCase,
          environmentId: nextCase.environmentId,
          environmentIds: nextCase.environmentIds,
          group: nextCase.group,
          protocol: nextCase.protocol,
          method: nextCase.protocol === "websocket" ? "WS" : mappedCase.method,
          path: nextCase.path,
          subprotocols: nextCase.subprotocols,
          connectTimeoutMs: nextCase.connectTimeoutMs,
          responseTimeoutMs: nextCase.responseTimeoutMs,
          receiveCount: nextCase.receiveCount,
          messages: nextCase.messages,
          extractors: nextCase.extractors,
        };
        if (mode === "create") return [mergedCase, ...current];
        return current.map((item) => (item.id === nextCase.id ? { ...nextCase, ...mergedCase } : item));
      });
      onAction(`${mode === "create" ? "新建" : "保存"} ${nextCase.name}`);
      setEditorState(null);
    } catch (error) {
      onAction(error instanceof Error ? error.message : "保存失败，请稍后重试");
      throw error;
    }
  }, [cases.length, environmentId, onAction, projectId]);

  const saveAiGeneratedCases = useCallback(async (payloads: AnyTestCaseSavePayload[], protocol: CaseProtocol) => {
    if (!projectId) {
      throw new Error("请先选择项目");
    }
    if (payloads.length === 0) {
      throw new Error("请先选择要保存的测试用例");
    }

    const savedCases = await Promise.all(
      payloads.map((payload) =>
        protocol === "websocket"
          ? createWebSocketTestCase(projectId, payload as WebSocketTestCaseSavePayload)
          : createTestCase(projectId, payload as TestCaseSavePayload),
      ),
    );
    setCases((current) => [
      ...savedCases.map((savedCase, index) => {
        const payload = payloads[index];
        return {
          ...mapBackendCase(savedCase, current.length + index),
          environmentId: payload.environment_id,
          environmentIds: payload.environment_ids ?? (payload.environment_id ? [payload.environment_id] : []),
          group: getEnvironmentName(payload.environment_id, environments),
          protocol,
          method: protocol === "websocket" ? "WS" : mapBackendCase(savedCase, current.length + index).method,
        };
      }),
      ...current,
    ]);
    onAction(`AI生成并保存 ${payloads.length} 条测试用例`);
    setAiGenerateModalOpen(false);
    setAiExpandCase(null);
  }, [environments, onAction, projectId]);

  const openVariableModal = () => {
    if (!canCreateVariable) {
      onAction(projectId ? "请先选择环境" : "请先选择项目");
      return;
    }
    setVariableForm({ name: "", value: "", isSecret: false });
    setEditingVariable(null);
    setVariableErrors({});
    setVariableModalOpen(true);
    void loadEnvironmentVariableList();
  };

  const openAiGenerateModal = () => {
    if (!canCreateCase) {
      onAction(projectId ? "请先选择环境" : "请先选择项目");
      return;
    }
    setAiGenerateModalOpen(true);
  };

  const editEnvironmentVariable = (variable: EnvironmentVariableView) => {
    setEditingVariable(variable);
    setVariableForm({ name: variable.name, value: variable.isSecret ? "" : variable.value, isSecret: variable.isSecret });
    setVariableErrors({});
  };

  const resetVariableForm = () => {
    setEditingVariable(null);
    setVariableForm({ name: "", value: "", isSecret: false });
    setVariableErrors({});
  };

  const saveEnvironmentVariable = useCallback(async () => {
    const nextErrors = {
      name: variableForm.name.trim() ? undefined : "请填写变量名",
      value: variableForm.value.trim() ? undefined : "请填写变量值",
    };
    setVariableErrors(nextErrors);
    if (nextErrors.name || nextErrors.value) return;
    if (!projectId || !environmentId) {
      onAction("请先选择项目和环境");
      return;
    }

    setIsSavingVariable(true);
    try {
      const savedVariable = await upsertEnvironmentVariable(projectId, environmentId, {
        name: variableForm.name.trim(),
        value: variableForm.value,
        is_secret: variableForm.isSecret,
      });
      onAction(`${editingVariable ? "保存" : "新增"}环境变量 ${variableForm.name.trim()}`);
      setEnvironmentVariables((current) => {
        const mappedVariable = mapEnvironmentVariable(savedVariable, current.length);
        const exists = current.some((item) => item.id === mappedVariable.id || item.name === mappedVariable.name);
        if (exists) return current.map((item) => (item.id === mappedVariable.id || item.name === mappedVariable.name ? mappedVariable : item));
        return [mappedVariable, ...current];
      });
      resetVariableForm();
    } catch (error) {
      onAction(error instanceof Error ? error.message : "保存环境变量失败，请稍后重试");
    } finally {
      setIsSavingVariable(false);
    }
  }, [editingVariable, environmentId, onAction, projectId, variableForm, loadEnvironmentVariableList]);

  const removeEnvironmentVariable = useCallback(async (variable: EnvironmentVariableView) => {
    if (!projectId || !environmentId) {
      onAction("请先选择项目和环境");
      return;
    }
    setDeletingVariableId(variable.id);
    try {
      await deleteEnvironmentVariable(projectId, environmentId, variable.id);
      setEnvironmentVariables((current) => current.filter((item) => item.id !== variable.id));
      if (editingVariable?.id === variable.id) resetVariableForm();
      onAction(`删除环境变量 ${variable.name}`);
    } catch (error) {
      onAction(error instanceof Error ? error.message : "删除环境变量失败，请稍后重试");
    } finally {
      setDeletingVariableId(null);
    }
  }, [editingVariable?.id, environmentId, onAction, projectId]);

  return (
    <section className="page page-api">
      <div className="api-case-list-panel">
        <div className="page-toolbar">
          <div>
            <h2>接口测试用例列表</h2>
            <p>维护接口定义、请求数据、断言和示例响应，作为自动化测试流程的数据源。</p>
          </div>
          <div className="toolbar-actions">
            <button
              className={statusFilter === "all" ? "seg active" : "seg"}
              onClick={() => setStatusFilter("all")}
              type="button"
            >
              全部
            </button>
            <button
              className={statusFilter === "已启用" ? "seg active" : "seg"}
              onClick={() => setStatusFilter("已启用")}
              type="button"
            >
              已启用
            </button>
            <button
              className={statusFilter === "草稿" ? "seg active" : "seg"}
              onClick={() => setStatusFilter("草稿")}
              type="button"
            >
              草稿
            </button>
            <button className="btn" disabled={!canCreateVariable} onClick={openVariableModal} type="button">
              <Icon name="key" />
              新增变量
            </button>
            <button className="btn ai-generate-btn" disabled={!canCreateCase} onClick={openAiGenerateModal} type="button">
              <Icon name="auto_awesome" />
              AI生成测试用例
            </button>
            <button
              className="btn primary"
              disabled={!canCreateCase}
              onClick={() => setEditorState({ mode: "create", apiCase: createDraftCase(cases.length + 1, environmentId) })}
              type="button"
            >
              <Icon name="add" />
              新建用例
            </button>
            <button
              className="btn websocket-create-btn"
              disabled={!canCreateWebSocketCase}
              onClick={() => setEditorState({ mode: "create", apiCase: createDraftCase(cases.length + 1, environmentId, "websocket") })}
              type="button"
            >
              <Icon name="cable" />
              新建 WebSocket 用例
            </button>
          </div>
        </div>

        <div className="filter-bar api-case-filter-bar">
          <label className="inline-field api-case-title-search">
            <Icon name="search" />
            <input
              onChange={(event) => setCaseTitleQuery(event.target.value)}
              placeholder="按用例标题查询"
              value={caseTitleQuery}
            />
          </label>
          <MethodMultiSelect selectedMethods={methodFilters} onChange={setMethodFilters} />
          {hasActiveFilters && (
            <button
              className="btn filter-clear-btn"
              onClick={() => {
                setCaseTitleQuery("");
                setMethodFilters([]);
                setStatusFilter("all");
              }}
              type="button"
            >
              <Icon name="close" />
              清空筛选
            </button>
          )}
          <span className="filter-summary">
            {hasActiveFilters ? `匹配 ${filteredCases.length} / ${cases.length} 条` : `共 ${cases.length} 条用例`}
          </span>
        </div>

        {runFeedback && (
          <div className={`case-run-feedback ${runFeedback.status}`} role="status">
            <span className="case-run-feedback-icon">
              <Icon name={runFeedback.status === "success" ? "check_circle" : "error"} />
            </span>
            <div>
              <strong>{runFeedback.status === "success" ? "运行完成" : "运行失败"}</strong>
              <span>{runFeedback.message}</span>
            </div>
            <button aria-label="关闭运行结果" className="icon-btn" onClick={() => setRunFeedback(null)} type="button">
              <Icon name="close" />
            </button>
          </div>
        )}

        <table className="data-table api-case-table">
          <thead>
            <tr>
              <th>用例名称</th>
              <th>接口</th>
              <th>用例所属环境</th>
              <th>状态</th>
              <th>最近执行状态</th>
              <th>更新时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr className="table-state-row">
                <td colSpan={7}>
                  <div className="list-state loading">
                    <span className="list-state-icon"><Icon name="progress_activity" /></span>
                    <h4>正在加载测试用例</h4>
                    <p>正在读取当前项目下的接口测试用例数据。</p>
                  </div>
                </td>
              </tr>
            )}
            {!isLoading && listError && (
              <tr className="table-state-row">
                <td colSpan={7}>
                  <div className="list-state error">
                    <span className="list-state-icon"><Icon name={projectId ? "error" : "folder_off"} /></span>
                    <h4>{projectId ? "测试用例加载失败" : "请先选择项目"}</h4>
                    <p>{listError}</p>
                    {projectId && <button className="btn" onClick={() => void loadCases()} type="button">重试</button>}
                  </div>
                </td>
              </tr>
            )}
            {!isLoading && !listError && cases.length === 0 && (
              <tr className="table-state-row">
                <td colSpan={7}>
                  <div className="list-state empty">
                    <span className="list-state-icon"><Icon name="api" /></span>
                    <h4>暂无接口测试用例</h4>
                    <p>
                      {environments.length === 0
                        ? "当前项目还没有环境，请先在环境配置中创建环境后再新增测试用例。"
                        : "新建用例后，可维护请求方法、Params、Headers、Body、断言和示例响应。"}
                    </p>
                    <button
                      className="btn primary"
                      disabled={!canCreateCase}
                      onClick={() => setEditorState({ mode: "create", apiCase: createDraftCase(cases.length + 1, environmentId) })}
                      type="button"
                    >
                      <Icon name="add" />
                      新建用例
                    </button>
                    <button className="btn" disabled={!canCreateVariable} onClick={openVariableModal} type="button">
                      <Icon name="key" />
                      新增变量
                    </button>
                    <button className="btn ai-generate-btn" disabled={!canCreateCase} onClick={openAiGenerateModal} type="button">
                      <Icon name="auto_awesome" />
                      AI生成测试用例
                    </button>
                  </div>
                </td>
              </tr>
            )}
            {!isLoading && !listError && cases.length > 0 && filteredCases.length === 0 && (
              <tr className="table-state-row">
                <td colSpan={7}>
                  <div className="list-state empty">
                    <span className="list-state-icon"><Icon name="manage_search" /></span>
                    <h4>未找到匹配的测试用例</h4>
                    <p>请调整用例标题关键字或请求方式后再查询。</p>
                    <button
                      className="btn"
                      onClick={() => {
                        setCaseTitleQuery("");
                        setMethodFilters([]);
                        setStatusFilter("all");
                      }}
                      type="button"
                    >
                      清空筛选
                    </button>
                  </div>
                </td>
              </tr>
            )}
            {filteredCases.map((item) => (
              <tr className={runningCaseIds.includes(item.id) ? "case-running-row" : ""} key={item.id} onClick={() => setEditorState({ mode: "edit", apiCase: item })}>
                <td>
                  <strong>{item.name}</strong>
                  <small>{item.id}</small>
                </td>
                <td>
                  <span className={`method method-${item.method}`}>{item.method}</span>
                  <code>{item.path}</code>
                  <small className="protocol-label">{protocolLabels[item.protocol]}</small>
                </td>
                <td>
                  <div className="case-environment-tags">
                    {getCaseEnvironmentNames(item).map((name) => (
                      <span className="status environment-status" key={name}>{name}</span>
                    ))}
                  </div>
                </td>
                <td><span className={item.status === "已启用" ? "status status-通过" : "status"}>{item.status}</span></td>
                <td><span className={executionStatusClass(item.lastExecutionStatus)}>{item.lastExecutionStatus}</span></td>
                <td>{item.updatedAt}</td>
                <td>
                  <div className="case-row-actions">
                    <button
                      className={runningCaseIds.includes(item.id) ? "btn run-btn running" : "btn run-btn"}
                      disabled={runningCaseIds.includes(item.id)}
                      onClick={(event) => runCase(item, event)}
                      type="button"
                    >
                      <Icon name={runningCaseIds.includes(item.id) ? "progress_activity" : "play_arrow"} />
                      {runningCaseIds.includes(item.id) ? "运行中..." : "运行"}
                    </button>
                    {item.protocol === "http" && (
                      <button className="btn ai-expand-btn" onClick={(event) => openAiExpandModal(item, event)} type="button">
                        <Icon name="auto_awesome" />
                        AI扩展
                      </button>
                    )}
                    <button
                      className="btn delete-case-btn"
                      disabled={deletingCaseIds.includes(item.id) || runningCaseIds.includes(item.id)}
                      onClick={(event) => requestDeleteCase(item, event)}
                      type="button"
                    >
                      <Icon name="delete" />
                      删除
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {aiGenerateModalOpen && (
        <AiGenerateCaseModal
          environmentId={environmentId}
          environments={environments}
          onClose={() => setAiGenerateModalOpen(false)}
          onSaveGenerated={saveAiGeneratedCases}
          projectId={projectId}
        />
      )}
      {aiExpandCase && (
        <AiExpandCaseModal
          apiCase={aiExpandCase}
          environmentId={environmentId}
          onClose={() => setAiExpandCase(null)}
          onSaveGenerated={saveAiGeneratedCases}
          projectId={projectId}
        />
      )}
      {editorState && (
        <ApiCaseEditorModal
          apiCase={editorState.apiCase}
          mode={editorState.mode}
          onClose={() => setEditorState(null)}
          onDebugAction={onAction}
          environmentId={environmentId}
          environments={environments}
          environmentVariableOptions={environmentVariableOptions}
          onLoadVariableOptions={loadEnvironmentVariableList}
          projectId={projectId}
          onSave={saveCase}
        />
      )}
      {variableModalOpen && (
        <EnvironmentVariableModal
          deletingVariableId={deletingVariableId}
          editingVariable={editingVariable}
          errors={variableErrors}
          form={variableForm}
          isLoadingVariables={isLoadingVariables}
          isSaving={isSavingVariable}
          onChange={(nextForm) => {
            setVariableForm(nextForm);
            setVariableErrors((current) => ({
              name: nextForm.name.trim() ? undefined : current.name,
              value: nextForm.value.trim() ? undefined : current.value,
            }));
          }}
          onCancelEdit={resetVariableForm}
          onClose={() => setVariableModalOpen(false)}
          onDelete={(variable) => void removeEnvironmentVariable(variable)}
          onEdit={editEnvironmentVariable}
          onReload={loadEnvironmentVariableList}
          onSave={() => void saveEnvironmentVariable()}
          variableListError={variableListError}
          variables={environmentVariables}
        />
      )}
      {deleteCandidate && (
        <div className="modal-backdrop" role="presentation">
          <section
            aria-labelledby="delete-case-dialog-title"
            aria-modal="true"
            className="delete-case-confirm-modal"
            role="dialog"
          >
            <div className="delete-case-confirm-icon">
              <Icon name="delete" />
            </div>
            <div>
              <span className="eyebrow">删除确认</span>
              <h3 id="delete-case-dialog-title">确认删除该测试用例？</h3>
              <p>
                即将删除“{deleteCandidate.name}”。删除后无法恢复，请确认是否继续。
              </p>
            </div>
            <div className="modal-actions">
              <button
                className="btn"
                disabled={deletingCaseIds.includes(deleteCandidate.id)}
                onClick={() => setDeleteCandidate(null)}
                type="button"
              >
                取消
              </button>
              <button
                className="btn danger"
                disabled={deletingCaseIds.includes(deleteCandidate.id)}
                onClick={() => void deleteCase(deleteCandidate)}
                type="button"
              >
                <Icon name={deletingCaseIds.includes(deleteCandidate.id) ? "progress_activity" : "delete"} />
                {deletingCaseIds.includes(deleteCandidate.id) ? "删除中..." : "确认删除"}
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}

function MethodMultiSelect({
  onChange,
  selectedMethods,
}: {
  onChange: (methods: string[]) => void;
  selectedMethods: string[];
}) {
  const [open, setOpen] = useState(false);
  const selectedSet = useMemo(() => new Set(selectedMethods), [selectedMethods]);
  const label =
    selectedMethods.length === 0
      ? "全部请求方式"
      : selectedMethods.length === 1
        ? selectedMethods[0]
        : `已选 ${selectedMethods.length} 项`;

  const toggleMethod = (method: string) => {
    onChange(selectedSet.has(method) ? selectedMethods.filter((item) => item !== method) : [...selectedMethods, method]);
  };

  return (
    <div className="api-method-multi-select">
      <button
        aria-expanded={open}
        aria-label="请求方式"
        className="api-method-filter"
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <span>{label}</span>
        <Icon name="keyboard_arrow_down" />
      </button>
      {open && (
        <div className="api-method-menu">
          <button className="method-option all-option" onMouseDown={(event) => event.preventDefault()} onClick={() => onChange([])} type="button">
            <span className={selectedMethods.length === 0 ? "option-check active" : "option-check"}>
              <Icon name="check" />
            </span>
            全部请求方式
          </button>
          {requestMethods.map((method) => (
            <button
              className="method-option"
              key={method}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => toggleMethod(method)}
              type="button"
            >
              <span className={selectedSet.has(method) ? "option-check active" : "option-check"}>
                <Icon name="check" />
              </span>
              <span className={`method method-${method}`}>{method}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function toStringRecord(value: unknown) {
  return Object.entries(readObject(value)).reduce<Record<string, string>>((record, [key, item]) => {
    record[key] = typeof item === "string" ? item : JSON.stringify(item);
    return record;
  }, {});
}

function normalizeGeneratedCase(
  item: AnyTestCaseSavePayload,
  environmentId: number,
  protocol: CaseProtocol,
): AnyTestCaseSavePayload {
  if (protocol === "websocket") {
    const websocketItem = item as WebSocketTestCaseSavePayload;
    return {
      name: websocketItem.name?.trim() || "AI生成 WebSocket 测试用例",
      description: websocketItem.description ?? "",
      environment_id: websocketItem.environment_id || environmentId,
      environment_ids: websocketItem.environment_ids?.length ? websocketItem.environment_ids : [environmentId],
      path: websocketItem.path || "/",
      headers: toStringRecord(websocketItem.headers),
      subprotocols: Array.isArray(websocketItem.subprotocols) ? websocketItem.subprotocols.map(String) : [],
      connect_timeout_ms: websocketItem.connect_timeout_ms || 5000,
      receive_timeout_ms: websocketItem.receive_timeout_ms || 10000,
      receive_count: websocketItem.receive_count || 1,
      messages: Array.isArray(websocketItem.messages) ? websocketItem.messages : [],
      assertions: Array.isArray(websocketItem.assertions) ? websocketItem.assertions : [],
      extractors: Array.isArray(websocketItem.extractors) ? websocketItem.extractors : [],
    };
  }

  const httpItem = item as TestCaseSavePayload;
  const method = String(httpItem.method || "GET").toUpperCase();
  const normalizedMethod = httpMethods.includes(method as (typeof httpMethods)[number]) ? method : "GET";
  const bodyTypes: TestCaseRequestPayload["body_type"][] = [
    "none",
    "json",
    "form_urlencoded",
    "multipart",
    "raw_text",
    "raw_json",
  ];
  const bodyType = bodyTypes.includes(httpItem.body_type) ? httpItem.body_type : "none";
  const environmentIds = httpItem.environment_ids?.length ? httpItem.environment_ids : [environmentId];

  return {
    name: httpItem.name?.trim() || "AI生成测试用例",
    description: httpItem.description ?? "",
    environment_id: httpItem.environment_id || environmentId,
    environment_ids: environmentIds,
    method: normalizedMethod,
    path: httpItem.path || "/",
    headers: toStringRecord(httpItem.headers),
    query_params: toStringRecord(httpItem.query_params),
    body_type: bodyType,
    body: httpItem.body ?? null,
    assertions: Array.isArray(httpItem.assertions) ? httpItem.assertions : [],
    extractors: Array.isArray(httpItem.extractors) ? httpItem.extractors : [],
  };
}

function formatGeneratedPreview(value: unknown) {
  if (value === null || value === undefined) return "-";
  if (typeof value === "string") return value.trim() || "-";
  if (Array.isArray(value)) return value.length > 0 ? JSON.stringify(value, null, 2) : "[]";
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    return entries.length > 0 ? JSON.stringify(value, null, 2) : "{}";
  }
  return String(value);
}

function getGeneratedCaseDetail(item: AnyTestCaseSavePayload, protocol: CaseProtocol) {
  const params = formatGeneratedPreview("query_params" in item ? item.query_params : {});
  const headers = formatGeneratedPreview(item.headers);
  const body = formatGeneratedPreview(protocol === "websocket" ? (item as WebSocketTestCaseSavePayload).messages : (item as TestCaseSavePayload).body);
  const assertions = Array.isArray(item.assertions) ? item.assertions : [];
  return [
    { label: "Params", value: params },
    { label: "Headers", value: headers },
    { label: protocol === "websocket" ? "发送消息" : "Body", value: body },
    { label: "断言", value: assertions.length > 0 ? formatGeneratedPreview(assertions) : "未生成断言" },
  ];
}

function getGeneratedCaseMethod(item: AnyTestCaseSavePayload, protocol: CaseProtocol) {
  return protocol === "websocket" ? "WS" : String((item as TestCaseSavePayload).method || "GET").toUpperCase();
}

function getGeneratedCasePath(item: AnyTestCaseSavePayload, protocol: CaseProtocol) {
  return protocol === "websocket"
    ? (item as WebSocketTestCaseSavePayload).path || "/"
    : (item as TestCaseSavePayload).path || "/";
}

function AiGenerateCaseModal({
  environmentId,
  environments,
  onClose,
  onSaveGenerated,
  projectId,
}: {
  environmentId?: number;
  environments: EnvironmentOption[];
  onClose: () => void;
  onSaveGenerated: (cases: AnyTestCaseSavePayload[], protocol: CaseProtocol) => Promise<void>;
  projectId?: number;
}) {
  const [sourceText, setSourceText] = useState("");
  const [caseCount, setCaseCount] = useState(3);
  const [method, setMethod] = useState("自动识别");
  const protocol: CaseProtocol = "http";
  const [includeAssertions, setIncludeAssertions] = useState(true);
  const [extraRequirements, setExtraRequirements] = useState("");
  const [generateResult, setGenerateResult] = useState<AiTestCaseGenerateResult | null>(null);
  const [selectedCaseIndexes, setSelectedCaseIndexes] = useState<number[]>([]);
  const [message, setMessage] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const currentEnvironment = environments.find((item) => item.id === environmentId);
  const selectedCaseSet = useMemo(() => new Set(selectedCaseIndexes), [selectedCaseIndexes]);
  const normalizedCount = Math.min(10, Math.max(1, Number.isFinite(caseCount) ? caseCount : 3));

  const generatedCases = generateResult?.cases ?? [];
  const toggleGeneratedCase = (index: number) => {
    setSelectedCaseIndexes((current) =>
      current.includes(index) ? current.filter((item) => item !== index) : [...current, index],
    );
  };

  const generateCases = async () => {
    if (!projectId || !environmentId) {
      setMessage("请先选择项目和环境");
      return;
    }
    if (!sourceText.trim()) {
      setMessage("请先填写接口信息");
      return;
    }

    setIsGenerating(true);
    setMessage("");
    setGenerateResult(null);
    try {
      const result = await generateAiTestCases(projectId, environmentId, {
        interface_text: sourceText.trim(),
        request_method: protocol === "http" && method !== "自动识别" ? method : undefined,
        generate_count: normalizedCount,
        include_assertions: includeAssertions,
        extra_requirements: extraRequirements.trim() || undefined,
      });
      setGenerateResult(result);
      setSelectedCaseIndexes(result.cases.map((_, index) => index));
      setMessage(result.cases.length > 0 ? `已生成 ${result.cases.length} 条测试用例草稿` : "AI 未返回可用测试用例");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "AI生成测试用例失败，请稍后重试");
    } finally {
      setIsGenerating(false);
    }
  };

  const saveSelectedCases = async () => {
    if (!environmentId) {
      setMessage("请先选择环境");
      return;
    }
    const selectedCases = generatedCases.filter((_, index) => selectedCaseSet.has(index));
    if (selectedCases.length === 0) {
      setMessage("请至少选择一条测试用例");
      return;
    }

    setIsSaving(true);
    setMessage("");
    try {
      await onSaveGenerated(selectedCases.map((item) => normalizeGeneratedCase(item, environmentId, protocol)), protocol);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存AI生成用例失败，请稍后重试");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <div aria-modal="true" className="ai-generate-modal" role="dialog">
        <div className="modal-head">
          <div>
            <span className="eyebrow">AI生成测试用例</span>
            <h3>生成接口测试用例</h3>
            <p>{currentEnvironment ? `当前环境：${currentEnvironment.name}` : "请选择环境后生成"}</p>
          </div>
          <button className="icon-btn" onClick={onClose} type="button">
            <Icon name="close" />
          </button>
        </div>

        <div className="ai-generate-grid">
          <label className="modal-field ai-generate-source">
            <span>接口信息</span>
            <textarea
              autoFocus
              onChange={(event) => setSourceText(event.target.value)}
              placeholder="粘贴接口文档、curl、URL、请求参数或业务说明"
              value={sourceText}
            />
          </label>
          <label className="modal-field ai-generate-source">
            <span>额外要求</span>
            <textarea
              className="ai-extra-requirements"
              onChange={(event) => setExtraRequirements(event.target.value)}
              placeholder="例如：覆盖成功、参数缺失、权限失败、边界值，优先使用环境变量"
              value={extraRequirements}
            />
          </label>
          <label className="modal-field">
            <span>请求方式</span>
            <select onChange={(event) => setMethod(event.target.value)} value={method}>
              <option>自动识别</option>
              {httpMethods.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
          <label className="modal-field">
            <span>生成数量</span>
            <input
              max={20}
              min={1}
              onChange={(event) => setCaseCount(Number(event.target.value))}
              type="number"
              value={caseCount}
            />
          </label>
          <label className="ai-generate-toggle">
            <input
              checked={includeAssertions}
              onChange={(event) => setIncludeAssertions(event.target.checked)}
              type="checkbox"
            />
            生成断言
          </label>
        </div>

        {message && <p className="form-message">{message}</p>}

        {isGenerating && (
          <div className="ai-generate-waiting">
            <span className="ai-spinner" aria-hidden="true">
              <Icon name="auto_awesome" />
            </span>
            <strong>AI 正在生成测试用例</strong>
            <p>正在分析接口资料、请求参数和断言建议，请稍候...</p>
          </div>
        )}

        {generateResult && (
          <div className="ai-generate-result">
            <div className="ai-generate-result-head">
              <div>
                <strong>生成结果</strong>
                <span>{generateResult.source_summary || "AI 已返回测试用例草稿"}</span>
              </div>
              <button
                className="btn"
                onClick={() =>
                  setSelectedCaseIndexes(
                    selectedCaseIndexes.length === generatedCases.length ? [] : generatedCases.map((_, index) => index),
                  )
                }
                type="button"
              >
                {selectedCaseIndexes.length === generatedCases.length ? "取消全选" : "全选"}
              </button>
            </div>
            {generateResult.warnings && generateResult.warnings.length > 0 && (
              <div className="ai-generate-warnings">
                {generateResult.warnings.map((warning) => (
                  <span key={warning}>{warning}</span>
                ))}
              </div>
            )}
            <div className="ai-generated-case-list">
              {generatedCases.map((item, index) => (
                <button
                  className={selectedCaseSet.has(index) ? "ai-generated-case selected" : "ai-generated-case"}
                  key={`${item.name}-${index}`}
                  onClick={() => toggleGeneratedCase(index)}
                  type="button"
                >
                  <span className={selectedCaseSet.has(index) ? "option-check active" : "option-check"}>
                    <Icon name="check" />
                  </span>
                  <div>
                    <strong>{item.name || `AI生成用例 ${index + 1}`}</strong>
                    <small>{item.description || "暂无描述"}</small>
                  </div>
                  <span className={`method method-${getGeneratedCaseMethod(item, protocol)}`}>
                    {getGeneratedCaseMethod(item, protocol)}
                  </span>
                  <code>{getGeneratedCasePath(item, protocol)}</code>
                  <div className="ai-generated-case-details">
                    {getGeneratedCaseDetail(item, protocol).map((detail) => (
                      <div className="ai-generated-case-detail" key={detail.label}>
                        <span>{detail.label}</span>
                        <pre>{detail.value}</pre>
                      </div>
                    ))}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="modal-actions">
          <button className="btn" onClick={onClose} type="button">取消</button>
          <button className={isGenerating ? "btn generating" : "btn"} disabled={!sourceText.trim() || isGenerating || isSaving} onClick={generateCases} type="button">
            <Icon name={isGenerating ? "progress_activity" : "auto_awesome"} />
            {isGenerating ? "生成中..." : "生成"}
          </button>
          <button className="btn primary" disabled={generatedCases.length === 0 || isGenerating || isSaving} onClick={saveSelectedCases} type="button">
            <Icon name="save" />
            {isSaving ? "保存中..." : "保存所选用例"}
          </button>
        </div>
      </div>
    </div>
  );
}

const expansionTypeOptions = [
  { id: "empty_value", label: "空值" },
  { id: "invalid_type", label: "类型错误" },
  { id: "missing_param", label: "缺少参数" },
  { id: "extra_param", label: "额外参数" },
  { id: "length_overflow", label: "长度溢出" },
  { id: "invalid_format", label: "格式错误" },
];

function AiExpandCaseModal({
  apiCase,
  environmentId,
  onClose,
  onSaveGenerated,
  projectId,
}: {
  apiCase: ApiCase;
  environmentId?: number;
  onClose: () => void;
  onSaveGenerated: (cases: AnyTestCaseSavePayload[], protocol: CaseProtocol) => Promise<void>;
  projectId?: number;
}) {
  const [requirement, setRequirement] = useState(
    "围绕当前接口扩写边界值、异常参数和负向业务场景，保持 method、path、headers 和 body_type 不变。",
  );
  const [caseCount, setCaseCount] = useState(5);
  const [includeAssertions, setIncludeAssertions] = useState(true);
  const [expansionTypes, setExpansionTypes] = useState<string[]>([
    "empty_value",
    "invalid_type",
    "missing_param",
    "length_overflow",
  ]);
  const [generateResult, setGenerateResult] = useState<AiTestCaseGenerateResult | null>(null);
  const [selectedCaseIndexes, setSelectedCaseIndexes] = useState<number[]>([]);
  const [message, setMessage] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const selectedCaseSet = useMemo(() => new Set(selectedCaseIndexes), [selectedCaseIndexes]);
  const generatedCases = generateResult?.cases ?? [];
  const normalizedCount = Math.min(10, Math.max(1, Number.isFinite(caseCount) ? caseCount : 5));

  const toggleExpansionType = (type: string) => {
    setExpansionTypes((current) =>
      current.includes(type) ? current.filter((item) => item !== type) : [...current, type],
    );
  };

  const toggleGeneratedCase = (index: number) => {
    setSelectedCaseIndexes((current) =>
      current.includes(index) ? current.filter((item) => item !== index) : [...current, index],
    );
  };

  const expandCases = async () => {
    if (!projectId) {
      setMessage("请先选择项目");
      return;
    }
    if (!apiCase.backendId) {
      setMessage("当前用例尚未保存，无法扩展");
      return;
    }
    if (!requirement.trim()) {
      setMessage("请填写扩写要求");
      return;
    }

    setIsGenerating(true);
    setMessage("");
    setGenerateResult(null);
    try {
      const payload: AiTestCaseExpandPayload = {
        requirement: requirement.trim(),
        generate_count: normalizedCount,
        expansion_types: expansionTypes,
        include_assertions: includeAssertions,
      };
      const result = await expandAiTestCase(projectId, apiCase.backendId, payload, environmentId);
      setGenerateResult(result);
      setSelectedCaseIndexes(result.cases.map((_, index) => index));
      setMessage(result.cases.length > 0 ? `已扩展 ${result.cases.length} 条测试用例草稿` : "AI 未返回可用扩展用例");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "AI扩展测试用例失败，请稍后重试");
    } finally {
      setIsGenerating(false);
    }
  };

  const saveSelectedCases = async () => {
    const targetEnvironmentId = environmentId ?? apiCase.environmentId ?? apiCase.environmentIds[0];
    if (!targetEnvironmentId) {
      setMessage("请先选择环境");
      return;
    }
    const selectedCases = generatedCases.filter((_, index) => selectedCaseSet.has(index));
    if (selectedCases.length === 0) {
      setMessage("请至少选择一条扩展用例");
      return;
    }

    setIsSaving(true);
    setMessage("");
    try {
      await onSaveGenerated(
        selectedCases.map((item) => normalizeGeneratedCase(item, targetEnvironmentId, apiCase.protocol)),
        apiCase.protocol,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存AI扩展用例失败，请稍后重试");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <div aria-modal="true" className="ai-generate-modal" role="dialog">
        <div className="modal-head">
          <div>
            <span className="eyebrow">AI扩展测试用例</span>
            <h3>{apiCase.name}</h3>
            <p>{apiCase.method} {apiCase.path}</p>
          </div>
          <button className="icon-btn" onClick={onClose} type="button">
            <Icon name="close" />
          </button>
        </div>

        <div className="ai-generate-grid">
          <label className="modal-field ai-generate-source">
            <span>扩写要求</span>
            <textarea
              autoFocus
              className="ai-extra-requirements"
              onChange={(event) => setRequirement(event.target.value)}
              placeholder="例如：扩写空值、类型错误、缺少参数、超长字段、日期格式错误等场景"
              value={requirement}
            />
          </label>
          <div className="ai-compact-controls">
            <label className="modal-field">
              <span>扩写数量</span>
              <input
                max={10}
                min={1}
                onChange={(event) => setCaseCount(Number(event.target.value))}
                type="number"
                value={caseCount}
              />
            </label>
            <label className="ai-generate-toggle compact">
              <input
                checked={includeAssertions}
                onChange={(event) => setIncludeAssertions(event.target.checked)}
                type="checkbox"
              />
              <span>生成断言</span>
            </label>
          </div>
          <div className="ai-expansion-types">
            {expansionTypeOptions.map((item) => (
              <button
                className={expansionTypes.includes(item.id) ? "ai-expansion-chip selected" : "ai-expansion-chip"}
                key={item.id}
                onClick={() => toggleExpansionType(item.id)}
                type="button"
              >
                <span className={expansionTypes.includes(item.id) ? "option-check active" : "option-check"}>
                  <Icon name="check" />
                </span>
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {message && <p className="form-message">{message}</p>}

        {isGenerating && (
          <div className="ai-generate-waiting">
            <span className="ai-spinner" aria-hidden="true">
              <Icon name="auto_awesome" />
            </span>
            <strong>AI 正在扩展测试用例</strong>
            <p>正在基于源用例生成边界、异常和负向场景，请稍候...</p>
          </div>
        )}

        {generateResult && (
          <div className="ai-generate-result">
            <div className="ai-generate-result-head">
              <div>
                <strong>扩展结果</strong>
                <span>{generateResult.source_summary || "AI 已返回扩展用例草稿"}</span>
              </div>
              <button
                className="btn"
                onClick={() =>
                  setSelectedCaseIndexes(
                    selectedCaseIndexes.length === generatedCases.length ? [] : generatedCases.map((_, index) => index),
                  )
                }
                type="button"
              >
                {selectedCaseIndexes.length === generatedCases.length ? "取消全选" : "全选"}
              </button>
            </div>
            {generateResult.warnings && generateResult.warnings.length > 0 && (
              <div className="ai-generate-warnings">
                {generateResult.warnings.map((warning) => (
                  <span key={warning}>{warning}</span>
                ))}
              </div>
            )}
            <div className="ai-generated-case-list">
              {generatedCases.map((item, index) => (
                <button
                  className={selectedCaseSet.has(index) ? "ai-generated-case selected" : "ai-generated-case"}
                  key={`${item.name}-${index}`}
                  onClick={() => toggleGeneratedCase(index)}
                  type="button"
                >
                  <span className={selectedCaseSet.has(index) ? "option-check active" : "option-check"}>
                    <Icon name="check" />
                  </span>
                  <div>
                    <strong>{item.name || `AI扩展用例 ${index + 1}`}</strong>
                    <small>{item.description || "暂无描述"}</small>
                  </div>
                  <span className={`method method-${getGeneratedCaseMethod(item, apiCase.protocol)}`}>
                    {getGeneratedCaseMethod(item, apiCase.protocol)}
                  </span>
                  <code>{getGeneratedCasePath(item, apiCase.protocol) || apiCase.path}</code>
                  <div className="ai-generated-case-details">
                    {getGeneratedCaseDetail(item, apiCase.protocol).map((detail) => (
                      <div className="ai-generated-case-detail" key={detail.label}>
                        <span>{detail.label}</span>
                        <pre>{detail.value}</pre>
                      </div>
                    ))}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="modal-actions">
          <button className="btn" onClick={onClose} type="button">取消</button>
          <button className={isGenerating ? "btn generating" : "btn"} disabled={!requirement.trim() || isGenerating || isSaving} onClick={expandCases} type="button">
            <Icon name={isGenerating ? "progress_activity" : "auto_awesome"} />
            {isGenerating ? "扩展中..." : "扩展"}
          </button>
          <button className="btn primary" disabled={generatedCases.length === 0 || isGenerating || isSaving} onClick={saveSelectedCases} type="button">
            <Icon name="save" />
            {isSaving ? "保存中..." : "保存所选用例"}
          </button>
        </div>
      </div>
    </div>
  );
}

function EnvironmentVariableModal({
  deletingVariableId,
  editingVariable,
  errors,
  form,
  isLoadingVariables,
  isSaving,
  onChange,
  onCancelEdit,
  onClose,
  onDelete,
  onEdit,
  onReload,
  onSave,
  variableListError,
  variables,
}: {
  deletingVariableId: string | null;
  editingVariable: EnvironmentVariableView | null;
  errors: { name?: string; value?: string };
  form: VariableFormState;
  isLoadingVariables: boolean;
  isSaving: boolean;
  onChange: (form: VariableFormState) => void;
  onCancelEdit: () => void;
  onClose: () => void;
  onDelete: (variable: EnvironmentVariableView) => void;
  onEdit: (variable: EnvironmentVariableView) => void;
  onReload: () => void;
  onSave: () => void;
  variableListError: string;
  variables: EnvironmentVariableView[];
}) {
  return (
    <div className="modal-backdrop" role="presentation">
      <div aria-modal="true" className="environment-variable-modal" role="dialog">
        <div className="modal-head">
          <div>
            <span className="eyebrow">环境变量</span>
            <h3>{editingVariable ? "编辑环境变量" : "新增环境变量"}</h3>
            <p>变量可在接口请求中通过 {"{{变量名}}"} 引用。</p>
          </div>
          <button aria-label="关闭" className="icon-btn" onClick={onClose} type="button">
            <Icon name="close" />
          </button>
        </div>

        <div className="environment-variable-grid">
          <label className={errors.name ? "modal-field invalid" : "modal-field"}>
            <span>变量名</span>
            <input
              autoFocus
              disabled={Boolean(editingVariable)}
              onChange={(event) => onChange({ ...form, name: event.target.value })}
              placeholder="例如 access_token"
              value={form.name}
            />
            {errors.name && <b className="field-error">{errors.name}</b>}
          </label>
          <label className={errors.value ? "modal-field invalid" : "modal-field"}>
            <span>变量值</span>
            <input
              onChange={(event) => onChange({ ...form, value: event.target.value })}
              placeholder={editingVariable?.isSecret ? "敏感变量请重新输入变量值" : "例如 Bearer token"}
              value={form.value}
            />
            {errors.value && <b className="field-error">{errors.value}</b>}
          </label>
          <label className="variable-secret-toggle">
            <input
              checked={form.isSecret}
              onChange={(event) => onChange({ ...form, isSecret: event.target.checked })}
              type="checkbox"
            />
            <span>敏感变量</span>
          </label>
        </div>

        <div className="environment-variable-list-section">
          <div className="environment-variable-list-head">
            <div>
              <strong>已有变量</strong>
              <span>{variables.length} 个变量</span>
            </div>
            <button className="btn" disabled={isLoadingVariables} onClick={onReload} type="button">
              <Icon name="refresh" />
              刷新
            </button>
          </div>
          {isLoadingVariables && <p className="variable-list-state">正在加载环境变量...</p>}
          {!isLoadingVariables && variableListError && <p className="variable-list-state error">{variableListError}</p>}
          {!isLoadingVariables && !variableListError && variables.length === 0 && (
            <p className="variable-list-state">暂无变量，保存后可在这里查看。</p>
          )}
          {!isLoadingVariables && !variableListError && variables.length > 0 && (
            <div className="environment-variable-list">
              {variables.map((item) => (
                <div className="environment-variable-item" key={item.id}>
                  <div>
                    <strong>{item.name}</strong>
                    <code>{item.isSecret ? "******" : item.value || "-"}</code>
                  </div>
                  {item.isSecret && <span>敏感</span>}
                  <div className="environment-variable-actions">
                    <button className="icon-btn" onClick={() => onEdit(item)} title="编辑变量" type="button">
                      <Icon name="edit" />
                    </button>
                    <button
                      className="icon-btn danger"
                      disabled={deletingVariableId === item.id}
                      onClick={() => onDelete(item)}
                      title="删除变量"
                      type="button"
                    >
                      <Icon name="delete" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="modal-actions">
          {editingVariable && <button className="btn" onClick={onCancelEdit} type="button">取消编辑</button>}
          <button className="btn" onClick={onClose} type="button">取消</button>
          <button className="btn primary" disabled={isSaving} onClick={onSave} type="button">
            <Icon name="save" />
            {isSaving ? "保存中..." : editingVariable ? "保存修改" : "保存变量"}
          </button>
        </div>
      </div>
    </div>
  );
}

function DebugResponsePanel({ result }: { result: DebugExecutionView }) {
  const [activeDebugTab, setActiveDebugTab] = useState<DebugResponseTab>("body");
  const [formattedResponseBody, setFormattedResponseBody] = useState(result.responseBody);
  const [formatMessage, setFormatMessage] = useState("");
  const statusClass =
    String(result.statusCode ?? "").startsWith("2") || result.status === "passed" ? "passed" : "failed";
  const debugTabs: Array<{ id: DebugResponseTab; label: string; content: string }> = [
    { id: "request", label: "请求快照", content: result.requestSnapshot },
    { id: "headers", label: "响应头", content: result.responseHeaders },
    { id: "body", label: "响应 Body", content: formattedResponseBody },
    { id: "assertions", label: "断言结果", content: result.assertionResults },
  ];
  const activeDebugContent = debugTabs.find((item) => item.id === activeDebugTab) ?? debugTabs[0];
  const canFormatResponseBody = (() => {
    try {
      JSON.parse(formattedResponseBody);
      return true;
    } catch {
      return false;
    }
  })();

  useEffect(() => {
    setFormattedResponseBody(result.responseBody);
    setFormatMessage("");
  }, [result.responseBody]);

  const formatResponseBody = () => {
    try {
      setFormattedResponseBody(JSON.stringify(JSON.parse(formattedResponseBody), null, 2));
      setFormatMessage("JSON 已格式化");
    } catch (error) {
      setFormatMessage(error instanceof Error ? `无法格式化：${error.message}` : "响应内容不是有效 JSON");
    }
  };

  return (
    <div className="debug-response-panel">
      <div className="debug-response-head">
        <div>
          <span className="eyebrow">执行响应</span>
          <h4>本次调试结果</h4>
        </div>
        <div className="debug-response-metrics">
          {result.statusCode && <b className={`debug-status ${statusClass}`}>HTTP {result.statusCode}</b>}
          {result.status && <b>{result.status}</b>}
          {result.durationMs && <b>{result.durationMs}ms</b>}
        </div>
      </div>
      {result.errorMessage && <p className="debug-error">{result.errorMessage}</p>}
      <div className="debug-response-tabs" role="tablist" aria-label="执行响应明细">
        {debugTabs.map((item) => (
          <button
            aria-selected={activeDebugTab === item.id}
            className={activeDebugTab === item.id ? "active" : ""}
            key={item.id}
            onClick={() => setActiveDebugTab(item.id)}
            role="tab"
            type="button"
          >
            {item.label}
          </button>
        ))}
      </div>
      <div
        className={`debug-code-block debug-tab-panel${
          activeDebugContent.id === "assertions" ? ` assertion-result-panel ${result.assertionStatus}` : ""
        }`}
        role="tabpanel"
      >
        <div className="code-editor-toolbar">
          <div>
            <span>{activeDebugContent.label}</span>
            {activeDebugContent.id === "body" && (
              <small className={canFormatResponseBody ? "json-valid" : "json-plain"}>
                {formatMessage || (canFormatResponseBody ? "有效 JSON" : "文本响应")}
              </small>
            )}
          </div>
          {activeDebugContent.id === "body" && canFormatResponseBody && (
            <button className="json-format-btn" onClick={formatResponseBody} type="button">
              <Icon name="data_object" />
              格式化 JSON
            </button>
          )}
        </div>
        <pre>{activeDebugContent.content}</pre>
      </div>
      {result.createdAt && <small className="debug-created-at">执行时间：{result.createdAt}</small>}
    </div>
  );
}

function ApiCaseEditorModal({
  apiCase,
  environmentId,
  environments,
  environmentVariableOptions,
  mode,
  onClose,
  onDebugAction,
  onLoadVariableOptions,
  projectId,
  onSave,
}: {
  apiCase: ApiCase;
  environmentId?: number;
  environments: EnvironmentOption[];
  environmentVariableOptions: string[];
  mode: EditorMode;
  onClose: () => void;
  onDebugAction: ActionHandler;
  onLoadVariableOptions: () => void;
  projectId?: number;
  onSave: (nextCase: ApiCase, mode: EditorMode, payload: AnyTestCaseSavePayload) => Promise<void>;
}) {
  const [name, setName] = useState(apiCase.name);
  const initialEnvironmentId = apiCase.environmentIds[0] ?? environmentId;
  const [selectedEnvironmentIds, setSelectedEnvironmentIds] = useState<number[]>(
    apiCase.environmentIds.length > 0 ? apiCase.environmentIds : environmentId ? [environmentId] : [],
  );
  const [status, setStatus] = useState<ApiCase["status"]>(apiCase.status);
  const [method, setMethod] = useState(apiCase.method);
  const [url, setUrl] = useState(() =>
    buildCaseEditorUrl(
      apiCase,
      environments.find((item) => item.id === initialEnvironmentId),
    ),
  );
  const isAutoComposedUrl = useRef(
    Boolean(apiCase.path) && !/^(?:https?|wss?):\/\//i.test(apiCase.path) && !apiCase.path.startsWith("{{"),
  );
  const [activeTab, setActiveTab] = useState<EditorTab>(apiCase.protocol === "websocket" ? "message" : "params");
  const [params, setParams] = useState<KeyValueRow[]>(apiCase.params ?? []);
  const [headers, setHeaders] = useState<KeyValueRow[]>(apiCase.headers ?? []);
  const [bodyType, setBodyType] = useState<BodyType>(apiCase.bodyType ?? "JSON");
  const [jsonBody, setJsonBody] = useState(apiCase.jsonBody ?? "");
  const [formBody, setFormBody] = useState<KeyValueRow[]>(apiCase.formBody ?? []);
  const [urlEncodedBody, setUrlEncodedBody] = useState<KeyValueRow[]>(
    apiCase.urlEncodedBody ?? [],
  );
  const [rawBody, setRawBody] = useState(apiCase.rawBody ?? "");
  const [subprotocols, setSubprotocols] = useState((apiCase.subprotocols ?? []).join(", "));
  const [connectTimeoutMs, setConnectTimeoutMs] = useState(apiCase.connectTimeoutMs ?? 5000);
  const [responseTimeoutMs, setResponseTimeoutMs] = useState(apiCase.responseTimeoutMs ?? 10000);
  const [receiveCount, setReceiveCount] = useState(apiCase.receiveCount ?? 1);
  const [webSocketMessages, setWebSocketMessages] = useState(JSON.stringify(apiCase.messages ?? [], null, 2));
  const [webSocketExtractors, setWebSocketExtractors] = useState(JSON.stringify(apiCase.extractors ?? [], null, 2));
  const [assertions, setAssertions] = useState(apiCase.assertions ?? []);
  const [exampleResponse, setExampleResponse] = useState(apiCase.exampleResponse ?? "");
  const [debugResult, setDebugResult] = useState<DebugExecutionView | null>(null);
  const [isDebugging, setIsDebugging] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [debugMessage, setDebugMessage] = useState("");
  const [liveWebSocketStatus, setLiveWebSocketStatus] = useState<LiveWebSocketStatus>("disconnected");
  const [liveWebSocketMessageType, setLiveWebSocketMessageType] = useState<"text" | "json">("text");
  const [liveWebSocketMessage, setLiveWebSocketMessage] = useState("");
  const [liveWebSocketLogs, setLiveWebSocketLogs] = useState<LiveWebSocketLog[]>([]);
  const liveWebSocketRef = useRef<WebSocket | null>(null);
  const debugEnvironmentId = environmentId && selectedEnvironmentIds.includes(environmentId)
    ? environmentId
    : selectedEnvironmentIds[0];
  const selectedUrlEnvironment = environments.find((item) => item.id === debugEnvironmentId);
  const editorEnvironmentVariableOptions = useMemo(
    () => Array.from(new Set([
      ...(selectedUrlEnvironment?.variables ?? [])
        .filter((variable) => variable.name.trim())
        .map((variable) => `{{${variable.name}}}`),
      ...environmentVariableOptions,
    ])),
    [environmentVariableOptions, selectedUrlEnvironment],
  );
  const selectedEnvironmentNames = selectedEnvironmentIds
    .map((id) => environments.find((item) => item.id === id)?.name)
    .filter((name): name is string => Boolean(name));
  const selectedEnvironmentName = selectedEnvironmentNames.length > 0 ? selectedEnvironmentNames.join("、") : "未选择环境";
  const liveWebSocketStatusLabels: Record<LiveWebSocketStatus, string> = {
    disconnected: "未连接",
    connecting: "连接中",
    connected: "已连接",
    error: "连接异常",
  };

  const appendLiveWebSocketLog = useCallback((direction: LiveWebSocketLog["direction"], message: string) => {
    setLiveWebSocketLogs((current) => [
      ...current,
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        direction,
        message,
        timestamp: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
      },
    ]);
  }, []);

  const resolveLiveWebSocketUrl = () => {
    const rawUrl = url.trim();
    if (/^wss?:\/\//i.test(rawUrl)) return rawUrl;
    const environment = environments.find((item) => item.id === debugEnvironmentId);
    if (!environment?.baseUrl) throw new Error("相对 WebSocket 路径需要先选择带 Base URL 的环境");
    const baseUrl = environment.baseUrl.replace(/^http:/i, "ws:").replace(/^https:/i, "wss:");
    return new URL(rawUrl, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`).toString();
  };

  const disconnectLiveWebSocket = useCallback(() => {
    const socket = liveWebSocketRef.current;
    if (socket && (socket.readyState === 0 || socket.readyState === 1)) socket.close(1000, "Manual disconnect");
    liveWebSocketRef.current = null;
    setLiveWebSocketStatus("disconnected");
  }, []);

  useEffect(() => () => {
    const socket = liveWebSocketRef.current;
    if (socket && (socket.readyState === 0 || socket.readyState === 1)) socket.close(1000, "Editor closed");
  }, []);

  useEffect(() => {
    if (!isAutoComposedUrl.current) return;
    setUrl(buildCaseEditorUrl(apiCase, selectedUrlEnvironment));
  }, [apiCase, selectedUrlEnvironment]);

  const connectLiveWebSocket = () => {
    if (liveWebSocketStatus === "connecting" || liveWebSocketStatus === "connected") return;
    try {
      const resolvedUrl = resolveLiveWebSocketUrl();
      const protocols = subprotocols.split(",").map((item) => item.trim()).filter(Boolean);
      const socket = protocols.length > 0 ? new WebSocket(resolvedUrl, protocols) : new WebSocket(resolvedUrl);
      liveWebSocketRef.current = socket;
      setLiveWebSocketStatus("connecting");
      appendLiveWebSocketLog("system", `正在连接 ${resolvedUrl}`);

      socket.onopen = () => {
        if (liveWebSocketRef.current !== socket) return;
        setLiveWebSocketStatus("connected");
        appendLiveWebSocketLog("system", "连接已建立");
      };
      socket.onmessage = (event) => {
        if (typeof event.data === "string") {
          appendLiveWebSocketLog("received", event.data);
          return;
        }
        if (event.data instanceof Blob) {
          void event.data.text().then((message) => appendLiveWebSocketLog("received", message));
          return;
        }
        appendLiveWebSocketLog("received", String(event.data));
      };
      socket.onerror = () => {
        if (liveWebSocketRef.current !== socket) return;
        setLiveWebSocketStatus("error");
        appendLiveWebSocketLog("system", "连接发生异常，请检查地址、服务状态或浏览器跨域策略");
      };
      socket.onclose = (event) => {
        if (liveWebSocketRef.current === socket) liveWebSocketRef.current = null;
        setLiveWebSocketStatus("disconnected");
        appendLiveWebSocketLog("system", `连接已断开（${event.code}${event.reason ? `：${event.reason}` : ""}）`);
      };
    } catch (error) {
      setLiveWebSocketStatus("error");
      appendLiveWebSocketLog("system", error instanceof Error ? error.message : "无法建立 WebSocket 连接");
    }
  };

  const sendLiveWebSocketMessage = () => {
    const socket = liveWebSocketRef.current;
    if (!socket || socket.readyState !== 1) {
      appendLiveWebSocketLog("system", "请先建立 WebSocket 连接");
      return;
    }
    try {
      const message = liveWebSocketMessageType === "json"
        ? JSON.stringify(JSON.parse(liveWebSocketMessage))
        : liveWebSocketMessage;
      socket.send(message);
      appendLiveWebSocketLog("sent", message);
      setLiveWebSocketMessage("");
    } catch (error) {
      appendLiveWebSocketLog("system", error instanceof Error ? `发送失败：${error.message}` : "发送失败");
    }
  };

  const toggleSelectedEnvironment = (nextEnvironmentId: number) => {
    setSelectedEnvironmentIds((current) => {
      if (current.includes(nextEnvironmentId)) return current.filter((id) => id !== nextEnvironmentId);
      return [...current, nextEnvironmentId];
    });
  };

  const updateParams = (index: number, field: keyof KeyValueRow, value: string | boolean) => {
    setParams((current) => current.map((row, rowIndex) => (rowIndex === index ? { ...row, [field]: value } : row)));
  };

  const updateHeaders = (index: number, field: keyof KeyValueRow, value: string | boolean) => {
    setHeaders((current) => current.map((row, rowIndex) => (rowIndex === index ? { ...row, [field]: value } : row)));
  };

  const updateFormBody = (index: number, field: keyof KeyValueRow, value: string | boolean) => {
    setFormBody((current) => current.map((row, rowIndex) => (rowIndex === index ? { ...row, [field]: value } : row)));
  };

  const updateUrlEncodedBody = (index: number, field: keyof KeyValueRow, value: string | boolean) => {
    setUrlEncodedBody((current) => current.map((row, rowIndex) => (rowIndex === index ? { ...row, [field]: value } : row)));
  };

  const applyGetUrlQuery = (nextUrl: string) => {
    if (method !== "GET") {
      setUrl(nextUrl);
      return;
    }
    const { cleanUrl, queryEntries } = splitUrlQuery(nextUrl);
    setUrl(cleanUrl);
    if (queryEntries.length > 0) {
      setParams((current) => mergeUrlQueryParams(current, queryEntries));
      setActiveTab("params");
    }
  };

  const updateMethod = (nextMethod: string) => {
    setMethod(nextMethod);
    if (nextMethod === "GET" && url.includes("?")) {
      const { cleanUrl, queryEntries } = splitUrlQuery(url);
      setUrl(cleanUrl);
      if (queryEntries.length > 0) {
        setParams((current) => mergeUrlQueryParams(current, queryEntries));
        setActiveTab("params");
      }
    }
  };

  const jsonError = (() => {
    const jsonValue = apiCase.protocol === "websocket" ? webSocketMessages : jsonBody;
    if ((apiCase.protocol === "websocket" ? false : bodyType !== "JSON") || !jsonValue.trim()) return "";
    try {
      JSON.parse(jsonValue);
      return "";
    } catch (error) {
      return error instanceof Error ? `JSON 格式错误：${error.message}` : "JSON 格式错误";
    }
  })();

  const formatJsonBody = () => {
    try {
      const parsed = JSON.parse(apiCase.protocol === "websocket" ? webSocketMessages : jsonBody);
      if (apiCase.protocol === "websocket") setWebSocketMessages(JSON.stringify(parsed, null, 2));
      else setJsonBody(JSON.stringify(parsed, null, 2));
      setDebugMessage("");
    } catch (error) {
      setDebugMessage(error instanceof Error ? `JSON 格式错误：${error.message}` : "JSON 格式错误");
    }
  };

  const path = (() => {
    if (apiCase.protocol === "websocket") return url;
    try {
      return new URL(url).pathname;
    } catch {
      return url;
    }
  })();

  const buildRequestPayload = (): TestCaseRequestPayload | WebSocketTestCaseRequestPayload => {
    if (apiCase.protocol === "websocket") {
      return {
        environment_id: debugEnvironmentId,
        environment_ids: selectedEnvironmentIds,
        path: url,
        headers: rowsToObject(headers),
        subprotocols: subprotocols.split(",").map((item) => item.trim()).filter(Boolean),
        connect_timeout_ms: connectTimeoutMs,
        receive_timeout_ms: responseTimeoutMs,
        receive_count: receiveCount,
        messages: JSON.parse(webSocketMessages || "[]") as WebSocketMessage[],
        assertions: parseWebSocketAssertions(assertions),
        extractors: JSON.parse(webSocketExtractors || "[]") as WebSocketExtractor[],
      };
    }

    if (!debugEnvironmentId) {
      throw new Error("请先选择环境");
    }

    let body: unknown = null;
    let backendBodyType: TestCaseRequestPayload["body_type"] = "none";

    if (bodyType === "JSON") {
      backendBodyType = "json";
      body = jsonBody.trim() ? JSON.parse(jsonBody) : null;
    } else if (bodyType === "Form Data") {
      backendBodyType = "multipart";
      body = rowsToObject(formBody);
    } else if (bodyType === "x-www-form-urlencoded") {
      backendBodyType = "form_urlencoded";
      body = rowsToObject(urlEncodedBody);
    } else if (rawBody.trim()) {
      backendBodyType = "raw_text";
      body = rawBody;
    }

    return {
      environment_id: debugEnvironmentId,
      environment_ids: selectedEnvironmentIds,
      method,
      path,
      headers: rowsToObject(headers),
      query_params: rowsToObject(params),
      body_type: body === null ? "none" : backendBodyType,
      body,
      assertions: parseAssertions(assertions),
      extractors: [],
    };
  };

  const buildSavePayload = (): AnyTestCaseSavePayload => ({
    ...buildRequestPayload(),
    name,
    description: apiCase.description ?? "",
  });

  const validateCurrentCase = () => {
    if (!name.trim()) return "请填写用例名称";
    if (!url.trim()) return apiCase.protocol === "websocket" ? "请填写 WebSocket 地址" : "请填写接口地址";
    if (apiCase.protocol === "websocket" && !/^wss?:\/\//i.test(url.trim()) && selectedEnvironmentIds.length === 0) {
      return "相对 WebSocket 路径必须绑定至少一个环境";
    }
    if (apiCase.protocol === "websocket" && (connectTimeoutMs <= 0 || responseTimeoutMs <= 0)) return "WebSocket 超时时间必须大于 0";
    if (apiCase.protocol === "websocket" && receiveCount < 0) return "接收消息数量不能小于 0";
    if (apiCase.protocol === "websocket") {
      try {
        const messages = JSON.parse(webSocketMessages || "[]");
        if (!Array.isArray(messages)) return "发送消息必须是 JSON 数组";
        if (messages.some((item) => !item || !["text", "json"].includes(item.type) || !("data" in item))) {
          return "每条发送消息必须包含 type（text/json）和 data";
        }
        const extractors = JSON.parse(webSocketExtractors || "[]");
        if (!Array.isArray(extractors)) return "提取器必须是 JSON 数组";
      } catch (error) {
        return error instanceof Error ? `WebSocket 配置 JSON 格式错误：${error.message}` : "WebSocket 配置 JSON 格式错误";
      }
    }
    return jsonError;
  };

  const saveCurrentCase = async () => {
    const validationMessage = validateCurrentCase();
    if (validationMessage) {
      setDebugMessage(validationMessage);
      return;
    }
    if (apiCase.protocol === "http" && selectedEnvironmentIds.length === 0) {
      setDebugMessage("请先选择环境");
      return;
    }
    setIsSaving(true);
    setDebugMessage("");
    try {
      await onSave(
        {
          ...apiCase,
          environmentId: debugEnvironmentId,
          environmentIds: selectedEnvironmentIds,
          group: selectedEnvironmentName,
          method,
          name,
          owner: apiCase.owner,
          path,
          status,
          updatedAt: "刚刚",
          params,
          headers,
          bodyType,
          jsonBody,
          formBody,
          urlEncodedBody,
          rawBody,
          subprotocols: subprotocols.split(",").map((item) => item.trim()).filter(Boolean),
          connectTimeoutMs,
          responseTimeoutMs,
          receiveCount,
          messages: JSON.parse(webSocketMessages || "[]") as WebSocketMessage[],
          extractors: JSON.parse(webSocketExtractors || "[]") as WebSocketExtractor[],
          assertions,
          exampleResponse,
        },
        mode,
        buildSavePayload(),
      );
    } catch (error) {
      setDebugMessage(error instanceof Error ? error.message : "保存失败，请稍后重试");
    } finally {
      setIsSaving(false);
    }
  };

  const debugCurrentCase = async () => {
    setIsDebugging(true);
    setDebugMessage("");
    setDebugResult(null);
    if (!projectId) {
      setDebugMessage("请先选择项目");
      setIsDebugging(false);
      return;
    }
    if (apiCase.protocol === "http" && selectedEnvironmentIds.length === 0) {
      setDebugMessage("请先选择环境");
      setIsDebugging(false);
      return;
    }
    const validationMessage = validateCurrentCase();
    if (validationMessage) {
      setDebugMessage(validationMessage);
      setIsDebugging(false);
      return;
    }
    try {
      const result =
        apiCase.protocol === "websocket"
          ? await executeUnsavedWebSocketTestCase(projectId, buildRequestPayload() as WebSocketTestCaseRequestPayload)
          : await executeUnsavedTestCase(projectId, buildRequestPayload() as TestCaseRequestPayload);
      const nextDebugResult = formatDebugExecution(result);
      setDebugResult(nextDebugResult);
      setExampleResponse(nextDebugResult.responseBody);
      setActiveTab("response");
      setDebugMessage(
        `调试完成：${nextDebugResult.statusCode ? `HTTP ${nextDebugResult.statusCode}` : nextDebugResult.status ?? "已执行"}${
          nextDebugResult.durationMs ? `，耗时 ${nextDebugResult.durationMs}ms` : ""
        }。`,
      );
      onDebugAction(`调试 ${name}`);
    } catch (error) {
      setDebugMessage(error instanceof Error ? error.message : "调试失败，请稍后重试");
    } finally {
      setIsDebugging(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <section aria-modal="true" className="api-editor-modal" role="dialog">
        <div className="modal-head">
          <div>
            <span className="eyebrow">
              {mode === "create" ? `新增 ${protocolLabels[apiCase.protocol]} 测试用例` : `编辑 ${protocolLabels[apiCase.protocol]} 测试用例`}
            </span>
            <h3>{mode === "create" ? "新建测试用例" : apiCase.name}</h3>
            <p>{apiCase.id} · {selectedEnvironmentName}</p>
          </div>
          <button className="icon-btn" onClick={onClose} title="关闭" type="button">
            <Icon name="close" />
          </button>
        </div>

        <div className="case-meta-grid">
          <label>
            <span>用例名称</span>
            <input onChange={(event) => setName(event.target.value)} value={name} />
          </label>
          <label>
            <span>用例所属环境</span>
            <div className="case-environment-picker">
              {environments.map((item) => (
                <button
                  className={selectedEnvironmentIds.includes(item.id) ? "environment-chip selected" : "environment-chip"}
                  key={item.id}
                  onClick={() => toggleSelectedEnvironment(item.id)}
                  type="button"
                >
                  <span className={selectedEnvironmentIds.includes(item.id) ? "option-check active" : "option-check"}>
                    <Icon name="check" />
                  </span>
                  {item.name}
                </button>
              ))}
              {environments.length === 0 && <small>暂无可绑定环境</small>}
            </div>
          </label>
          <button
            className={status === "已启用" ? "state-toggle enabled" : "state-toggle disabled"}
            onClick={() => setStatus((value) => (value === "已启用" ? "草稿" : "已启用"))}
            type="button"
          >
            {status === "已启用" ? "已启用" : "草稿"}
          </button>
        </div>

        <div className="request-line">
          {apiCase.protocol === "websocket" ? (
            <div className="protocol-select websocket-protocol"><Icon name="cable" /> WebSocket</div>
          ) : (
            <select className={`method-select method-select-${method}`} onChange={(event) => updateMethod(event.target.value)} value={method}>
              {httpMethods.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
          )}
          <input
            onBlur={() => apiCase.protocol === "http" && applyGetUrlQuery(url)}
            onChange={(event) => {
              isAutoComposedUrl.current = false;
              setUrl(event.target.value);
            }}
            placeholder={apiCase.protocol === "websocket" ? "请输入 WebSocket 地址，例如 wss://example.com/ws" : "请输入接口地址或路径，例如 /api/v1/users"}
            value={url}
          />
        </div>

        <div className="tabs">
          {apiCase.protocol === "http" && <button className={activeTab === "params" ? "active" : ""} onClick={() => setActiveTab("params")} type="button">Params</button>}
          <button className={activeTab === "headers" ? "active" : ""} onClick={() => setActiveTab("headers")} type="button">Headers</button>
          {apiCase.protocol === "http" && <button className={activeTab === "body" ? "active" : ""} onClick={() => setActiveTab("body")} type="button">Body</button>}
          {apiCase.protocol === "websocket" && <button className={activeTab === "message" ? "active" : ""} onClick={() => setActiveTab("message")} type="button">连接与消息</button>}
          <button className={activeTab === "assertions" ? "active" : ""} onClick={() => setActiveTab("assertions")} type="button">断言</button>
          <button className={activeTab === "response" ? "active" : ""} onClick={() => setActiveTab("response")} type="button">示例响应</button>
        </div>

        <div className="tab-panel">
          {activeTab === "params" && apiCase.protocol === "http" && (
            <KeyValueEditor
              environmentVariableOptions={editorEnvironmentVariableOptions}
              onLoadVariableOptions={onLoadVariableOptions}
              onAdd={() => setParams((current) => [...current, { key: "", value: "", enabled: true }])}
              onChange={updateParams}
              onDelete={(index) => setParams((current) => current.filter((_, rowIndex) => rowIndex !== index))}
              rows={params}
              title="请求参数"
            />
          )}
          {activeTab === "headers" && (
            <HeaderEditor
              environmentVariableOptions={editorEnvironmentVariableOptions}
              onLoadVariableOptions={onLoadVariableOptions}
              onAdd={() => setHeaders((current) => [...current, { key: "", value: "", enabled: true }])}
              onChange={updateHeaders}
              onDelete={(index) => setHeaders((current) => current.filter((_, rowIndex) => rowIndex !== index))}
              rows={headers}
            />
          )}
          {activeTab === "body" && (
            <div className="body-editor">
              <div className="body-toolbar">
                <label>
                  <span>Body 类型</span>
                  <select onChange={(event) => setBodyType(event.target.value as BodyType)} value={bodyType}>
                    <option>JSON</option>
                    <option>Form Data</option>
                    <option>x-www-form-urlencoded</option>
                    <option>Raw Text</option>
                  </select>
                </label>
              </div>
              {bodyType === "JSON" && (
                <div className="single-editor json-body-editor">
                  <div className="code-editor-toolbar">
                    <div>
                      <span>JSON 请求体</span>
                      <small className={jsonError ? "json-invalid" : "json-valid"}>
                        {jsonError ? "JSON 格式异常" : jsonBody.trim() ? "JSON 格式正常" : "可留空，表示无请求体"}
                      </small>
                    </div>
                    <button className="json-format-btn" disabled={!jsonBody.trim()} onClick={formatJsonBody} type="button">
                      <Icon name="data_object" />
                      格式化 JSON
                    </button>
                  </div>
                  <textarea
                    className={jsonError ? "invalid-editor" : ""}
                    onChange={(event) => setJsonBody(event.target.value)}
                    placeholder="请输入 JSON 请求体；留空则按无请求体提交。"
                    value={jsonBody}
                  />
                  {jsonError && <p className="field-error">{jsonError}</p>}
                </div>
              )}
              {bodyType === "Form Data" && (
                <BodyKeyValueEditor
                  environmentVariableOptions={editorEnvironmentVariableOptions}
                  onLoadVariableOptions={onLoadVariableOptions}
                  onAdd={() => setFormBody((current) => [...current, { key: "", value: "", enabled: true }])}
                  onChange={updateFormBody}
                  onDelete={(index) => setFormBody((current) => current.filter((_, rowIndex) => rowIndex !== index))}
                  rows={formBody}
                  title="Form Data"
                />
              )}
              {bodyType === "x-www-form-urlencoded" && (
                <BodyKeyValueEditor
                  environmentVariableOptions={editorEnvironmentVariableOptions}
                  onLoadVariableOptions={onLoadVariableOptions}
                  onAdd={() => setUrlEncodedBody((current) => [...current, { key: "", value: "", enabled: true }])}
                  onChange={updateUrlEncodedBody}
                  onDelete={(index) => setUrlEncodedBody((current) => current.filter((_, rowIndex) => rowIndex !== index))}
                  rows={urlEncodedBody}
                  title="x-www-form-urlencoded"
                />
              )}
              {bodyType === "Raw Text" && (
                <div className="single-editor">
                  <textarea onChange={(event) => setRawBody(event.target.value)} placeholder="请输入原始文本请求体" value={rawBody} />
                </div>
              )}
            </div>
          )}
          {activeTab === "message" && apiCase.protocol === "websocket" && (
            <div className="websocket-editor">
              <section className="websocket-live-panel">
                <div className="websocket-live-head">
                  <div>
                    <span className={`websocket-live-status ${liveWebSocketStatus}`}>
                      <i />
                      {liveWebSocketStatusLabels[liveWebSocketStatus]}
                    </span>
                    <small>实时连接仅支持地址和子协议；自定义 Headers 请使用底部“调试”执行完整用例。</small>
                  </div>
                  <div className="websocket-live-actions">
                    <button className="btn" disabled={liveWebSocketLogs.length === 0} onClick={() => setLiveWebSocketLogs([])} type="button">
                      <Icon name="delete_sweep" />
                      清空记录
                    </button>
                    {liveWebSocketStatus === "connected" || liveWebSocketStatus === "connecting" ? (
                      <button className="btn danger" onClick={disconnectLiveWebSocket} type="button">
                        <Icon name="link_off" />
                        断开连接
                      </button>
                    ) : (
                      <button className="btn websocket-connect-btn" onClick={connectLiveWebSocket} type="button">
                        <Icon name="link" />
                        建立连接
                      </button>
                    )}
                  </div>
                </div>
                <div aria-live="polite" className="websocket-live-log">
                  {liveWebSocketLogs.length === 0 ? (
                    <div className="websocket-live-empty">
                      <Icon name="forum" />
                      <span>建立连接后，可在这里查看连接事件和收发消息。</span>
                    </div>
                  ) : liveWebSocketLogs.map((log) => (
                    <div className={`websocket-log-item ${log.direction}`} key={log.id}>
                      <span>{log.timestamp}</span>
                      <b>{log.direction === "sent" ? "发送" : log.direction === "received" ? "接收" : "系统"}</b>
                      <pre>{log.message}</pre>
                    </div>
                  ))}
                </div>
                <div className="websocket-live-compose">
                  <select
                    aria-label="手动消息类型"
                    disabled={liveWebSocketStatus !== "connected"}
                    onChange={(event) => setLiveWebSocketMessageType(event.target.value as "text" | "json")}
                    value={liveWebSocketMessageType}
                  >
                    <option value="text">Text</option>
                    <option value="json">JSON</option>
                  </select>
                  <textarea
                    aria-label="手动发送消息"
                    disabled={liveWebSocketStatus !== "connected"}
                    onChange={(event) => setLiveWebSocketMessage(event.target.value)}
                    onKeyDown={(event) => {
                      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") sendLiveWebSocketMessage();
                    }}
                    placeholder="输入消息，Ctrl/Cmd + Enter 快速发送"
                    value={liveWebSocketMessage}
                  />
                  <button className="btn primary" disabled={liveWebSocketStatus !== "connected" || !liveWebSocketMessage} onClick={sendLiveWebSocketMessage} type="button">
                    <Icon name="send" />
                    发送消息
                  </button>
                </div>
              </section>
              <div className="websocket-settings-grid">
                <label className="modal-field">
                  <span>子协议</span>
                  <input onChange={(event) => setSubprotocols(event.target.value)} placeholder="多个子协议使用逗号分隔" value={subprotocols} />
                </label>
                <label className="modal-field">
                  <span>连接超时（ms）</span>
                  <input min={1} onChange={(event) => setConnectTimeoutMs(Number(event.target.value))} type="number" value={connectTimeoutMs} />
                </label>
                <label className="modal-field">
                  <span>接收超时（ms）</span>
                  <input min={1} onChange={(event) => setResponseTimeoutMs(Number(event.target.value))} type="number" value={responseTimeoutMs} />
                </label>
                <label className="modal-field">
                  <span>接收消息数量</span>
                  <input min={0} onChange={(event) => setReceiveCount(Number(event.target.value))} type="number" value={receiveCount} />
                </label>
              </div>
              <div className="single-editor">
                <div className="json-toolbar">
                  <span>{jsonError ? "发送消息 JSON 格式异常" : "按数组顺序发送消息，type 支持 text 和 json"}</span>
                  <button className="btn" onClick={formatJsonBody} type="button"><Icon name="data_object" />格式化 JSON</button>
                </div>
                <textarea className={jsonError ? "invalid-editor" : ""} onChange={(event) => setWebSocketMessages(event.target.value)} placeholder={'例如：[{"type":"text","data":"ping"}]；空数组表示仅测试连接。'} value={webSocketMessages} />
                {jsonError && <p className="field-error">{jsonError}</p>}
              </div>
              <div className="single-editor">
                <label>
                  <span>响应提取器</span>
                  <small>从指定响应消息中提取 JSON 路径，供后续批量用例使用。</small>
                  <textarea onChange={(event) => setWebSocketExtractors(event.target.value)} placeholder={'例如：[{"name":"connection_id","message_index":0,"path":"connection_id"}]'} value={webSocketExtractors} />
                </label>
              </div>
            </div>
          )}
          {activeTab === "assertions" && (
            <div className="single-editor">
              <label>
                <span>断言规则</span>
                <small>
                  {apiCase.protocol === "websocket"
                    ? "一行一条，例如 message_count == 1、message[0] contains welcome 或 message[0].event == welcome。"
                    : "一行一条，例如 status == 200 或 body.code == 0。"}
                </small>
                <textarea
                  onChange={(event) => setAssertions(event.target.value.split("\n").filter(Boolean))}
                  placeholder={apiCase.protocol === "websocket" ? "例如：message_count == 1" : "例如：status == 200"}
                  value={assertions.join("\n")}
                />
              </label>
            </div>
          )}
          {activeTab === "response" && (
            <div className="single-editor">
              {debugResult && <DebugResponsePanel result={debugResult} />}
              <label>
                <span>示例响应</span>
                <small>调试完成后会自动填入本次响应体，也可以手动调整后保存。</small>
                <textarea onChange={(event) => setExampleResponse(event.target.value)} placeholder="可粘贴接口示例响应，留空也可以保存。" value={exampleResponse} />
              </label>
            </div>
          )}
        </div>

        {debugMessage && <p className="form-message">{debugMessage}</p>}

        <div className="modal-actions">
          <button className="btn" onClick={onClose} type="button">取消</button>
          <button className="btn" disabled={isDebugging || isSaving} onClick={debugCurrentCase} type="button">
            <Icon name="play_arrow" />
            {isDebugging ? "调试中..." : "调试"}
          </button>
          <button className="btn primary" disabled={isDebugging || isSaving} onClick={saveCurrentCase} type="button">
            <Icon name="save" />
            {isSaving ? "保存中..." : "保存"}
          </button>
        </div>
      </section>
    </div>
  );
}

function KeyValueEditor({
  environmentVariableOptions,
  onLoadVariableOptions,
  onAdd,
  rows,
  title,
  onChange,
  onDelete,
}: {
  environmentVariableOptions: string[];
  onLoadVariableOptions: () => void;
  onAdd: () => void;
  rows: KeyValueRow[];
  title: string;
  onChange: (index: number, field: keyof KeyValueRow, value: string | boolean) => void;
  onDelete: (index: number) => void;
}) {
  return (
    <div>
      <div className="tab-panel-head">
        <strong>{title}</strong>
        <span>Key、Value 和启用状态会随调试请求一起提交。</span>
        <button className="btn add-row-btn" onClick={onAdd} type="button">
          <Icon name="add" />
          添加参数
        </button>
      </div>
      <table className="data-table params-table header-table">
        <thead>
          <tr>
            <th>Key</th>
            <th>Value</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr className="inline-empty-row">
              <td colSpan={4}>
                <div className="inline-empty">
                  <Icon name="tune" />
                  <span>暂无请求参数，可点击“添加参数”维护 Query Params。</span>
                </div>
              </td>
            </tr>
          )}
          {rows.map((row, index) => (
            <tr key={index}>
              <td><input onChange={(event) => onChange(index, "key", event.target.value)} value={row.key} /></td>
              <td>
                <ComboInput
                  onChange={(value) => onChange(index, "value", value)}
                  onFocusOptions={onLoadVariableOptions}
                  options={environmentVariableOptions}
                  placeholder="输入或选择变量，例如 {{access_token}}"
                  value={row.value}
                />
              </td>
              <td>
                <button
                  className={row.enabled ? "state-toggle enabled" : "state-toggle disabled"}
                  onClick={() => onChange(index, "enabled", !row.enabled)}
                  type="button"
                >
                  {row.enabled ? "启用" : "禁用"}
                </button>
              </td>
              <td>
                <button className="icon-btn delete-row-btn" onClick={() => onDelete(index)} title="删除参数" type="button">
                  <Icon name="delete" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HeaderEditor({
  environmentVariableOptions,
  onLoadVariableOptions,
  onAdd,
  onChange,
  onDelete,
  rows,
}: {
  environmentVariableOptions: string[];
  onLoadVariableOptions: () => void;
  onAdd: () => void;
  onChange: (index: number, field: keyof KeyValueRow, value: string | boolean) => void;
  onDelete: (index: number) => void;
  rows: KeyValueRow[];
}) {
  const updateKey = (index: number, value: string, currentValue: string) => {
    onChange(index, "key", value);
    const suggestions = commonHeaderValues[value] ?? [];
    if (!currentValue && suggestions[0]) onChange(index, "value", suggestions[0]);
  };

  return (
    <div>
      <div className="tab-panel-head">
        <strong>请求头</strong>
        <span>Key 和 Value 支持下拉选择，也可以直接输入自定义内容。</span>
        <button className="btn add-row-btn" onClick={onAdd} type="button">
          <Icon name="add" />
          添加请求头
        </button>
      </div>
      <table className="data-table params-table header-table">
        <thead>
          <tr>
            <th>Key</th>
            <th>Value</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr className="inline-empty-row">
              <td colSpan={4}>
                <div className="inline-empty">
                  <Icon name="format_list_bulleted_add" />
                  <span>暂无请求头，可点击“添加请求头”维护 Header。</span>
                </div>
              </td>
            </tr>
          )}
          {rows.map((row, index) => {
            const valueOptions = Array.from(new Set([...(commonHeaderValues[row.key] ?? []), ...environmentVariableOptions]));

            return (
              <tr key={index}>
                <td>
                  <ComboInput
                    onChange={(value) => updateKey(index, value, row.value)}
                    options={commonHeaderKeys}
                    placeholder="选择或输入 Header Key"
                    value={row.key}
                  />
                </td>
                <td>
                  <ComboInput
                    onChange={(value) => onChange(index, "value", value)}
                    onFocusOptions={onLoadVariableOptions}
                    options={valueOptions}
                    placeholder={row.key ? "选择或输入 Header Value" : "先选择 Key"}
                    value={row.value}
                  />
                </td>
                <td>
                  <button
                    className={row.enabled ? "state-toggle enabled" : "state-toggle disabled"}
                    onClick={() => onChange(index, "enabled", !row.enabled)}
                    type="button"
                  >
                    {row.enabled ? "启用" : "禁用"}
                  </button>
                </td>
                <td>
                  <button className="icon-btn delete-row-btn" onClick={() => onDelete(index)} title="删除请求头" type="button">
                    <Icon name="delete" />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function BodyKeyValueEditor({
  environmentVariableOptions,
  onLoadVariableOptions,
  onAdd,
  onChange,
  onDelete,
  rows,
  title,
}: {
  environmentVariableOptions: string[];
  onLoadVariableOptions: () => void;
  onAdd: () => void;
  onChange: (index: number, field: keyof KeyValueRow, value: string | boolean) => void;
  onDelete: (index: number) => void;
  rows: KeyValueRow[];
  title: string;
}) {
  return (
    <div>
      <div className="tab-panel-head">
        <strong>{title}</strong>
        <span>键值对会按启用状态参与调试请求。</span>
        <button className="btn add-row-btn" onClick={onAdd} type="button">
          <Icon name="add" />
          添加字段
        </button>
      </div>
      <table className="data-table params-table header-table">
        <thead>
          <tr>
            <th>Key</th>
            <th>Value</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr className="inline-empty-row">
              <td colSpan={4}>
                <div className="inline-empty">
                  <Icon name="format_list_bulleted_add" />
                  <span>暂无字段，可点击“添加字段”维护请求体参数。</span>
                </div>
              </td>
            </tr>
          )}
          {rows.map((row, index) => (
            <tr key={index}>
              <td><input onChange={(event) => onChange(index, "key", event.target.value)} value={row.key} /></td>
              <td>
                <ComboInput
                  onChange={(value) => onChange(index, "value", value)}
                  onFocusOptions={onLoadVariableOptions}
                  options={environmentVariableOptions}
                  placeholder="输入或选择变量，例如 {{access_token}}"
                  value={row.value}
                />
              </td>
              <td>
                <button
                  className={row.enabled ? "state-toggle enabled" : "state-toggle disabled"}
                  onClick={() => onChange(index, "enabled", !row.enabled)}
                  type="button"
                >
                  {row.enabled ? "启用" : "禁用"}
                </button>
              </td>
              <td>
                <button className="icon-btn delete-row-btn" onClick={() => onDelete(index)} title="删除字段" type="button">
                  <Icon name="delete" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ComboInput({
  onChange,
  onFocusOptions,
  options,
  placeholder,
  value,
}: {
  onChange: (value: string) => void;
  onFocusOptions?: () => void;
  options: string[];
  placeholder: string;
  value: string;
}) {
  const [open, setOpen] = useState(false);
  const normalizedValue = value.toLowerCase().replace(/[{}_\-\s]/g, "");
  const filteredOptions = options.filter((option) => {
    const normalizedOption = option.toLowerCase().replace(/[{}_\-\s]/g, "");
    return normalizedOption.includes(normalizedValue) || option.toLowerCase().includes(value.toLowerCase());
  });
  const visibleOptions = filteredOptions.length > 0 ? filteredOptions : options;

  return (
    <div className="combo-field">
      <input
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onChange={(event) => {
          onChange(event.target.value);
          setOpen(true);
        }}
        onFocus={() => {
          onFocusOptions?.();
          setOpen(true);
        }}
        placeholder={placeholder}
        value={value}
      />
      {value && (
        <button
          aria-label="清空"
          className="combo-clear"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            onChange("");
            setOpen(true);
          }}
          type="button"
        >
          <Icon name="close" />
        </button>
      )}
      <button
        aria-label="展开选项"
        className="combo-arrow"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <Icon name="keyboard_arrow_down" />
      </button>
      {open && options.length > 0 && (
        <div className="combo-menu">
          {visibleOptions.map((option) => (
            <button
              key={option}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onChange(option);
                setOpen(false);
              }}
              type="button"
            >
              {option}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
