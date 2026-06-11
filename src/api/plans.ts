import { requestWithAuth } from "./client";

export type PlanTriggerType = "manual" | "cron" | "webhook";
export type PlanExecutionMode = "serial" | "parallel";
export type PlanFailurePolicy = "stop" | "continue";
export type PlanTargetKind = "scenario";
export type PlanRunStatus = "pending" | "running" | "passed" | "failed" | "timeout";

export interface PlanTarget {
  id: string;
  referenceId: string | number;
  kind: PlanTargetKind;
  name: string;
  method?: string;
  path?: string;
  scenarioVersion?: number;
}

export interface TestPlan {
  id: string;
  projectId: number;
  version: number;
  name: string;
  description: string;
  enabled: boolean;
  triggerType: PlanTriggerType;
  cronExpression: string;
  scheduleTimezone: string;
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

export interface PlanSchedule {
  id: string;
  planId: string;
  planName: string;
  environmentId?: number;
  environmentName?: string;
  scheduledAt: string;
}

type BackendRecord = Record<string, unknown>;
type PaginatedResult = {
  items?: BackendRecord[];
  records?: BackendRecord[];
  data?: BackendRecord[];
  total?: number;
};

function buildQuery(values: Record<string, string | number | boolean | undefined>) {
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

function mapTarget(value: unknown, index: number): PlanTarget {
  const source = asRecord(value);
  const referenceId = source.reference_id as string | number ?? source.scenario_id as string | number ?? source.referenceId as string | number ?? "";
  return {
    id: `scenario-${referenceId}`,
    referenceId,
    kind: "scenario",
    name: String(source.name ?? source.scenario_name ?? `场景 ${referenceId}`),
    method: "SCENARIO",
    path: source.description ? String(source.description) : undefined,
    scenarioVersion: asOptionalNumber(source.scenario_version ?? source.scenario_version_at_bind),
  };
}

function mapPlan(value: unknown, projectId: number): TestPlan {
  const source = asRecord(value);
  return {
    id: String(source.id ?? source.plan_id ?? ""),
    projectId: Number(source.project_id ?? projectId),
    version: Number(source.version ?? 1),
    name: String(source.name ?? "未命名计划"),
    description: String(source.description ?? ""),
    enabled: Boolean(source.enabled),
    triggerType: String(source.trigger_type ?? "manual") as PlanTriggerType,
    cronExpression: String(source.cron_expression ?? ""),
    scheduleTimezone: String(source.schedule_timezone ?? "Asia/Shanghai"),
    webhookEvent: String(source.webhook_event ?? ""),
    environmentIds: asArray(source.environment_ids).map(Number).filter(Number.isFinite),
    targets: asArray(source.targets).map(mapTarget),
    executionMode: String(source.execution_mode ?? "serial") as PlanExecutionMode,
    failurePolicy: String(source.failure_policy ?? "stop") as PlanFailurePolicy,
    retryCount: Number(source.retry_count ?? 0),
    timeoutMinutes: Number(source.timeout_minutes ?? 30),
    notificationEmails: asArray(source.notification_emails).map(String),
    tags: asArray(source.tags).map(String),
    createdAt: String(source.created_at ?? ""),
    updatedAt: String(source.updated_at ?? ""),
    lastRunAt: source.last_run_at ? String(source.last_run_at) : undefined,
    nextRunAt: source.next_run_at ? String(source.next_run_at) : undefined,
  };
}

function mapRun(value: unknown, projectId: number): PlanRun {
  const source = asRecord(value);
  const duration = asOptionalNumber(source.duration_ms ?? source.duration);
  return {
    id: String(source.id ?? source.run_id ?? ""),
    planId: String(source.plan_id ?? ""),
    planName: String(source.plan_name ?? source.name ?? "未命名计划"),
    projectId: Number(source.project_id ?? projectId),
    environmentId: asOptionalNumber(source.environment_id),
    environmentName: source.environment_name ? String(source.environment_name) : undefined,
    status: String(source.status ?? "pending") as PlanRunStatus,
    trigger: String(source.trigger ?? source.trigger_type ?? "manual") as PlanRun["trigger"],
    startedAt: String(source.started_at ?? source.created_at ?? source.scheduled_at ?? ""),
    finishedAt: source.finished_at ? String(source.finished_at) : undefined,
    durationMs: duration,
    targetCount: Number(source.target_count ?? source.total_count ?? 0),
    passedCount: Number(source.passed_count ?? 0),
    failedCount: Number(source.failed_count ?? 0),
    operator: String(source.operator_name ?? source.operator ?? source.created_by_name ?? "-"),
  };
}

function mapSchedule(value: unknown, index: number): PlanSchedule {
  const source = asRecord(value);
  return {
    id: String(source.id ?? `${source.plan_id ?? "plan"}-${source.scheduled_at ?? index}`),
    planId: String(source.plan_id ?? ""),
    planName: String(source.plan_name ?? source.name ?? "未命名计划"),
    environmentId: asOptionalNumber(source.environment_id),
    environmentName: source.environment_name ? String(source.environment_name) : undefined,
    scheduledAt: String(source.scheduled_at ?? source.run_at ?? source.next_run_at ?? ""),
  };
}

function planPayload(input: Omit<TestPlan, "projectId" | "createdAt" | "updatedAt">) {
  return {
    name: input.name,
    description: input.description || null,
    enabled: input.enabled,
    trigger_type: input.triggerType,
    cron_expression: input.triggerType === "cron" ? input.cronExpression : null,
    schedule_timezone: input.scheduleTimezone,
    webhook_event: input.triggerType === "webhook" ? input.webhookEvent : null,
    environment_ids: input.environmentIds,
    targets: input.targets.map((target, index) => ({
      reference_id: Number(target.referenceId),
      kind: "scenario",
      sort_order: index + 1,
      scenario_version: target.scenarioVersion,
    })),
    execution_mode: input.executionMode,
    failure_policy: input.failurePolicy,
    retry_count: input.retryCount,
    timeout_minutes: input.timeoutMinutes,
    notification_emails: input.notificationEmails,
    tags: input.tags,
  };
}

export async function listPlans(
  projectId: number,
  filters: { keyword?: string; enabled?: boolean; triggerType?: PlanTriggerType } = {},
) {
  const result = await requestWithAuth<BackendRecord[] | PaginatedResult>(`/test-plans?${buildQuery({
    project_id: projectId,
    keyword: filters.keyword,
    enabled: filters.enabled,
    trigger_type: filters.triggerType,
    page_size: 200,
  })}`);
  return unwrapItems(result).map((item) => mapPlan(item, projectId));
}

export async function getPlan(projectId: number, planId: string | number) {
  const result = await requestWithAuth<BackendRecord>(`/test-plans/${planId}?project_id=${projectId}`);
  return mapPlan(result, projectId);
}

export async function savePlan(
  projectId: number,
  input: Omit<TestPlan, "projectId" | "createdAt" | "updatedAt">,
) {
  const editing = Boolean(input.id);
  const result = await requestWithAuth<BackendRecord>(
    editing ? `/test-plans/${input.id}?project_id=${projectId}` : `/test-plans?project_id=${projectId}`,
    {
      method: editing ? "PUT" : "POST",
      body: JSON.stringify(editing ? { ...planPayload(input), version: input.version } : planPayload(input)),
    },
  );
  return mapPlan(result, projectId);
}

export function deletePlan(projectId: number, planId: string) {
  return requestWithAuth<unknown>(`/test-plans/${planId}?project_id=${projectId}`, { method: "DELETE" });
}

export function duplicatePlan(projectId: number, source: TestPlan) {
  return savePlan(projectId, {
    ...source,
    id: "",
    version: 0,
    name: `${source.name} - 副本`,
    enabled: false,
    lastRunAt: undefined,
    nextRunAt: undefined,
  });
}

export async function setPlanEnabled(projectId: number, plan: TestPlan, enabled: boolean) {
  const result = await requestWithAuth<BackendRecord>(`/test-plans/${plan.id}/enabled?project_id=${projectId}`, {
    method: "PUT",
    body: JSON.stringify({ enabled, version: plan.version }),
  });
  return mapPlan(result, projectId);
}

export async function listPlanRuns(projectId: number) {
  const result = await requestWithAuth<BackendRecord[] | PaginatedResult>(
    `/test-plan-runs?${buildQuery({ project_id: projectId, page_size: 200 })}`,
  );
  return unwrapItems(result).map((item) => mapRun(item, projectId));
}

export async function runPlan(projectId: number, plan: TestPlan, environmentId: number) {
  const result = await requestWithAuth<BackendRecord>(`/test-plans/${plan.id}/execute?project_id=${projectId}`, {
    method: "POST",
    body: JSON.stringify({
      environment_id: environmentId,
      idempotency_key: `plan-run-${projectId}-${plan.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    }),
  });
  return mapRun(result, projectId);
}

export function deletePlanRun(projectId: number, runId: string) {
  return requestWithAuth<unknown>(`/test-plan-runs/${runId}?project_id=${projectId}`, { method: "DELETE" });
}

export function clearPlanRuns(projectId: number) {
  return requestWithAuth<unknown>(`/test-plan-runs?project_id=${projectId}`, { method: "DELETE" });
}

export async function listPlanSchedule(projectId: number, startAt?: string, endAt?: string) {
  const result = await requestWithAuth<BackendRecord[] | PaginatedResult>(`/test-plans/schedule?${buildQuery({
    project_id: projectId,
    start_at: startAt,
    end_at: endAt,
  })}`);
  return unwrapItems(result).map(mapSchedule);
}

export async function importPlans(projectId: number, value: unknown) {
  const source = Array.isArray(value) ? value : asRecord(value).plans;
  if (!Array.isArray(source)) throw new Error("导入文件必须是计划数组或包含 plans 数组");
  const result = await requestWithAuth<BackendRecord[] | PaginatedResult>(`/test-plans/import?project_id=${projectId}`, {
    method: "POST",
    body: JSON.stringify({ plans: source }),
  });
  return unwrapItems(result).map((item) => mapPlan(item, projectId));
}

export function exportPlans(projectId: number) {
  return requestWithAuth<unknown>(`/test-plans/export?project_id=${projectId}`);
}
