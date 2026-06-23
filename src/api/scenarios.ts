import { EventStreamRequestError, requestEventStreamWithAuth, requestWithAuth } from "./client";
import { compileScenarioStepConfig } from "./scenarioContext";

export type ScenarioStepKind = "api_case" | "websocket_case" | "delay" | "condition" | "random" | "fixed_value" | "script";
export type ScenarioActionPosition = "before" | "main" | "after";
export type ScenarioRunStatus = "queued" | "running" | "passed" | "failed" | "timeout" | "cancelled";
export type ScenarioStepStatus = ScenarioRunStatus | "pending" | "skipped";

export interface ScenarioStep {
  id: string;
  kind: ScenarioStepKind;
  referenceId?: string | number;
  name: string;
  method: string;
  path: string;
  configText: string;
  continueOnFailure: boolean;
  nodeId: string;
  actionPosition: ScenarioActionPosition;
}

export interface ScenarioDataset {
  id: string;
  name: string;
  enabled: boolean;
  variablesText: string;
  records: ScenarioDatasetRecord[];
}

export interface ScenarioDatasetRecord {
  id: string;
  name: string;
  enabled: boolean;
  requestOverrides: ScenarioRequestOverride[];
}

export type ScenarioRequestOverrideTarget = "path" | "headers" | "query_params" | "body";

export interface ScenarioRequestOverride {
  stepId: string;
  target: ScenarioRequestOverrideTarget;
  path: string;
  value: unknown;
}

export interface TestScenario {
  id: string;
  projectId: number;
  version: number;
  name: string;
  description: string;
  environmentId?: number;
  environmentName?: string;
  tags: string[];
  steps: ScenarioStep[];
  datasets: ScenarioDataset[];
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
}

export interface ScenarioStepResult {
  stepId: string;
  nodeId?: string;
  actionPosition?: ScenarioActionPosition;
  actionIndex?: number;
  name: string;
  kind?: ScenarioStepKind;
  executionId?: string;
  status: ScenarioStepStatus;
  durationMs: number;
  message: string;
  errorMessage: string;
  startedAt?: string;
  finishedAt?: string;
  request?: ScenarioRunRequest;
  response?: ScenarioRunResponse;
  assertions: ScenarioRunAssertion[];
  extractedVariables: ScenarioExtractedVariable[];
  resolvedBindings: ScenarioResolvedBinding[];
}

export interface ScenarioRunRequest {
  method?: string;
  url?: string;
  path?: string;
  headers?: Record<string, unknown>;
  queryParams?: Record<string, unknown>;
  body?: unknown;
}

export interface ScenarioRunResponse {
  statusCode?: string | number;
  headers?: Record<string, unknown>;
  body?: unknown;
  receivedMessages?: unknown[];
}

export interface ScenarioRunAssertion {
  name: string;
  status: string;
  message: string;
  expected?: unknown;
  actual?: unknown;
}

export interface ScenarioExtractedVariable {
  extractionId: string;
  name: string;
  path: string;
  value: unknown;
  masked: boolean;
  error?: string;
}

export interface ScenarioResolvedBinding {
  bindingId: string;
  sourceStepId: string;
  sourceExtractionId: string;
  target: string;
  targetPath: string;
  value: unknown;
  masked: boolean;
}

export interface ScenarioRun {
  id: string;
  scenarioId: string;
  scenarioName: string;
  projectId: number;
  environmentId?: number;
  environmentName?: string;
  datasetId?: string;
  datasetName: string;
  recordId?: string;
  recordName?: string;
  status: ScenarioRunStatus;
  startedAt: string;
  finishedAt?: string;
  durationMs: number;
  currentStepId?: string;
  currentStepIndex?: number;
  lastEventSequence?: number;
  detailLoaded: boolean;
  stepResults: ScenarioStepResult[];
}

export interface ScenarioRunLaunchItem {
  runId: string;
  datasetId?: string;
  datasetName: string;
  recordId?: string;
  recordName?: string;
  status: ScenarioRunStatus;
  eventsUrl: string;
  detailUrl: string;
}

export interface ScenarioRunLaunch {
  executionId: string;
  scenarioId: string;
  scenarioVersion: number;
  status: ScenarioRunStatus;
  createdAt: string;
  runs: ScenarioRunLaunchItem[];
}

export interface ScenarioComposePayload {
  requirement: string;
  scenario_name?: string;
  http_test_case_ids: number[];
  websocket_test_case_ids: number[];
  include_bindings: boolean;
  include_assertions: boolean;
  include_hooks: boolean;
  include_datasets: boolean;
  include_latest_execution: boolean;
  execute_candidates: boolean;
  max_nodes: number;
  extra_requirements?: string;
}

export interface ScenarioComposeResult {
  projectId: number;
  environmentId: number;
  environmentName?: string;
  sourceSummary: string;
  scenario: TestScenario;
  warnings: string[];
}

export type ScenarioRunEventName =
  | "run_queued"
  | "run_started"
  | "step_started"
  | "step_completed"
  | "step_failed"
  | "step_skipped"
  | "transition_started"
  | "run_completed"
  | "run_failed"
  | "run_cancelled"
  | "heartbeat";

export interface ScenarioRunEvent {
  schemaVersion: number;
  sequence: number;
  event: ScenarioRunEventName;
  runId: string;
  scenarioId: string;
  datasetId?: string;
  recordId?: string;
  recordName?: string;
  status?: ScenarioRunStatus | ScenarioStepStatus;
  stepId?: string;
  stepIndex?: number;
  nodeId?: string;
  actionId?: string;
  actionPosition?: ScenarioActionPosition;
  actionIndex?: number;
  sourceStepId?: string;
  sourceStepIndex?: number;
  targetStepId?: string;
  targetStepIndex?: number;
  occurredAt: string;
  payload: Record<string, unknown>;
}

type BackendRecord = Record<string, unknown>;
type PaginatedResult = {
  items?: BackendRecord[];
  records?: BackendRecord[];
  data?: BackendRecord[];
  total?: number;
  page?: number;
  page_size?: number;
};

let scenarioIdSequence = 0;
export function scenarioUniqueId(prefix: string) {
  scenarioIdSequence += 1;
  return `${prefix}-${Date.now()}-${scenarioIdSequence.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

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

function asArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function asOptionalNumber(value: unknown) {
  const parsed = Number(value);
  return value !== null && value !== undefined && Number.isFinite(parsed) ? parsed : undefined;
}

function unwrapItems(result: BackendRecord[] | PaginatedResult) {
  if (Array.isArray(result)) return result;
  return result.items ?? result.records ?? result.data ?? [];
}

function mapStep(value: unknown, index: number, nodeId: string, actionPosition: ScenarioActionPosition): ScenarioStep {
  const source = asRecord(value);
  const config = source.config ?? source.config_text ?? source.configText ?? {};
  return {
    id: String(source.id ?? source.step_id ?? `STEP-${index + 1}`),
    kind: String(source.kind ?? "api_case") as ScenarioStepKind,
    referenceId: source.reference_id as string | number | undefined ?? source.referenceId as string | number | undefined,
    name: String(source.name ?? `步骤 ${index + 1}`),
    method: String(source.method ?? ""),
    path: String(source.path ?? ""),
    configText: typeof config === "string" ? config : JSON.stringify(config, null, 2),
    continueOnFailure: Boolean(source.continue_on_failure ?? source.continueOnFailure),
    nodeId,
    actionPosition,
  };
}

function flattenScenarioNodes(value: unknown) {
  return asArray(value).flatMap((item, nodeIndex) => {
    const node = asRecord(item);
    const nodeId = String(node.id ?? node.node_id ?? `NODE-${nodeIndex + 1}`);
    const before = asArray(node.before_actions ?? node.beforeActions)
      .map((action, actionIndex) => mapStep(action, actionIndex, nodeId, "before"));
    const testCase = node.test_case ?? node.testCase;
    const main = testCase == null ? [] : [mapStep(testCase, nodeIndex, nodeId, "main")];
    const after = asArray(node.after_actions ?? node.afterActions)
      .map((action, actionIndex) => mapStep(action, actionIndex, nodeId, "after"));
    return [...before, ...main, ...after];
  });
}

function mapDataset(value: unknown, index: number): ScenarioDataset {
  const source = asRecord(value);
  const variables = source.variables ?? source.variables_text ?? source.variablesText ?? {};
  const mapOverride = (value: unknown): ScenarioRequestOverride => {
    const override = asRecord(value);
    return {
      stepId: String(override.step_id ?? override.stepId ?? ""),
      target: String(override.target ?? "body") as ScenarioRequestOverrideTarget,
      path: String(override.path ?? ""),
      value: override.value,
    };
  };
  const datasetId = String(source.id ?? source.dataset_id ?? `DATA-${index + 1}`);
  const explicitRecords = asArray(source.records ?? source.test_records);
  let records: ScenarioDatasetRecord[];
  if (explicitRecords.length) {
    records = explicitRecords.map((value, recordIndex) => {
      const record = asRecord(value);
      return {
        id: String(record.id ?? record.record_id ?? `${datasetId}-RECORD-${recordIndex + 1}`),
        name: String(record.name ?? `测试记录 ${recordIndex + 1}`),
        enabled: record.enabled !== false,
        requestOverrides: asArray(record.request_overrides ?? record.requestOverrides)
          .map(mapOverride)
          .filter((override) => override.stepId),
      };
    });
  } else {
    const legacyOverrides = asArray(source.request_overrides ?? source.requestOverrides).map((value) => {
      const override = asRecord(value);
      const values = Array.isArray(override.values) ? override.values : [override.value];
      return { override: mapOverride(value), values: values.length ? values : [""] };
    }).filter(({ override }) => override.stepId);
    const recordCount = Math.max(1, ...legacyOverrides.map(({ values }) => values.length));
    records = Array.from({ length: recordCount }, (_, recordIndex) => ({
      id: `${datasetId}-RECORD-${recordIndex + 1}`,
      name: `测试记录 ${recordIndex + 1}`,
      enabled: true,
      requestOverrides: legacyOverrides.map(({ override, values }) => ({
        ...override,
        value: values[recordIndex] ?? values[values.length - 1],
      })),
    }));
  }
  return {
    id: datasetId,
    name: String(source.name ?? `数据集 ${index + 1}`),
    enabled: source.enabled !== false,
    variablesText: typeof variables === "string" ? variables : JSON.stringify(variables, null, 2),
    records,
  };
}

function mapScenario(value: unknown, projectId: number): TestScenario {
  const source = asRecord(value);
  return {
    id: String(source.id ?? source.scenario_id ?? ""),
    projectId: Number(source.project_id ?? projectId),
    version: Number(source.version ?? source.current_version ?? 1),
    name: String(source.name ?? "未命名场景"),
    description: String(source.description ?? ""),
    environmentId: asOptionalNumber(source.environment_id ?? source.environmentId),
    environmentName: source.environment_name === undefined && source.environmentName === undefined
      ? undefined
      : String(source.environment_name ?? source.environmentName),
    tags: asArray(source.tags).map(String),
    steps: flattenScenarioNodes(source.nodes),
    datasets: asArray(source.datasets).map(mapDataset),
    createdAt: String(source.created_at ?? source.createdAt ?? ""),
    updatedAt: String(source.updated_at ?? source.updatedAt ?? ""),
    lastRunAt: source.last_run_at ? String(source.last_run_at) : undefined,
  };
}

export function mapScenarioComposeResult(value: unknown, projectId: number, environmentId: number): ScenarioComposeResult {
  const source = asRecord(value);
  const scenarioSource = asRecord(source.scenario ?? source.scenario_draft ?? source.scenarioDraft ?? source);
  return {
    projectId: Number(source.project_id ?? projectId),
    environmentId: Number(source.environment_id ?? scenarioSource.environment_id ?? environmentId),
    environmentName: source.environment_name === undefined && source.environmentName === undefined
      ? undefined
      : String(source.environment_name ?? source.environmentName),
    sourceSummary: String(source.source_summary ?? source.sourceSummary ?? ""),
    scenario: mapScenario({
      ...scenarioSource,
      id: "",
      version: 0,
      project_id: source.project_id ?? projectId,
      environment_id: scenarioSource.environment_id ?? source.environment_id ?? environmentId,
      environment_name: scenarioSource.environment_name ?? source.environment_name ?? source.environmentName,
    }, projectId),
    warnings: asArray(source.warnings).map(String),
  };
}

function optionalRecord(value: unknown) {
  const record = asRecord(value);
  return Object.keys(record).length ? record : undefined;
}

function mapStepResult(value: unknown, index: number): ScenarioStepResult {
  const source = asRecord(value);
  const duration = Number(source.duration_ms ?? source.duration ?? 0);
  const request = asRecord(source.request ?? source.request_snapshot ?? source.resolved_request);
  const response = asRecord(source.response ?? source.response_snapshot);
  const requestHeaders = optionalRecord(request.headers ?? source.request_headers);
  const queryParams = optionalRecord(request.query_params ?? request.queryParams ?? source.query_params);
  const responseHeaders = optionalRecord(response.headers ?? source.response_headers);
  const responseBody = response.json ?? response.body ?? source.response_body;
  const receivedMessages = asArray(response.received_messages ?? response.receivedMessages ?? source.received_messages);
  const assertions = asArray(source.assertions ?? source.assertion_results).map((item, assertionIndex) => {
    const assertion = asRecord(item);
    return {
      name: String(assertion.name ?? assertion.type ?? `断言 ${assertionIndex + 1}`),
      status: String(assertion.status ?? (assertion.passed === true ? "passed" : assertion.passed === false ? "failed" : "unknown")),
      message: String(assertion.message ?? assertion.error ?? ""),
      expected: assertion.expected,
      actual: assertion.actual,
    };
  });
  const extractedVariables = asArray(source.extracted_variables ?? source.extractedVariables).map((item) => {
    const variable = asRecord(item);
    return {
      extractionId: String(variable.extraction_id ?? variable.extractionId ?? variable.id ?? ""),
      name: String(variable.name ?? variable.variable_name ?? ""),
      path: String(variable.path ?? variable.json_path ?? ""),
      value: variable.value,
      masked: Boolean(variable.masked ?? variable.is_masked),
      error: String(variable.error ?? ""),
    };
  });
  const resolvedBindings = asArray(source.resolved_bindings ?? source.resolvedBindings).map((item) => {
    const binding = asRecord(item);
    return {
      bindingId: String(binding.binding_id ?? binding.bindingId ?? binding.id ?? ""),
      sourceStepId: String(binding.source_step_id ?? binding.sourceStepId ?? ""),
      sourceExtractionId: String(binding.source_extraction_id ?? binding.sourceExtractionId ?? ""),
      target: String(binding.target ?? ""),
      targetPath: String(binding.target_path ?? binding.targetPath ?? ""),
      value: binding.value,
      masked: Boolean(binding.masked ?? binding.is_masked),
    };
  });
  return {
    stepId: String(source.step_id ?? source.id ?? `STEP-${index + 1}`),
    nodeId: source.node_id == null ? undefined : String(source.node_id),
    actionPosition: source.action_position == null ? undefined : String(source.action_position) as ScenarioActionPosition,
    actionIndex: asOptionalNumber(source.action_index),
    name: String(source.name ?? source.step_name ?? `步骤 ${index + 1}`),
    kind: source.kind ? String(source.kind) as ScenarioStepKind : undefined,
    executionId: source.execution_id || source.test_case_execution_id || source.websocket_execution_id
      ? String(source.execution_id ?? source.test_case_execution_id ?? source.websocket_execution_id)
      : undefined,
    status: String(source.status ?? "failed") as ScenarioStepStatus,
    durationMs: Number.isFinite(duration) ? duration : 0,
    message: String(source.message ?? source.error_message ?? source.error ?? ""),
    errorMessage: String(source.error_message ?? source.error ?? ""),
    startedAt: source.started_at ? String(source.started_at) : undefined,
    finishedAt: source.finished_at ? String(source.finished_at) : undefined,
    request: Object.keys(request).length || requestHeaders || queryParams || source.request_body !== undefined ? {
      method: request.method || source.method ? String(request.method ?? source.method) : undefined,
      url: request.url || source.request_url ? String(request.url ?? source.request_url) : undefined,
      path: request.path || source.path ? String(request.path ?? source.path) : undefined,
      headers: requestHeaders,
      queryParams,
      body: request.body ?? source.request_body,
    } : undefined,
    response: Object.keys(response).length || responseHeaders || responseBody !== undefined || receivedMessages.length ? {
      statusCode: response.status_code as string | number | undefined ?? response.statusCode as string | number | undefined ?? source.status_code as string | number | undefined,
      headers: responseHeaders,
      body: responseBody,
      receivedMessages: receivedMessages.length ? receivedMessages : undefined,
    } : undefined,
    assertions,
    extractedVariables,
    resolvedBindings,
  };
}

function mapRun(value: unknown, projectId: number, detailLoaded = false): ScenarioRun {
  const source = asRecord(value);
  const duration = Number(source.duration_ms ?? source.duration ?? 0);
  return {
    id: String(source.id ?? source.run_id ?? ""),
    scenarioId: String(source.scenario_id ?? ""),
    scenarioName: String(source.scenario_name ?? source.name ?? "未命名场景"),
    projectId: Number(source.project_id ?? projectId),
    environmentId: asOptionalNumber(source.environment_id),
    environmentName: source.environment_name ? String(source.environment_name) : undefined,
    datasetId: source.dataset_id == null ? undefined : String(source.dataset_id),
    datasetName: String(source.dataset_name ?? source.dataset_id ?? "无数据输入"),
    recordId: source.record_id == null ? undefined : String(source.record_id),
    recordName: source.record_name == null ? undefined : String(source.record_name),
    status: String(source.status ?? "running") as ScenarioRunStatus,
    startedAt: String(source.started_at ?? source.created_at ?? ""),
    finishedAt: source.finished_at ? String(source.finished_at) : undefined,
    durationMs: Number.isFinite(duration) ? duration : 0,
    currentStepId: source.current_step_id === undefined ? undefined : String(source.current_step_id),
    currentStepIndex: asOptionalNumber(source.current_step_index),
    lastEventSequence: asOptionalNumber(source.last_event_sequence),
    detailLoaded,
    stepResults: asArray(source.step_results ?? source.steps ?? source.results).map(mapStepResult),
  };
}

function parseJsonObject(value: string, label: string) {
  const parsed = JSON.parse(value || "{}") as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label}必须是 JSON 对象`);
  }
  return parsed as Record<string, unknown>;
}

function scenarioPayload(input: TestScenario) {
  const serializeAction = (step: ScenarioStep) => ({
    id: step.id,
    kind: step.kind,
    reference_id: step.referenceId === undefined ? null : Number(step.referenceId),
    name: step.name,
    method: step.method,
    path: step.path,
    config: compileScenarioStepConfig(step, input.steps),
    continue_on_failure: step.continueOnFailure,
  });
  const mainSteps = input.steps.filter((step) => step.actionPosition === "main");
  return {
    name: input.name,
    description: input.description || null,
    environment_id: input.environmentId,
    tags: input.tags,
    nodes: mainSteps.map((step) => ({
      id: step.nodeId,
      name: step.name,
      before_actions: input.steps.filter((action) => action.nodeId === step.nodeId && action.actionPosition === "before").map(serializeAction),
      test_case: serializeAction(step),
      after_actions: input.steps.filter((action) => action.nodeId === step.nodeId && action.actionPosition === "after").map(serializeAction),
    })),
    datasets: input.datasets.map((dataset) => ({
      id: dataset.id,
      name: dataset.name,
      enabled: dataset.enabled,
      variables: parseJsonObject(dataset.variablesText, `数据集“${dataset.name}”变量`),
      records: (dataset.records ?? []).map((record) => ({
        id: record.id,
        name: record.name,
        enabled: record.enabled,
        request_overrides: record.requestOverrides.map((override) => ({
          step_id: override.stepId,
          target: override.target,
          path: override.path,
          value: override.value,
        })),
      })),
    })),
  };
}

export function emptyScenario(projectId: number, environmentId?: number): TestScenario {
  return {
    id: "",
    projectId,
    version: 0,
    name: "未命名测试场景",
    description: "",
    environmentId,
    tags: [],
    steps: [],
    datasets: [{
      id: scenarioUniqueId("DATA"),
      name: "默认数据",
      enabled: true,
      variablesText: "{}",
      records: [{
        id: scenarioUniqueId("RECORD"),
        name: "测试记录 1",
        enabled: true,
        requestOverrides: [],
      }],
    }],
    createdAt: "",
    updatedAt: "",
  };
}

export async function listScenarios(projectId: number, keyword?: string) {
  const result = await requestWithAuth<BackendRecord[] | PaginatedResult>(
    `/scenarios?${buildQuery({ project_id: projectId, keyword, page_size: 200 })}`,
  );
  return unwrapItems(result).map((item) => mapScenario(item, projectId));
}

export async function getScenario(projectId: number, scenarioId: string | number) {
  const result = await requestWithAuth<BackendRecord>(`/scenarios/${scenarioId}?project_id=${projectId}`);
  return mapScenario(result, projectId);
}

export async function createScenario(projectId: number, input: TestScenario) {
  const result = await requestWithAuth<BackendRecord>(`/scenarios?project_id=${projectId}`, {
    method: "POST",
    body: JSON.stringify(scenarioPayload(input)),
  });
  return mapScenario(result, projectId);
}

export async function updateScenario(projectId: number, input: TestScenario) {
  const result = await requestWithAuth<BackendRecord>(`/scenarios/${input.id}?project_id=${projectId}`, {
    method: "PUT",
    body: JSON.stringify({ ...scenarioPayload(input), version: input.version }),
  });
  return mapScenario(result, projectId);
}

export function saveScenario(projectId: number, input: TestScenario) {
  return input.id ? updateScenario(projectId, input) : createScenario(projectId, input);
}

export async function composeScenarioWithAi(
  projectId: number,
  environmentId: number,
  payload: ScenarioComposePayload,
) {
  const result = await requestWithAuth<BackendRecord>("/ai/skills/scenario-composer/run", {
    method: "POST",
    body: JSON.stringify({
      operation: "compose",
      project_id: projectId,
      environment_id: environmentId,
      input: payload,
    }),
  });
  return mapScenarioComposeResult(result, projectId, environmentId);
}

export function duplicateScenario(projectId: number, source: TestScenario) {
  const nodeIds = new Map(source.steps.filter((step) => step.actionPosition === "main").map((step) => [step.nodeId, scenarioUniqueId("NODE")]));
  return createScenario(projectId, {
    ...source,
    id: "",
    version: 0,
    name: `${source.name} - 副本`,
    steps: source.steps.map((step) => ({ ...step, id: scenarioUniqueId("STEP"), nodeId: nodeIds.get(step.nodeId) ?? scenarioUniqueId("NODE") })),
    datasets: source.datasets.map((dataset) => ({ ...dataset, id: scenarioUniqueId("DATA") })),
    createdAt: "",
    updatedAt: "",
    lastRunAt: undefined,
  });
}

export function deleteScenario(projectId: number, scenarioId: string) {
  return requestWithAuth<unknown>(`/scenarios/${scenarioId}?project_id=${projectId}`, { method: "DELETE" });
}

export async function listScenarioRuns(projectId: number, scenarioId?: string) {
  const result = await requestWithAuth<BackendRecord[] | PaginatedResult>(
    `/scenario-runs?${buildQuery({ project_id: projectId, scenario_id: scenarioId })}`,
  );
  return unwrapItems(result).map((item) => mapRun(item, projectId));
}

export async function getScenarioRun(projectId: number, runId: string | number) {
  const result = await requestWithAuth<BackendRecord>(`/scenario-runs/${runId}?project_id=${projectId}`);
  return mapRun(result, projectId, true);
}

export function deleteScenarioRun(projectId: number, runId: string | number) {
  return requestWithAuth<unknown>(`/scenario-runs/${runId}?project_id=${projectId}`, { method: "DELETE" });
}

export async function runScenario(
  projectId: number,
  scenario: TestScenario,
  options: { environmentId?: number; datasetIds?: string[]; idempotencyKey?: string } = {},
) {
  const result = await requestWithAuth<BackendRecord>(`/scenarios/${scenario.id}/execute?project_id=${projectId}`, {
    method: "POST",
    body: JSON.stringify({
      environment_id: options.environmentId,
      dataset_ids: options.datasetIds,
      idempotency_key: options.idempotencyKey ?? scenarioUniqueId("scenario-run"),
    }),
  });
  return {
    executionId: String(result.execution_id ?? ""),
    scenarioId: String(result.scenario_id ?? scenario.id),
    scenarioVersion: Number(result.scenario_version ?? scenario.version),
    status: String(result.status ?? "queued") as ScenarioRunStatus,
    createdAt: String(result.created_at ?? ""),
    runs: asArray(result.runs).map((value) => {
      const run = asRecord(value);
      const runId = String(run.run_id ?? run.id ?? "");
      return {
        runId,
        datasetId: run.dataset_id == null ? undefined : String(run.dataset_id),
        datasetName: String(run.dataset_name ?? run.dataset_id ?? "无数据输入"),
        recordId: run.record_id == null ? undefined : String(run.record_id),
        recordName: run.record_name == null ? undefined : String(run.record_name),
        status: String(run.status ?? "queued") as ScenarioRunStatus,
        eventsUrl: String(run.events_url ?? `/api/v1/scenario-runs/${runId}/events?project_id=${projectId}`),
        detailUrl: String(run.detail_url ?? `/api/v1/scenario-runs/${runId}?project_id=${projectId}`),
      };
    }),
  } satisfies ScenarioRunLaunch;
}

function mapScenarioRunEvent(value: unknown, eventName?: string, eventId?: string): ScenarioRunEvent {
  const source = asRecord(value);
  return {
    schemaVersion: Number(source.schema_version ?? 1),
    sequence: Number(source.sequence ?? eventId ?? 0),
    event: String(source.event ?? eventName ?? "heartbeat") as ScenarioRunEventName,
    runId: String(source.run_id ?? ""),
    scenarioId: String(source.scenario_id ?? ""),
    datasetId: source.dataset_id == null ? undefined : String(source.dataset_id),
    recordId: source.record_id == null ? undefined : String(source.record_id),
    recordName: source.record_name == null ? undefined : String(source.record_name),
    status: source.status ? String(source.status) as ScenarioRunStatus | ScenarioStepStatus : undefined,
    stepId: source.step_id === undefined ? undefined : String(source.step_id),
    stepIndex: asOptionalNumber(source.step_index),
    nodeId: source.node_id === undefined ? undefined : String(source.node_id),
    actionId: source.action_id === undefined ? undefined : String(source.action_id),
    actionPosition: source.action_position === undefined ? undefined : String(source.action_position) as ScenarioActionPosition,
    actionIndex: asOptionalNumber(source.action_index),
    sourceStepId: source.source_step_id === undefined ? undefined : String(source.source_step_id),
    sourceStepIndex: asOptionalNumber(source.source_step_index),
    targetStepId: source.target_step_id === undefined ? undefined : String(source.target_step_id),
    targetStepIndex: asOptionalNumber(source.target_step_index),
    occurredAt: String(source.occurred_at ?? ""),
    payload: source,
  };
}

export async function subscribeScenarioRunEvents(
  projectId: number,
  run: ScenarioRunLaunchItem,
  onEvent: (event: ScenarioRunEvent) => void,
  options: {
    signal?: AbortSignal;
    lastEventId?: number;
    maxReconnectAttempts?: number;
    reconnectDelayMs?: number;
    onReconnect?: (attempt: number, lastEventId: number) => void;
    onReconnected?: (lastEventId: number) => void;
    onSequenceGap?: (expectedSequence: number, receivedSequence: number) => void | Promise<void>;
    onHistoryExpired?: (error: EventStreamRequestError) => void | Promise<void>;
  } = {},
) {
  const terminalEvents = new Set<ScenarioRunEventName>(["run_completed", "run_failed", "run_cancelled"]);
  const maxReconnectAttempts = options.maxReconnectAttempts ?? 3;
  const reconnectDelayMs = options.reconnectDelayMs ?? 600;
  let lastSequence = options.lastEventId ?? 0;
  let reconnectAttempt = 0;
  let terminalReceived = false;
  const seenEvents = new Set<string>();

  const waitBeforeReconnect = () => new Promise<void>((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const onAbort = () => {
      window.clearTimeout(timeoutId);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timeoutId = window.setTimeout(() => {
      options.signal?.removeEventListener("abort", onAbort);
      resolve();
    }, reconnectDelayMs * reconnectAttempt);
    options.signal?.addEventListener("abort", onAbort, { once: true });
  });

  const emitBlock = async (block: string) => {
    let eventName = "";
    let eventId = "";
    const data: string[] = [];
    block.split(/\r?\n/).forEach((line) => {
      if (line.startsWith(":")) return;
      const separator = line.indexOf(":");
      const field = separator < 0 ? line : line.slice(0, separator);
      const fieldValue = separator < 0 ? "" : line.slice(separator + 1).replace(/^ /, "");
      if (field === "event") eventName = fieldValue;
      if (field === "id") eventId = fieldValue;
      if (field === "data") data.push(fieldValue);
    });
    if (!data.length) return;
    const event = mapScenarioRunEvent(JSON.parse(data.join("\n")) as unknown, eventName, eventId);
    const eventKey = `${event.runId || run.runId}:${event.sequence}`;
    if (seenEvents.has(eventKey) || event.sequence <= lastSequence) return;
    if (event.sequence > lastSequence + 1) {
      await options.onSequenceGap?.(lastSequence + 1, event.sequence);
    }
    seenEvents.add(eventKey);
    lastSequence = event.sequence;
    onEvent(event);
    if (terminalEvents.has(event.event)) terminalReceived = true;
  };

  while (!terminalReceived && !options.signal?.aborted) {
    try {
      const headers = new Headers();
      headers.set("Last-Event-ID", String(lastSequence));
      const response = await requestEventStreamWithAuth(
        run.eventsUrl || `/scenario-runs/${run.runId}/events?project_id=${projectId}`,
        { headers, signal: options.signal },
      );
      if (reconnectAttempt > 0) options.onReconnected?.(lastSequence);
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const blocks = buffer.split(/\r?\n\r?\n/);
        buffer = blocks.pop() ?? "";
        for (const block of blocks) await emitBlock(block);
        if (done || terminalReceived) break;
      }
      if (buffer.trim()) await emitBlock(buffer);
      if (terminalReceived) return;
      throw new Error("场景实时事件连接已中断");
    } catch (error) {
      if (options.signal?.aborted) throw error;
      if (error instanceof EventStreamRequestError && error.status === 409) {
        await options.onHistoryExpired?.(error);
        return;
      }
      if (reconnectAttempt >= maxReconnectAttempts) throw error;
      reconnectAttempt += 1;
      options.onReconnect?.(reconnectAttempt, lastSequence);
      await waitBeforeReconnect();
    }
  }
}
