import { type ChangeEvent, type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  clearPlanRuns,
  deletePlan,
  deletePlanRun,
  duplicatePlan,
  exportPlans,
  importPlans,
  listPlanRuns,
  listPlanSchedule,
  listPlans,
  runPlan,
  savePlan,
  setPlanEnabled,
  type PlanExecutionMode,
  type PlanFailurePolicy,
  type PlanRun,
  type PlanSchedule,
  type PlanTarget,
  type PlanTriggerType,
  type TestPlan,
} from "../api/plans";
import type { EnvironmentOption } from "../api/projects";
import { listScenarios, type TestScenario } from "../api/scenarios";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Icon } from "../components/Icon";
import { Pagination, usePagination } from "../components/Pagination";
import type { ActionHandler } from "../types";

type PlansTab = "list" | "calendar" | "history";
type PlanStatusFilter = "all" | "enabled" | "disabled";
type PlanEditorMode = "create" | "edit";
type PendingPlanDelete = { type: "plan"; plan: TestPlan } | { type: "history" };
type PlanForm = {
  id: string;
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
  notificationText: string;
  tagText: string;
};

const emptyForm = (environmentId?: number): PlanForm => ({
  id: "",
  version: 0,
  name: "",
  description: "",
  enabled: true,
  triggerType: "manual",
  cronExpression: "0 2 * * *",
  scheduleTimezone: "Asia/Shanghai",
  webhookEvent: "push",
  environmentIds: environmentId ? [environmentId] : [],
  targets: [],
  executionMode: "serial",
  failurePolicy: "stop",
  retryCount: 0,
  timeoutMinutes: 30,
  notificationText: "",
  tagText: "",
});

function formatDate(value?: string) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function scenarioTarget(source: TestScenario): PlanTarget {
  return {
    id: `scenario-${source.id}`,
    referenceId: source.id,
    kind: "scenario",
    name: source.name,
    method: "SCENARIO",
    path: `${source.steps.length} 个步骤 · ${source.datasets.length} 个数据集`,
    scenarioVersion: source.version,
  };
}

function formFromPlan(plan: TestPlan): PlanForm {
  return {
    ...plan,
    notificationText: plan.notificationEmails.join(", "),
    tagText: plan.tags.join(", "),
  };
}

function padTimeUnit(value: number) {
  return String(value).padStart(2, "0");
}

function dailyTimeToCron(value: string) {
  const [hourRaw, minuteRaw] = value.split(":");
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return "0 2 * * *";
  }
  return `${minute} ${hour} * * *`;
}

function cronToDailyTime(expression: string) {
  const [minuteRaw, hourRaw, dayOfMonth, month, dayOfWeek] = expression.trim().split(/\s+/);
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);
  if (dayOfMonth === "*" && month === "*" && dayOfWeek === "*" && Number.isInteger(hour) && Number.isInteger(minute) && hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
    return `${padTimeUnit(hour)}:${padTimeUnit(minute)}`;
  }
  return "02:00";
}

function triggerLabel(plan: TestPlan) {
  if (plan.triggerType === "cron") return `Cron · ${plan.cronExpression}`;
  if (plan.triggerType === "webhook") return `Webhook · ${plan.webhookEvent}`;
  return "手动触发";
}

function downloadJson(filename: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function calendarEntries(schedule: PlanSchedule[]) {
  return Array.from({ length: 14 }, (_, offset) => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() + offset);
    return {
      date,
      schedules: schedule.filter((item) => {
        const scheduledAt = new Date(item.scheduledAt);
        return !Number.isNaN(scheduledAt.getTime()) && scheduledAt.toDateString() === date.toDateString();
      }),
    };
  });
}

export function PlansPage({
  environmentId,
  environments,
  onAction,
  projectId,
}: {
  environmentId?: number;
  environments?: EnvironmentOption[];
  onAction: ActionHandler;
  projectId?: number;
}) {
  const [activeTab, setActiveTab] = useState<PlansTab>("list");
  const [plans, setPlans] = useState<TestPlan[]>([]);
  const [runs, setRuns] = useState<PlanRun[]>([]);
  const [schedule, setSchedule] = useState<PlanSchedule[]>([]);
  const [assets, setAssets] = useState<PlanTarget[]>([]);
  const [assetsLoading, setAssetsLoading] = useState(false);
  const [assetError, setAssetError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<PlanStatusFilter>("all");
  const [triggerFilter, setTriggerFilter] = useState<"all" | PlanTriggerType>("all");
  const [editorMode, setEditorMode] = useState<PlanEditorMode | null>(null);
  const [form, setForm] = useState<PlanForm>(() => emptyForm(environmentId));
  const [formMessage, setFormMessage] = useState("");
  const [assetSearch, setAssetSearch] = useState("");
  const [runDialogPlan, setRunDialogPlan] = useState<TestPlan>();
  const [runEnvironmentId, setRunEnvironmentId] = useState<number | undefined>(environmentId);
  const [pendingDelete, setPendingDelete] = useState<PendingPlanDelete>();
  const [deleteBusy, setDeleteBusy] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);
  const projectEnvironments = environments ?? [];

  const reloadData = useCallback(async () => {
    if (!projectId) {
      setPlans([]);
      setRuns([]);
      setSchedule([]);
      return;
    }
    const [plansResult, runsResult, scheduleResult] = await Promise.allSettled([
      listPlans(projectId),
      listPlanRuns(projectId),
      listPlanSchedule(projectId),
    ]);
    if (plansResult.status === "fulfilled") setPlans(plansResult.value);
    if (runsResult.status === "fulfilled") setRuns(runsResult.value);
    if (scheduleResult.status === "fulfilled") setSchedule(scheduleResult.value);
    const failure = [plansResult, runsResult, scheduleResult].find((result) => result.status === "rejected");
    if (failure?.status === "rejected") onAction(failure.reason instanceof Error ? failure.reason.message : "测试计划数据加载失败");
  }, [onAction, projectId]);

  useEffect(() => {
    void reloadData();
    setEditorMode(null);
    setRunDialogPlan(undefined);
  }, [reloadData]);

  useEffect(() => {
    setRunEnvironmentId(environmentId);
  }, [environmentId]);

  useEffect(() => {
    if (!projectId) {
      setAssets([]);
      setAssetError("");
      return;
    }
    let ignore = false;
    setAssetsLoading(true);
    setAssetError("");
    void listScenarios(projectId)
      .then((result) => {
        if (ignore) return;
        setAssets(result.map(scenarioTarget));
      })
      .catch((error) => {
        if (!ignore) setAssetError(error instanceof Error ? error.message : "场景资产加载失败");
      })
      .finally(() => {
        if (!ignore) setAssetsLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [projectId]);

  const filteredPlans = useMemo(() => {
    const query = search.trim().toLowerCase();
    return plans.filter((plan) => {
      if (statusFilter === "enabled" && !plan.enabled) return false;
      if (statusFilter === "disabled" && plan.enabled) return false;
      if (triggerFilter !== "all" && plan.triggerType !== triggerFilter) return false;
      return !query || `${plan.name} ${plan.description} ${plan.tags.join(" ")}`.toLowerCase().includes(query);
    });
  }, [plans, search, statusFilter, triggerFilter]);
  const planPagination = usePagination(
    filteredPlans,
    10,
    `${projectId ?? "none"}:${search}:${statusFilter}:${triggerFilter}`,
  );

  const filteredAssets = useMemo(() => {
    const query = assetSearch.trim().toLowerCase();
    return assets.filter((asset) => !query || `${asset.name} ${asset.method} ${asset.path}`.toLowerCase().includes(query));
  }, [assetSearch, assets]);

  const stats = useMemo(() => [
    { label: "总计划数", value: plans.length, icon: "assignment", tone: "blue" },
    { label: "已启用", value: plans.filter((plan) => plan.enabled).length, icon: "toggle_on", tone: "green" },
    { label: "定时调度", value: plans.filter((plan) => plan.enabled && plan.triggerType === "cron").length, icon: "schedule", tone: "orange" },
    { label: "最近失败", value: runs.filter((run) => run.status === "failed").length, icon: "error", tone: "red" },
  ], [plans, runs]);

  const startCreate = () => {
    if (!projectId) {
      onAction("请先选择项目");
      return;
    }
    setForm(emptyForm(environmentId));
    setFormMessage("");
    setAssetSearch("");
    setEditorMode("create");
  };

  const startEdit = (plan: TestPlan) => {
    setForm(formFromPlan(plan));
    setFormMessage("");
    setAssetSearch("");
    setEditorMode("edit");
  };

  const submitPlan = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!projectId) return setFormMessage("请先选择项目");
    if (!form.name.trim()) return setFormMessage("请输入计划名称");
    if (form.environmentIds.length === 0) return setFormMessage("请至少选择一个执行环境");
    if (form.targets.length === 0) return setFormMessage("请至少选择一个测试场景");
    if (form.triggerType === "cron" && !form.cronExpression.trim()) return setFormMessage("请输入 Cron 表达式");
    if (form.triggerType === "webhook" && !form.webhookEvent.trim()) return setFormMessage("请输入 Webhook 事件");

    try {
      const plan = await savePlan(projectId, {
        id: form.id,
        version: form.version,
        name: form.name.trim(),
        description: form.description.trim(),
        enabled: form.enabled,
        triggerType: form.triggerType,
        cronExpression: form.cronExpression.trim(),
        scheduleTimezone: form.scheduleTimezone,
        webhookEvent: form.webhookEvent.trim(),
        environmentIds: form.environmentIds,
        targets: form.targets,
        executionMode: form.executionMode,
        failurePolicy: form.failurePolicy,
        retryCount: form.retryCount,
        timeoutMinutes: form.timeoutMinutes,
        notificationEmails: form.notificationText.split(",").map((item) => item.trim()).filter(Boolean),
        tags: form.tagText.split(",").map((item) => item.trim()).filter(Boolean),
      });
      await reloadData();
      setEditorMode(null);
      onAction(`${editorMode === "create" ? "新建" : "保存"}计划 ${plan.name}`);
    } catch (error) {
      setFormMessage(error instanceof Error ? error.message : "测试计划保存失败");
    }
  };

  const togglePlan = async (plan: TestPlan) => {
    if (!projectId) return;
    try {
      await setPlanEnabled(projectId, plan, !plan.enabled);
      await reloadData();
      onAction(`${plan.name} 已${plan.enabled ? "停用" : "启用"}`);
    } catch (error) {
      onAction(error instanceof Error ? error.message : "计划状态更新失败");
    }
  };

  const removePlan = async (plan: TestPlan) => {
    if (!projectId) return;
    setDeleteBusy(true);
    try {
      await deletePlan(projectId, plan.id);
      await reloadData();
      onAction(`删除计划 ${plan.name}`);
    } catch (error) {
      onAction(error instanceof Error ? error.message : "计划删除失败");
    } finally {
      setDeleteBusy(false);
      setPendingDelete(undefined);
    }
  };

  const clearRunHistory = async () => {
    if (!projectId || runs.length === 0) return;
    setDeleteBusy(true);
    try {
      await clearPlanRuns(projectId);
      await reloadData();
      onAction("已清空计划执行历史");
    } catch (error) {
      onAction(error instanceof Error ? error.message : "执行历史清理失败");
    } finally {
      setDeleteBusy(false);
      setPendingDelete(undefined);
    }
  };

  const copyPlan = async (plan: TestPlan) => {
    if (!projectId) return;
    try {
      await duplicatePlan(projectId, plan);
      await reloadData();
      onAction(`复制计划 ${plan.name}`);
    } catch (error) {
      onAction(error instanceof Error ? error.message : "计划复制失败");
    }
  };

  const executePlan = async () => {
    if (!projectId || !runDialogPlan || !runEnvironmentId) return;
    try {
      await runPlan(projectId, runDialogPlan, runEnvironmentId);
      await reloadData();
      setRunDialogPlan(undefined);
      setActiveTab("history");
      onAction(`计划 ${runDialogPlan.name} 已进入执行队列`);
    } catch (error) {
      onAction(error instanceof Error ? error.message : "计划执行失败");
    }
  };

  const importFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !projectId) return;
    try {
      const imported = await importPlans(projectId, JSON.parse(await file.text()));
      await reloadData();
      onAction(`导入 ${imported.length} 个测试计划`);
    } catch (error) {
      onAction(error instanceof Error ? error.message : "测试计划导入失败");
    }
  };

  return (
    <section className="page page-plans">
      <input accept="application/json,.json" aria-label="导入测试计划" hidden onChange={importFile} ref={importRef} type="file" />
      <div className="page-toolbar plans-toolbar">
        <div className="tabs">
          <button className={activeTab === "list" ? "active" : ""} onClick={() => setActiveTab("list")} type="button">计划列表</button>
          <button className={activeTab === "calendar" ? "active" : ""} onClick={() => setActiveTab("calendar")} type="button">调度日历</button>
          <button className={activeTab === "history" ? "active" : ""} onClick={() => setActiveTab("history")} type="button">执行历史</button>
        </div>
        <div className="plans-toolbar-actions">
          <button className="btn" disabled={!projectId} onClick={() => importRef.current?.click()} type="button"><Icon name="upload_file" />导入</button>
          <button className="btn" disabled={!projectId || plans.length === 0} onClick={async () => {
            if (!projectId) return;
            try {
              downloadJson(`test-plans-${projectId}.json`, await exportPlans(projectId));
            } catch (error) {
              onAction(error instanceof Error ? error.message : "测试计划导出失败");
            }
          }} type="button"><Icon name="download" />导出</button>
          <button className="btn primary" disabled={!projectId} onClick={startCreate} type="button"><Icon name="add" />新建计划</button>
        </div>
      </div>

      {!projectId && <div className="alert-banner"><Icon name="info" /><div><strong>请先选择项目</strong><p>测试计划按项目隔离，选择项目后可创建和运行计划。</p></div></div>}

      <div className="stats-grid compact-stats">
        {stats.map((stat) => (
          <article className={`metric-card tone-${stat.tone}`} key={stat.label}>
            <Icon name={stat.icon} />
            <div><p>{stat.label}</p><strong>{stat.value}</strong></div>
          </article>
        ))}
      </div>

      {activeTab === "list" && (
        <>
          <div className="filter-bar plan-filter-bar">
            <label className="inline-field"><Icon name="search" /><input onChange={(event) => setSearch(event.target.value)} placeholder="搜索计划名称、说明或标签" value={search} /></label>
            <select aria-label="计划状态" onChange={(event) => setStatusFilter(event.target.value as PlanStatusFilter)} value={statusFilter}>
              <option value="all">全部状态</option><option value="enabled">已启用</option><option value="disabled">已停用</option>
            </select>
            <select aria-label="触发方式" onChange={(event) => setTriggerFilter(event.target.value as "all" | PlanTriggerType)} value={triggerFilter}>
              <option value="all">全部触发方式</option><option value="manual">手动触发</option><option value="cron">Cron 定时</option><option value="webhook">Webhook</option>
            </select>
            <span className="plan-filter-count">{filteredPlans.length} / {plans.length} 个计划</span>
          </div>
          <article className="panel">
            <div className="panel-title"><h3>计划编排</h3><span className="plan-panel-hint">计划将按目标顺序和执行策略运行</span></div>
            {filteredPlans.length === 0 ? (
              <PlanEmpty hasProject={Boolean(projectId)} hasPlans={plans.length > 0} onCreate={startCreate} />
            ) : (
              <div className="plan-list">
                {planPagination.pageItems.map((plan) => (
                  <PlanCard
                    environments={projectEnvironments}
                    key={plan.id}
                    onCopy={() => copyPlan(plan)}
                    onDelete={() => setPendingDelete({ type: "plan", plan })}
                    onEdit={() => startEdit(plan)}
                    onRun={() => {
                      setRunEnvironmentId(environmentId ?? plan.environmentIds[0]);
                      setRunDialogPlan(plan);
                    }}
                    onToggle={() => togglePlan(plan)}
                    plan={plan}
                  />
                ))}
                <Pagination
                  itemLabel="个计划"
                  onPageChange={planPagination.setPage}
                  onPageSizeChange={planPagination.setPageSize}
                  page={planPagination.page}
                  pageSize={planPagination.pageSize}
                  total={filteredPlans.length}
                />
              </div>
            )}
          </article>
        </>
      )}

      {activeTab === "calendar" && <ScheduleCalendar environments={projectEnvironments} plans={plans} schedule={schedule} />}
      {activeTab === "history" && (
        <RunHistory
          onClear={() => {
            if (projectId && runs.length > 0) setPendingDelete({ type: "history" });
          }}
          onDelete={(run) => {
            if (!projectId) return;
            void deletePlanRun(projectId, run.id).then(reloadData).catch((error) => onAction(error instanceof Error ? error.message : "执行记录删除失败"));
          }}
          runs={runs}
        />
      )}

      {editorMode && (
        <PlanEditor
          assetError={assetError}
          assets={filteredAssets}
          assetsLoading={assetsLoading}
          assetSearch={assetSearch}
          environments={projectEnvironments}
          form={form}
          message={formMessage}
          mode={editorMode}
          onAssetSearch={setAssetSearch}
          onChange={setForm}
          onClose={() => setEditorMode(null)}
          onSubmit={submitPlan}
        />
      )}

      {runDialogPlan && (
        <div className="modal-backdrop" role="presentation">
          <section aria-modal="true" className="plan-run-modal" role="dialog">
            <div className="modal-head">
              <div><span className="eyebrow">手动执行</span><h3>{runDialogPlan.name}</h3><p>本次运行将生成一条计划执行历史记录。</p></div>
              <button className="icon-btn" onClick={() => setRunDialogPlan(undefined)} title="关闭" type="button"><Icon name="close" /></button>
            </div>
            <label className="plan-field"><span>执行环境</span><select onChange={(event) => setRunEnvironmentId(Number(event.target.value))} value={runEnvironmentId ?? ""}>
              <option disabled value="">请选择环境</option>
              {projectEnvironments.filter((item) => runDialogPlan.environmentIds.includes(item.id)).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select></label>
            <div className="plan-run-summary"><span><Icon name="account_tree" />{runDialogPlan.targets.length} 个执行目标</span><span><Icon name="schedule" />超时 {runDialogPlan.timeoutMinutes} 分钟</span><span><Icon name="replay" />失败重试 {runDialogPlan.retryCount} 次</span></div>
            <div className="modal-actions"><button className="btn" onClick={() => setRunDialogPlan(undefined)} type="button">取消</button><button className="btn primary" disabled={!runEnvironmentId} onClick={executePlan} type="button"><Icon name="play_arrow" />确认运行</button></div>
          </section>
        </div>
      )}
      {pendingDelete && <ConfirmDialog
        busy={deleteBusy}
        confirmLabel={pendingDelete.type === "plan" ? "确认删除" : "确认清空"}
        description={pendingDelete.type === "plan"
          ? `测试计划“${pendingDelete.plan.name}”将被删除，已有执行历史不会随计划一起删除。`
          : "当前项目下的全部计划执行历史将被清空，此操作无法恢复。"}
        onCancel={() => setPendingDelete(undefined)}
        onConfirm={() => void (pendingDelete.type === "plan" ? removePlan(pendingDelete.plan) : clearRunHistory())}
        title={pendingDelete.type === "plan" ? "删除测试计划？" : "清空执行历史？"}
      />}
    </section>
  );
}

function PlanCard({
  environments,
  onCopy,
  onDelete,
  onEdit,
  onRun,
  onToggle,
  plan,
}: {
  environments: EnvironmentOption[];
  onCopy: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onRun: () => void;
  onToggle: () => void;
  plan: TestPlan;
}) {
  return (
    <article className={!plan.enabled ? "plan-card disabled" : "plan-card"}>
      <div className="plan-overview">
        <div className="plan-heading"><strong>{plan.name}</strong><span>{plan.id}</span>{!plan.enabled && <b>已停用</b>}</div>
        <p>{plan.description || "暂无计划说明"}</p>
        <div className="tag-row"><span>{triggerLabel(plan)}</span><span>{plan.executionMode === "parallel" ? "并行执行" : "串行执行"}</span>{plan.tags.map((tag) => <span key={tag}>#{tag}</span>)}</div>
      </div>
      <div className="plan-targets">
        <div className="plan-targets-head"><strong>执行目标</strong><small>{plan.targets.length} 项</small></div>
        <div className="pipeline">{plan.targets.slice(0, 4).map((target) => <span key={target.id}>{target.method} · {target.name}</span>)}{plan.targets.length > 4 && <span>+{plan.targets.length - 4}</span>}</div>
        <small>{plan.environmentIds.map((id) => environments.find((item) => item.id === id)?.name ?? `环境 ${id}`).join(" · ")}</small>
      </div>
      <div className="plan-side">
        <div><strong>{plan.lastRunAt ? formatDate(plan.lastRunAt) : "尚未执行"}</strong><small>最近执行 · 更新于 {formatDate(plan.updatedAt)}</small></div>
        <label className="switch" title={plan.enabled ? "停用计划" : "启用计划"}><input checked={plan.enabled} onChange={onToggle} type="checkbox" /><i /></label>
        <button className="icon-btn plan-run-btn" onClick={onRun} title={`运行 ${plan.name}`} type="button"><Icon name="play_arrow" /></button>
        <div className="plan-card-actions">
          <button onClick={onEdit} type="button"><Icon name="edit" />编辑</button>
          <button onClick={onCopy} type="button"><Icon name="content_copy" />复制</button>
          <button className="danger" onClick={onDelete} type="button"><Icon name="delete" />删除</button>
        </div>
      </div>
    </article>
  );
}

function PlanEmpty({ hasPlans, hasProject, onCreate }: { hasPlans: boolean; hasProject: boolean; onCreate: () => void }) {
  return (
    <div className="list-state empty"><span className="list-state-icon"><Icon name={hasPlans ? "filter_alt_off" : "event_note"} /></span><h4>{hasPlans ? "没有匹配的测试计划" : "暂无测试计划"}</h4><p>{hasProject ? hasPlans ? "调整搜索或筛选条件后重试。" : "创建计划，组合已保存的测试场景并配置运行策略。" : "请先从顶部选择项目。"}</p>{hasProject && !hasPlans && <button className="btn primary" onClick={onCreate} type="button"><Icon name="add" />新建计划</button>}</div>
  );
}

function PlanEditor({
  assetError,
  assets,
  assetsLoading,
  assetSearch,
  environments,
  form,
  message,
  mode,
  onAssetSearch,
  onChange,
  onClose,
  onSubmit,
}: {
  assetError: string;
  assets: PlanTarget[];
  assetsLoading: boolean;
  assetSearch: string;
  environments: EnvironmentOption[];
  form: PlanForm;
  message: string;
  mode: PlanEditorMode;
  onAssetSearch: (value: string) => void;
  onChange: (form: PlanForm) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const patch = <K extends keyof PlanForm>(key: K, value: PlanForm[K]) => onChange({ ...form, [key]: value });
  const cronExecutionTime = cronToDailyTime(form.cronExpression);
  const patchCronExecutionTime = (value: string) => onChange({ ...form, cronExpression: dailyTimeToCron(value) });
  const toggleEnvironment = (id: number) => patch("environmentIds", form.environmentIds.includes(id) ? form.environmentIds.filter((item) => item !== id) : [...form.environmentIds, id]);
  const toggleTarget = (target: PlanTarget) => patch("targets", form.targets.some((item) => item.id === target.id) ? form.targets.filter((item) => item.id !== target.id) : [...form.targets, target]);
  const moveTarget = (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= form.targets.length) return;
    const next = [...form.targets];
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    patch("targets", next);
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <form aria-labelledby="plan-editor-title" aria-modal="true" className="plan-editor-modal" onSubmit={onSubmit} role="dialog">
        <div className="modal-head"><div><span className="eyebrow">{mode === "create" ? "创建计划" : "编辑计划"}</span><h3 id="plan-editor-title">{mode === "create" ? "新建自动化测试计划" : form.name}</h3><p>配置执行资产、环境、触发方式和失败处理策略。</p><div className="plan-editor-summary"><span><Icon name="cloud" />{form.environmentIds.length} 个环境</span><span><Icon name="playlist_add_check" />{form.targets.length} 个目标</span><span><Icon name="schedule" />{form.triggerType === "manual" ? "手动触发" : form.triggerType === "cron" ? "Cron 定时" : "Webhook"}</span></div></div><button className="icon-btn" onClick={onClose} title="关闭" type="button"><Icon name="close" /></button></div>
        <div className="plan-editor-scroll">
        <div className="plan-editor-grid">
          <section className="plan-editor-main">
            <div className="plan-form-section"><h4>基础信息</h4><div className="plan-form-grid">
              <label className="plan-field"><span>计划名称 <span aria-hidden="true" className="required-mark">*</span></span><input onChange={(event) => patch("name", event.target.value)} placeholder="例如：核心链路夜间回归" value={form.name} /></label>
              <label className="plan-field"><span>标签</span><input onChange={(event) => patch("tagText", event.target.value)} placeholder="回归, P0, 夜间任务" value={form.tagText} /></label>
              <label className="plan-field full"><span>计划说明</span><textarea onChange={(event) => patch("description", event.target.value)} placeholder="说明计划目标与执行范围" value={form.description} /></label>
            </div></div>
            <div className="plan-form-section"><div className="plan-section-head"><h4>执行环境 <span aria-hidden="true" className="required-mark">*</span></h4><span className="plan-section-count">{form.environmentIds.length} 已选</span></div><div className="plan-choice-grid">{environments.map((environment) => { const selected = form.environmentIds.includes(environment.id); return <button className={selected ? "plan-choice selected" : "plan-choice"} key={environment.id} onClick={() => toggleEnvironment(environment.id)} type="button"><Icon name="cloud" /><span><strong>{environment.name}</strong><small>{environment.baseUrl || "未配置 Base URL"}</small></span><span className={selected ? "plan-choice-check visible" : "plan-choice-check"}><Icon name="check_circle" /></span></button> })}{environments.length === 0 && <p className="plan-empty-copy">当前项目暂无环境，请先创建环境配置。</p>}</div></div>
            <div className="plan-form-section"><div className="plan-section-head"><div><h4>执行目标 <span aria-hidden="true" className="required-mark">*</span></h4><small className="plan-section-hint">点击场景加入执行队列</small></div><div className="plan-section-tools"><span className="plan-section-count">{form.targets.length} 已选</span><label className="inline-field"><Icon name="search" /><input onChange={(event) => onAssetSearch(event.target.value)} placeholder="搜索测试场景" value={assetSearch} /></label></div></div>{assetError && <p className="form-message">{assetError}</p>}<div className="plan-assets">{assetsLoading ? <p className="plan-empty-copy">正在加载测试场景...</p> : assets.map((asset) => <button className={form.targets.some((item) => item.id === asset.id) ? "plan-asset selected" : "plan-asset"} key={asset.id} onClick={() => toggleTarget(asset)} type="button"><b>{asset.method}</b><span><strong>{asset.name}</strong><small>场景 v{asset.scenarioVersion ?? "-"} · {asset.path || "无说明"}</small></span><Icon name={form.targets.some((item) => item.id === asset.id) ? "check_circle" : "add_circle"} /></button>)}{!assetsLoading && assets.length === 0 && <p className="plan-empty-copy">暂无可绑定的测试场景。</p>}</div></div>
          </section>
          <aside className="plan-editor-side">
            <div className="plan-form-section"><div className="plan-section-head"><div><h4>已选执行顺序</h4><small className="plan-section-hint">使用箭头调整执行顺序</small></div><span className="plan-section-count">{form.targets.length} 项</span></div><div className="selected-targets">{form.targets.map((target, index) => <div className="selected-target" key={target.id}><b>{index + 1}</b><span><strong>{target.name}</strong><small>SCENARIO · v{target.scenarioVersion ?? "-"}</small></span><button disabled={index === 0} onClick={() => moveTarget(index, -1)} title="上移" type="button"><Icon name="arrow_upward" /></button><button disabled={index === form.targets.length - 1} onClick={() => moveTarget(index, 1)} title="下移" type="button"><Icon name="arrow_downward" /></button><button className="danger" onClick={() => toggleTarget(target)} title="移除" type="button"><Icon name="close" /></button></div>)}{form.targets.length === 0 && <div className="plan-empty-selection"><Icon name="playlist_add" /><strong>尚未选择执行目标</strong><span>从左侧选择场景，它们会按加入顺序执行</span></div>}</div></div>
            <div className="plan-form-section"><h4>触发与执行策略</h4><label className="plan-field"><span>触发方式</span><select onChange={(event) => patch("triggerType", event.target.value as PlanTriggerType)} value={form.triggerType}><option value="manual">手动触发</option><option value="cron">Cron 定时</option><option value="webhook">Webhook</option></select></label>{form.triggerType === "cron" && <><div className="plan-cron-grid"><label className="plan-field"><span>执行时间</span><input aria-label="执行时间" onChange={(event) => patchCronExecutionTime(event.target.value)} type="time" value={cronExecutionTime} /></label><label className="plan-field"><span>调度时区</span><input onChange={(event) => patch("scheduleTimezone", event.target.value)} value={form.scheduleTimezone} /></label></div><label className="plan-field"><span>Cron 表达式</span><input aria-label="Cron 表达式" onChange={(event) => patch("cronExpression", event.target.value)} value={form.cronExpression} /></label><small className="plan-section-hint">选择时间后生成每天执行的 Cron，表达式仍可手动调整。</small></>}{form.triggerType === "webhook" && <label className="plan-field"><span>Webhook 事件</span><input onChange={(event) => patch("webhookEvent", event.target.value)} value={form.webhookEvent} /></label>}<div className="plan-form-grid"><label className="plan-field"><span>执行模式</span><select onChange={(event) => patch("executionMode", event.target.value as PlanExecutionMode)} value={form.executionMode}><option value="serial">串行</option><option value="parallel">并行</option></select></label><label className="plan-field"><span>失败策略</span><select onChange={(event) => patch("failurePolicy", event.target.value as PlanFailurePolicy)} value={form.failurePolicy}><option value="stop">失败后停止</option><option value="continue">失败后继续</option></select></label><label className="plan-field"><span>失败重试次数</span><input max="10" min="0" onChange={(event) => patch("retryCount", Number(event.target.value))} type="number" value={form.retryCount} /></label><label className="plan-field"><span>超时分钟数</span><input max="1440" min="1" onChange={(event) => patch("timeoutMinutes", Number(event.target.value))} type="number" value={form.timeoutMinutes} /></label></div><label className="plan-field"><span>通知邮箱</span><input onChange={(event) => patch("notificationText", event.target.value)} placeholder="qa@example.com, owner@example.com" value={form.notificationText} /></label><label className="plan-enable-toggle"><input checked={form.enabled} onChange={(event) => patch("enabled", event.target.checked)} type="checkbox" /><span><strong>保存后启用计划</strong><small>停用计划不会被定时或 Webhook 触发</small></span></label></div>
          </aside>
        </div>
        {message && <p className="plan-form-message">{message}</p>}
        <p className="plan-editor-save-note">保存后可在计划列表中立即执行</p>
        </div>
        <div className="modal-actions plan-editor-actions"><button className="btn" onClick={onClose} type="button">取消</button><button className="btn primary" type="submit"><Icon name="save" />{mode === "create" ? "创建计划" : "保存计划"}</button></div>
      </form>
    </div>
  );
}

function ScheduleCalendar({ environments, plans, schedule }: { environments: EnvironmentOption[]; plans: TestPlan[]; schedule: PlanSchedule[] }) {
  const entries = calendarEntries(schedule);
  return (
    <article className="panel plan-calendar-panel"><div className="panel-title"><div><h3>未来 14 天调度</h3><p className="plan-panel-hint">展示后端生成的真实 Cron 调度实例</p></div><span className="status status-通过">{plans.filter((plan) => plan.enabled && plan.triggerType === "cron").length} 个定时计划</span></div><div className="plan-calendar">{entries.map(({ date, schedules }) => <section className={date.toDateString() === new Date().toDateString() ? "plan-calendar-day today" : "plan-calendar-day"} key={date.toISOString()}><header><strong>{date.toLocaleDateString("zh-CN", { weekday: "short" })}</strong><span>{date.getMonth() + 1}/{date.getDate()}</span></header><div>{schedules.map((item) => <article key={item.id}><b>{item.planName}</b><small>{formatDate(item.scheduledAt)}</small><span>{item.environmentName ?? environments.find((environment) => environment.id === item.environmentId)?.name ?? "全部计划环境"}</span></article>)}{schedules.length === 0 && <p>无调度</p>}</div></section>)}</div></article>
  );
}

function RunHistory({ onClear, onDelete, runs }: { onClear: () => void; onDelete: (run: PlanRun) => void; runs: PlanRun[] }) {
  const pagination = usePagination(runs, 10, String(runs.length));
  return (
    <article className="panel"><div className="panel-title"><div><h3>计划执行历史</h3><p className="plan-panel-hint">记录当前项目从测试计划发起的运行</p></div><button disabled={runs.length === 0} onClick={onClear} type="button">清空历史</button></div>{runs.length === 0 ? <div className="list-state empty"><span className="list-state-icon"><Icon name="history" /></span><h4>暂无执行历史</h4><p>从计划列表手动运行计划后，结果会显示在这里。</p></div> : <><table className="data-table plan-history-table"><thead><tr><th>运行编号</th><th>计划</th><th>环境</th><th>状态</th><th>目标结果</th><th>耗时</th><th>触发时间</th><th>操作</th></tr></thead><tbody>{pagination.pageItems.map((run) => <tr key={run.id}><td><strong>{run.id}</strong><small>{run.operator}</small></td><td>{run.planName}</td><td>{run.environmentName ?? "-"}</td><td><span className={`status ${run.status === "passed" ? "status-通过" : run.status === "failed" ? "status-失败" : "status-muted"}`}>{run.status}</span></td><td>{run.passedCount} 通过 / {run.failedCount} 失败 / {run.targetCount} 总计</td><td>{run.durationMs ? `${(run.durationMs / 1000).toFixed(1)}s` : "-"}</td><td>{formatDate(run.startedAt)}</td><td><button className="icon-btn" onClick={() => onDelete(run)} title="删除执行记录" type="button"><Icon name="delete" /></button></td></tr>)}</tbody></table><Pagination itemLabel="条记录" onPageChange={pagination.setPage} onPageSizeChange={pagination.setPageSize} page={pagination.page} pageSize={pagination.pageSize} total={runs.length} /></>}</article>
  );
}
