import { requestWithAuth } from "./client";

export type ScenarioStepKind = "api_case" | "websocket_case" | "delay" | "condition";
export type ScenarioRunStatus = "running" | "passed" | "failed" | "timeout";
export type ScenarioStepStatus = ScenarioRunStatus | "skipped";

export interface ScenarioStep {
  id: string;
  kind: ScenarioStepKind;
  referenceId?: string | number;
  name: string;
  method: string;
  path: string;
  configText: string;
  continueOnFailure: boolean;
}

export interface ScenarioDataset {
  id: string;
  name: string;
  enabled: boolean;
  variablesText: string;
}

export interface TestScenario {
  id: string;
  projectId: number;
  version: number;
  name: string;
  description: string;
  environmentId?: number;
  tags: string[];
  steps: ScenarioStep[];
  datasets: ScenarioDataset[];
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
}

export interface ScenarioStepResult {
  stepId: string;
  name: string;
  status: ScenarioStepStatus;
  durationMs: number;
  message: string;
}

export interface ScenarioRun {
  id: string;
  scenarioId: string;
  scenarioName: string;
  projectId: number;
  environmentId?: number;
  environmentName?: string;
  datasetName: string;
  status: ScenarioRunStatus;
  startedAt: string;
  finishedAt?: string;
  durationMs: number;
  stepResults: ScenarioStepResult[];
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

export function scenarioUniqueId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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

function mapStep(value: unknown, index: number): ScenarioStep {
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
  };
}

function mapDataset(value: unknown, index: number): ScenarioDataset {
  const source = asRecord(value);
  const variables = source.variables ?? source.variables_text ?? source.variablesText ?? {};
  return {
    id: String(source.id ?? source.dataset_id ?? `DATA-${index + 1}`),
    name: String(source.name ?? `数据集 ${index + 1}`),
    enabled: source.enabled !== false,
    variablesText: typeof variables === "string" ? variables : JSON.stringify(variables, null, 2),
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
    tags: asArray(source.tags).map(String),
    steps: asArray(source.steps).map(mapStep),
    datasets: asArray(source.datasets).map(mapDataset),
    createdAt: String(source.created_at ?? source.createdAt ?? ""),
    updatedAt: String(source.updated_at ?? source.updatedAt ?? ""),
    lastRunAt: source.last_run_at ? String(source.last_run_at) : undefined,
  };
}

function mapStepResult(value: unknown, index: number): ScenarioStepResult {
  const source = asRecord(value);
  const duration = Number(source.duration_ms ?? source.duration ?? 0);
  return {
    stepId: String(source.step_id ?? source.id ?? `STEP-${index + 1}`),
    name: String(source.name ?? source.step_name ?? `步骤 ${index + 1}`),
    status: String(source.status ?? "failed") as ScenarioStepStatus,
    durationMs: Number.isFinite(duration) ? duration : 0,
    message: String(source.message ?? source.error_message ?? source.error ?? ""),
  };
}

function mapRun(value: unknown, projectId: number): ScenarioRun {
  const source = asRecord(value);
  const duration = Number(source.duration_ms ?? source.duration ?? 0);
  return {
    id: String(source.id ?? source.run_id ?? ""),
    scenarioId: String(source.scenario_id ?? ""),
    scenarioName: String(source.scenario_name ?? source.name ?? "未命名场景"),
    projectId: Number(source.project_id ?? projectId),
    environmentId: asOptionalNumber(source.environment_id),
    environmentName: source.environment_name ? String(source.environment_name) : undefined,
    datasetName: String(source.dataset_name ?? source.dataset_id ?? "空变量"),
    status: String(source.status ?? "running") as ScenarioRunStatus,
    startedAt: String(source.started_at ?? source.created_at ?? ""),
    finishedAt: source.finished_at ? String(source.finished_at) : undefined,
    durationMs: Number.isFinite(duration) ? duration : 0,
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
  return {
    name: input.name,
    description: input.description || null,
    environment_id: input.environmentId,
    tags: input.tags,
    steps: input.steps.map((step) => ({
      id: step.id,
      kind: step.kind,
      reference_id: step.referenceId === undefined ? null : Number(step.referenceId),
      name: step.name,
      method: step.method,
      path: step.path,
      config: parseJsonObject(step.configText, `步骤“${step.name}”配置`),
      continue_on_failure: step.continueOnFailure,
    })),
    datasets: input.datasets.map((dataset) => ({
      id: dataset.id,
      name: dataset.name,
      enabled: dataset.enabled,
      variables: parseJsonObject(dataset.variablesText, `数据集“${dataset.name}”变量`),
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
    datasets: [{ id: scenarioUniqueId("DATA"), name: "默认数据", enabled: true, variablesText: "{}" }],
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

export function duplicateScenario(projectId: number, source: TestScenario) {
  return createScenario(projectId, {
    ...source,
    id: "",
    version: 0,
    name: `${source.name} - 副本`,
    steps: source.steps.map((step) => ({ ...step, id: scenarioUniqueId("STEP") })),
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
  return mapRun(result, projectId);
}

export async function runScenario(
  projectId: number,
  scenario: TestScenario,
  options: { environmentId?: number; datasetIds?: string[]; idempotencyKey?: string } = {},
) {
  const result = await requestWithAuth<unknown>(`/scenarios/${scenario.id}/execute?project_id=${projectId}`, {
    method: "POST",
    body: JSON.stringify({
      environment_id: options.environmentId,
      dataset_ids: options.datasetIds,
      idempotency_key: options.idempotencyKey ?? scenarioUniqueId("scenario-run"),
    }),
  });
  const items = Array.isArray(result) ? result : asArray(asRecord(result).items ?? asRecord(result).runs ?? result);
  return items.map((item) => mapRun(item, projectId));
}
