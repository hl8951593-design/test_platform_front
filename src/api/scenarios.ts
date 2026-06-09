export type ScenarioStepKind = "api_case" | "websocket_case" | "delay" | "condition";
export type ScenarioRunStatus = "passed" | "failed";

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
  status: ScenarioRunStatus;
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
  durationMs: number;
  stepResults: ScenarioStepResult[];
}

const SCENARIO_STORAGE_PREFIX = "testauto_scenarios_project_";
const RUN_STORAGE_PREFIX = "testauto_scenario_runs_project_";

export function scenarioUniqueId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function readStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
}

function writeStorage<T>(key: string, value: T) {
  localStorage.setItem(key, JSON.stringify(value));
}

function scenarioKey(projectId: number) {
  return `${SCENARIO_STORAGE_PREFIX}${projectId}`;
}

function runKey(projectId: number) {
  return `${RUN_STORAGE_PREFIX}${projectId}`;
}

function normalizeScenario(source: TestScenario, projectId: number): TestScenario {
  const now = new Date().toISOString();
  return {
    ...source,
    id: String(source.id || scenarioUniqueId("SCN")),
    projectId,
    name: String(source.name || "未命名场景"),
    description: String(source.description || ""),
    environmentId: Number.isFinite(Number(source.environmentId)) ? Number(source.environmentId) : undefined,
    tags: Array.isArray(source.tags) ? source.tags.map(String) : [],
    steps: Array.isArray(source.steps) ? source.steps.map((step) => ({
      ...step,
      id: String(step.id || scenarioUniqueId("STEP")),
      kind: ["api_case", "websocket_case", "delay", "condition"].includes(step.kind) ? step.kind : "api_case",
      name: String(step.name || "未命名步骤"),
      method: String(step.method || "STEP"),
      path: String(step.path || ""),
      configText: String(step.configText || "{}"),
      continueOnFailure: step.continueOnFailure === true,
    })) : [],
    datasets: Array.isArray(source.datasets) ? source.datasets.map((dataset) => ({
      ...dataset,
      id: String(dataset.id || scenarioUniqueId("DATA")),
      name: String(dataset.name || "默认数据"),
      enabled: dataset.enabled !== false,
      variablesText: String(dataset.variablesText || "{}"),
    })) : [],
    createdAt: source.createdAt || now,
    updatedAt: source.updatedAt || now,
  };
}

export function emptyScenario(projectId: number, environmentId?: number): TestScenario {
  const now = new Date().toISOString();
  return {
    id: scenarioUniqueId("SCN"),
    projectId,
    name: "未命名测试场景",
    description: "",
    environmentId,
    tags: [],
    steps: [],
    datasets: [{ id: scenarioUniqueId("DATA"), name: "默认数据", enabled: true, variablesText: "{}" }],
    createdAt: now,
    updatedAt: now,
  };
}

export function listScenarios(projectId: number) {
  return readStorage<TestScenario[]>(scenarioKey(projectId), []).map((item) => normalizeScenario(item, projectId));
}

export function saveScenario(projectId: number, input: TestScenario) {
  const scenarios = listScenarios(projectId);
  const existing = scenarios.find((item) => item.id === input.id);
  const scenario = normalizeScenario({
    ...input,
    projectId,
    createdAt: existing?.createdAt ?? input.createdAt,
    updatedAt: new Date().toISOString(),
  }, projectId);
  writeStorage(scenarioKey(projectId), [scenario, ...scenarios.filter((item) => item.id !== scenario.id)]);
  return scenario;
}

export function duplicateScenario(projectId: number, source: TestScenario) {
  return saveScenario(projectId, {
    ...source,
    id: scenarioUniqueId("SCN"),
    name: `${source.name} - 副本`,
    steps: source.steps.map((step) => ({ ...step, id: scenarioUniqueId("STEP") })),
    datasets: source.datasets.map((dataset) => ({ ...dataset, id: scenarioUniqueId("DATA") })),
    createdAt: "",
    updatedAt: "",
    lastRunAt: undefined,
  });
}

export function deleteScenario(projectId: number, scenarioId: string) {
  writeStorage(scenarioKey(projectId), listScenarios(projectId).filter((item) => item.id !== scenarioId));
}

export function listScenarioRuns(projectId: number) {
  return readStorage<ScenarioRun[]>(runKey(projectId), []);
}

export function clearScenarioRuns(projectId: number, scenarioId?: string) {
  writeStorage(runKey(projectId), scenarioId ? listScenarioRuns(projectId).filter((run) => run.scenarioId !== scenarioId) : []);
}

export function runScenario(projectId: number, scenario: TestScenario, environmentName?: string) {
  const startedAt = new Date();
  const datasets = scenario.datasets.filter((item) => item.enabled);
  const runDatasets = datasets.length > 0 ? datasets : scenario.datasets.slice(0, 1);
  const runs = runDatasets.map((dataset, datasetIndex): ScenarioRun => {
    let stopped = false;
    const stepResults = scenario.steps.map((step, index): ScenarioStepResult => {
      if (stopped) {
        return { stepId: step.id, name: step.name, status: "failed", durationMs: 0, message: "前序步骤失败，未执行" };
      }
      const failed = step.name.includes("失败") || step.configText.includes("\"simulateFailure\": true");
      if (failed && !step.continueOnFailure) stopped = true;
      return {
        stepId: step.id,
        name: step.name,
        status: failed ? "failed" : "passed",
        durationMs: step.kind === "delay" ? 1000 : 350 + index * 120,
        message: failed ? "模拟执行失败" : "执行通过",
      };
    });
    const durationMs = stepResults.reduce((total, result) => total + result.durationMs, 0);
    return {
      id: scenarioUniqueId("SRUN"),
      scenarioId: scenario.id,
      scenarioName: scenario.name,
      projectId,
      environmentId: scenario.environmentId,
      environmentName,
      datasetName: dataset?.name ?? `默认数据 ${datasetIndex + 1}`,
      status: stepResults.some((result) => result.status === "failed") ? "failed" : "passed",
      startedAt: new Date(startedAt.getTime() + datasetIndex).toISOString(),
      durationMs,
      stepResults,
    };
  });
  writeStorage(runKey(projectId), [...runs, ...listScenarioRuns(projectId)].slice(0, 200));
  saveScenario(projectId, { ...scenario, lastRunAt: runs[0]?.startedAt ?? startedAt.toISOString() });
  return runs;
}
