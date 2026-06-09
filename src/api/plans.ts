export type PlanTriggerType = "manual" | "cron" | "webhook";
export type PlanExecutionMode = "serial" | "parallel";
export type PlanFailurePolicy = "stop" | "continue";
export type PlanTargetKind = "api_case" | "websocket_case" | "flow";
export type PlanRunStatus = "passed" | "failed" | "running" | "cancelled";

export interface PlanTarget {
  id: string;
  referenceId: string | number;
  kind: PlanTargetKind;
  name: string;
  method?: string;
  path?: string;
}

export interface TestPlan {
  id: string;
  projectId: number;
  name: string;
  description: string;
  enabled: boolean;
  triggerType: PlanTriggerType;
  cronExpression: string;
  webhookEvent: string;
  environmentIds: number[];
  targets: PlanTarget[];
  executionMode: PlanExecutionMode;
  failurePolicy: PlanFailurePolicy;
  retryCount: number;
  timeoutMinutes: number;
  notificationEmails: string[];
  tags: string[];
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  nextRunAt?: string;
}

export interface PlanRun {
  id: string;
  planId: string;
  planName: string;
  projectId: number;
  environmentId?: number;
  environmentName?: string;
  status: PlanRunStatus;
  trigger: "manual" | "schedule" | "webhook";
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  targetCount: number;
  passedCount: number;
  failedCount: number;
  operator: string;
}

const PLAN_STORAGE_PREFIX = "testauto_plans_project_";
const RUN_STORAGE_PREFIX = "testauto_plan_runs_project_";

function uniqueId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function storageAvailable() {
  return typeof localStorage !== "undefined"
    && typeof localStorage.getItem === "function"
    && typeof localStorage.setItem === "function";
}

function readStorage<T>(key: string, fallback: T): T {
  if (!storageAvailable()) return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
}

function writeStorage<T>(key: string, value: T) {
  if (!storageAvailable()) return;
  localStorage.setItem(key, JSON.stringify(value));
}

function planKey(projectId: number) {
  return `${PLAN_STORAGE_PREFIX}${projectId}`;
}

function runKey(projectId: number) {
  return `${RUN_STORAGE_PREFIX}${projectId}`;
}

function normalizePlan(source: TestPlan, projectId: number): TestPlan {
  const now = new Date().toISOString();
  return {
    ...source,
    id: String(source.id || uniqueId("PLN")),
    projectId,
    name: String(source.name || "未命名计划"),
    description: String(source.description || ""),
    enabled: source.enabled !== false,
    triggerType: ["manual", "cron", "webhook"].includes(source.triggerType) ? source.triggerType : "manual",
    cronExpression: String(source.cronExpression || ""),
    webhookEvent: String(source.webhookEvent || ""),
    environmentIds: Array.isArray(source.environmentIds) ? source.environmentIds.map(Number).filter(Number.isFinite) : [],
    targets: Array.isArray(source.targets) ? source.targets.map((target) => ({ ...target, id: String(target.id || uniqueId("target")) })) : [],
    executionMode: source.executionMode === "parallel" ? "parallel" : "serial",
    failurePolicy: source.failurePolicy === "continue" ? "continue" : "stop",
    retryCount: Math.max(0, Number(source.retryCount) || 0),
    timeoutMinutes: Math.max(1, Number(source.timeoutMinutes) || 30),
    notificationEmails: Array.isArray(source.notificationEmails) ? source.notificationEmails.map(String) : [],
    tags: Array.isArray(source.tags) ? source.tags.map(String) : [],
    createdAt: source.createdAt || now,
    updatedAt: source.updatedAt || now,
  };
}

export function listPlans(projectId: number) {
  return readStorage<TestPlan[]>(planKey(projectId), []).map((plan) => normalizePlan(plan, projectId));
}

export function savePlan(projectId: number, input: Omit<TestPlan, "projectId" | "createdAt" | "updatedAt"> & Partial<Pick<TestPlan, "createdAt">>) {
  const plans = listPlans(projectId);
  const existing = plans.find((plan) => plan.id === input.id);
  const now = new Date().toISOString();
  const plan = normalizePlan({
    ...input,
    projectId,
    createdAt: existing?.createdAt ?? input.createdAt ?? now,
    updatedAt: now,
  } as TestPlan, projectId);
  writeStorage(planKey(projectId), [plan, ...plans.filter((item) => item.id !== plan.id)]);
  return plan;
}

export function deletePlan(projectId: number, planId: string) {
  writeStorage(planKey(projectId), listPlans(projectId).filter((plan) => plan.id !== planId));
}

export function duplicatePlan(projectId: number, source: TestPlan) {
  return savePlan(projectId, {
    ...source,
    id: uniqueId("PLN"),
    name: `${source.name} - 副本`,
    enabled: false,
    lastRunAt: undefined,
    nextRunAt: undefined,
    createdAt: undefined,
  });
}

export function setPlanEnabled(projectId: number, planId: string, enabled: boolean) {
  const plan = listPlans(projectId).find((item) => item.id === planId);
  if (!plan) throw new Error("测试计划不存在");
  return savePlan(projectId, { ...plan, enabled });
}

export function listPlanRuns(projectId: number) {
  return readStorage<PlanRun[]>(runKey(projectId), []);
}

export function runPlan(
  projectId: number,
  plan: TestPlan,
  environmentId?: number,
  environmentName?: string,
  operator = "当前用户",
) {
  const startedAt = new Date();
  const failedCount = plan.targets.length > 0 && plan.targets.some((target) => target.name.includes("失败")) ? 1 : 0;
  const run: PlanRun = {
    id: uniqueId("RUN"),
    planId: plan.id,
    planName: plan.name,
    projectId,
    environmentId,
    environmentName,
    status: failedCount ? "failed" : "passed",
    trigger: "manual",
    startedAt: startedAt.toISOString(),
    finishedAt: new Date(startedAt.getTime() + Math.max(800, plan.targets.length * 650)).toISOString(),
    durationMs: Math.max(800, plan.targets.length * 650),
    targetCount: plan.targets.length,
    passedCount: Math.max(0, plan.targets.length - failedCount),
    failedCount,
    operator,
  };
  writeStorage(runKey(projectId), [run, ...listPlanRuns(projectId)].slice(0, 200));
  savePlan(projectId, { ...plan, lastRunAt: run.startedAt });
  return run;
}

export function deletePlanRun(projectId: number, runId: string) {
  writeStorage(runKey(projectId), listPlanRuns(projectId).filter((run) => run.id !== runId));
}

export function clearPlanRuns(projectId: number) {
  writeStorage(runKey(projectId), []);
}

export function importPlans(projectId: number, value: unknown) {
  const source = Array.isArray(value) ? value : (value as { plans?: unknown } | null)?.plans;
  if (!Array.isArray(source)) throw new Error("导入文件必须是计划数组或包含 plans 数组");
  const imported = source.map((item) => normalizePlan(item as TestPlan, projectId)).map((plan) => ({
    ...plan,
    id: uniqueId("PLN"),
    projectId,
    enabled: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }));
  writeStorage(planKey(projectId), [...imported, ...listPlans(projectId)]);
  return imported;
}
