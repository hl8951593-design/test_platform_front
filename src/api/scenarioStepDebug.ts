import type { BackendTestCase } from "./apiCases";
import { requestWithAuth } from "./client";
import type { ScenarioStepKind } from "./scenarios";

export interface ScenarioDebugSource {
  messageIndex?: number;
  value: unknown;
}

export interface ScenarioStepDebugResult {
  durationMs: number;
  errorMessage: string;
  sources: ScenarioDebugSource[];
  status: string;
  statusCode?: string | number;
}

export interface ScenarioScriptDebugPayload {
  code: string;
  environment_id?: number;
  input_values: Record<string, unknown>;
  inputs: string[];
  language: string;
  outputs: string[];
  timeout_ms: number;
}

export interface ScenarioDebugExtraction {
  error?: string;
  found: boolean;
  value: unknown;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function parseJsonBody(value: unknown) {
  if (typeof value !== "string") return undefined;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function buildQuery(params: Record<string, string | number | undefined>) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined) query.set(key, String(value));
  });
  return query.toString();
}

export function executeUnsavedScenarioScript(projectId: number, payload: ScenarioScriptDebugPayload) {
  const init = {
    method: "POST",
    body: JSON.stringify(payload),
  };
  const query = buildQuery({ project_id: projectId });
  return requestWithAuth<BackendTestCase>(`/scenarios/actions/script/execute-unsaved?${query}`, init)
    .catch((error) => {
      const message = error instanceof Error ? error.message : "";
      if (!/404|not found/i.test(message)) throw error;
      return requestWithAuth<BackendTestCase>(`/scenario-actions/script/execute-unsaved?${query}`, init);
    });
}

export function normalizeScenarioStepDebug(
  result: BackendTestCase,
  kind: ScenarioStepKind,
): ScenarioStepDebugResult {
  const response = asRecord(result.response_snapshot);
  let sources: ScenarioDebugSource[] = [];

  if (kind === "websocket_case") {
    const messages = Array.isArray(response.received_messages) ? response.received_messages : [];
    sources = messages.map((value, messageIndex) => {
      const message = asRecord(value);
      return {
        messageIndex,
        value: message.json ?? parseJsonBody(message.data ?? message.text) ?? message.data ?? message.text ?? value,
      };
    });
  } else {
    const value = response.json ?? parseJsonBody(response.body);
    if (value !== undefined && value !== null) sources = [{ value }];
  }

  return {
    durationMs: Number(result.duration_ms ?? 0) || 0,
    errorMessage: String(result.error_message ?? ""),
    sources,
    status: String(result.status ?? "unknown"),
    statusCode: typeof response.status_code === "string" || typeof response.status_code === "number"
      ? response.status_code
      : undefined,
  };
}

export function normalizeScenarioScriptDebug(result: BackendTestCase): ScenarioStepDebugResult {
  const response = asRecord(result.response_snapshot);
  const body = parseJsonBody(response.body);
  const outputs =
    result.outputs ??
    result.output_values ??
    response.outputs ??
    response.output_values ??
    response.json ??
    body;
  return {
    durationMs: Number(result.duration_ms ?? 0) || 0,
    errorMessage: String(result.error_message ?? ""),
    sources: outputs === undefined || outputs === null ? [] : [{ value: outputs }],
    status: String(result.status ?? "unknown"),
  };
}

export function suggestedVariableName(path: string) {
  const parts = path.split(".").filter(Boolean);
  const lastPart = parts[parts.length - 1] ?? "value";
  return lastPart
    .replace(/\[(\d+)\]/g, "_$1")
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .replace(/^(\d)/, "_$1")
    || "value";
}

export function extractScenarioDebugValue(
  result: ScenarioStepDebugResult,
  path: string,
  messageIndex?: number,
): ScenarioDebugExtraction {
  const source = messageIndex === undefined
    ? result.sources[0]
    : result.sources.find((item) => item.messageIndex === messageIndex);
  if (!source) return { found: false, value: undefined, error: "调试响应不存在" };

  let current = source.value;
  for (const part of path.split(".").filter(Boolean)) {
    if (current && typeof current === "object" && !Array.isArray(current) && part in current) {
      current = (current as Record<string, unknown>)[part];
    } else if (Array.isArray(current) && /^\d+$/.test(part) && Number(part) < current.length) {
      current = current[Number(part)];
    } else {
      return { found: false, value: undefined, error: `响应路径不存在：${path}` };
    }
  }
  return { found: true, value: current };
}
