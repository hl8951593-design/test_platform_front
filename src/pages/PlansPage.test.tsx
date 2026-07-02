import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { PlansPage } from "./PlansPage";

const api = vi.hoisted(() => {
  const plansByProject = new Map<number, any[]>();
  const runsByProject = new Map<number, any[]>();
  return {
    plansByProject,
    runsByProject,
    clearPlanRuns: vi.fn(async (projectId: number) => runsByProject.set(projectId, [])),
    deletePlan: vi.fn(async (projectId: number, planId: string) => {
      plansByProject.set(projectId, (plansByProject.get(projectId) ?? []).filter((plan) => plan.id !== planId));
    }),
    deletePlanRun: vi.fn(async (projectId: number, runId: string) => {
      runsByProject.set(projectId, (runsByProject.get(projectId) ?? []).filter((run) => run.id !== runId));
    }),
    duplicatePlan: vi.fn(async (projectId: number, source: any) => {
      const plan = { ...source, id: String(Date.now()), version: 1, name: `${source.name} - 副本`, enabled: false };
      plansByProject.set(projectId, [plan, ...(plansByProject.get(projectId) ?? [])]);
      return plan;
    }),
    exportPlans: vi.fn(async (projectId: number) => ({ plans: plansByProject.get(projectId) ?? [] })),
    importPlans: vi.fn(async () => []),
    listPlanRuns: vi.fn(async (projectId: number) => runsByProject.get(projectId) ?? []),
    listPlanSchedule: vi.fn(async (projectId: number) => (plansByProject.get(projectId) ?? [])
      .filter((plan) => plan.enabled && plan.triggerType === "cron")
      .map((plan) => ({
        id: `schedule-${plan.id}`,
        planId: plan.id,
        planName: plan.name,
        environmentId: plan.environmentIds[0],
        scheduledAt: new Date().toISOString(),
      }))),
    listPlans: vi.fn(async (projectId: number) => plansByProject.get(projectId) ?? []),
    runPlan: vi.fn(async (projectId: number, plan: any, environmentId: number) => {
      const run = {
        id: `run-${Date.now()}`,
        planId: plan.id,
        planName: plan.name,
        projectId,
        environmentId,
        status: "pending",
        trigger: "manual",
        startedAt: new Date().toISOString(),
        targetCount: plan.targets.length,
        passedCount: 0,
        failedCount: 0,
        operator: "tester",
      };
      runsByProject.set(projectId, [run, ...(runsByProject.get(projectId) ?? [])]);
      return run;
    }),
    savePlan: vi.fn(async (projectId: number, input: any) => {
      const existing = (plansByProject.get(projectId) ?? []).find((plan) => plan.id === input.id);
      const plan = {
        ...input,
        id: input.id || String(Date.now()),
        projectId,
        version: existing ? existing.version + 1 : 1,
        createdAt: existing?.createdAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      plansByProject.set(projectId, [plan, ...(plansByProject.get(projectId) ?? []).filter((item) => item.id !== plan.id)]);
      return plan;
    }),
    setPlanEnabled: vi.fn(async (projectId: number, source: any, enabled: boolean) => {
      const plan = { ...source, enabled, version: source.version + 1 };
      plansByProject.set(projectId, (plansByProject.get(projectId) ?? []).map((item) => item.id === plan.id ? plan : item));
      return plan;
    }),
    listScenarios: vi.fn(async () => [{
      id: "10",
      projectId: 7,
      version: 3,
      name: "登录消息场景",
      description: "",
      environmentId: 1,
      tags: [],
      steps: [{ id: "STEP-1" }],
      datasets: [{ id: "DATA-1" }],
      createdAt: "",
      updatedAt: "",
    }]),
  };
});

vi.mock("../api/plans", () => ({
  clearPlanRuns: api.clearPlanRuns,
  deletePlan: api.deletePlan,
  deletePlanRun: api.deletePlanRun,
  duplicatePlan: api.duplicatePlan,
  exportPlans: api.exportPlans,
  importPlans: api.importPlans,
  listPlanRuns: api.listPlanRuns,
  listPlanSchedule: api.listPlanSchedule,
  listPlans: api.listPlans,
  runPlan: api.runPlan,
  savePlan: api.savePlan,
  setPlanEnabled: api.setPlanEnabled,
}));

vi.mock("../api/scenarios", () => ({ listScenarios: api.listScenarios }));

const environments = [
  { id: 1, name: "UAT", baseUrl: "https://uat.example.com", description: "", isDefault: true },
  { id: 2, name: "Prod", baseUrl: "https://prod.example.com", description: "", isDefault: false },
];

describe("PlansPage", () => {
  beforeEach(() => {
    api.plansByProject.clear();
    api.runsByProject.clear();
    vi.clearAllMocks();
  });

  it("creates a scenario-backed plan, toggles it, and queues a run", async () => {
    const onAction = vi.fn();
    render(<PlansPage environmentId={1} environments={environments} onAction={onAction} projectId={7} />);

    fireEvent.click(screen.getAllByRole("button", { name: /新建计划/ })[0]);
    fireEvent.change(screen.getByPlaceholderText("例如：核心链路夜间回归"), { target: { value: "核心回归" } });
    fireEvent.click(await screen.findByRole("button", { name: /登录消息场景/ }));
    fireEvent.click(screen.getByRole("button", { name: "创建计划" }));

    expect(await screen.findByText("核心回归")).toBeInTheDocument();
    expect(api.savePlan).toHaveBeenCalledWith(7, expect.objectContaining({
      targets: [expect.objectContaining({ kind: "scenario", referenceId: "10", scenarioVersion: 3 })],
    }));

    const card = screen.getByText("核心回归").closest(".plan-card") as HTMLElement;
    fireEvent.click(within(card).getByTitle("停用计划"));
    await waitFor(() => expect(within(card).getByText("已停用")).toBeInTheDocument());

    fireEvent.click(within(card).getByTitle("运行 核心回归"));
    fireEvent.click(screen.getByRole("button", { name: "确认运行" }));

    expect(await screen.findByText("计划执行历史")).toBeInTheDocument();
    expect(screen.getByText("pending")).toBeInTheDocument();
    expect(api.runPlan).toHaveBeenCalledWith(7, expect.any(Object), 1);
  });

  it("keeps server results isolated when the project changes", async () => {
    api.plansByProject.set(1, [{
      id: "1",
      projectId: 1,
      version: 1,
      name: "项目一计划",
      description: "",
      enabled: true,
      triggerType: "manual",
      cronExpression: "",
      scheduleTimezone: "Asia/Shanghai",
      webhookEvent: "",
      environmentIds: [1],
      targets: [],
      executionMode: "serial",
      failurePolicy: "stop",
      retryCount: 0,
      timeoutMinutes: 30,
      notificationEmails: [],
      tags: [],
      createdAt: "",
      updatedAt: "",
    }]);
    const { rerender } = render(<PlansPage environmentId={1} environments={environments} onAction={vi.fn()} projectId={1} />);
    expect(await screen.findByText("项目一计划")).toBeInTheDocument();

    rerender(<PlansPage environmentId={1} environments={environments} onAction={vi.fn()} projectId={2} />);
    await waitFor(() => expect(screen.queryByText("项目一计划")).not.toBeInTheDocument());
    expect(screen.getByText("暂无测试计划")).toBeInTheDocument();
  });

  it("renders backend schedule instances instead of calculating cron locally", async () => {
    api.plansByProject.set(3, [{
      id: "1",
      projectId: 3,
      version: 1,
      name: "夜间回归",
      description: "",
      enabled: true,
      triggerType: "cron",
      cronExpression: "0 2 * * *",
      scheduleTimezone: "Asia/Shanghai",
      webhookEvent: "",
      environmentIds: [1],
      targets: [],
      executionMode: "serial",
      failurePolicy: "stop",
      retryCount: 0,
      timeoutMinutes: 30,
      notificationEmails: [],
      tags: [],
      createdAt: "",
      updatedAt: "",
    }]);
    render(<PlansPage environments={environments} onAction={vi.fn()} projectId={3} />);

    fireEvent.click(screen.getByRole("button", { name: "调度日历" }));
    expect(await screen.findByText("未来 14 天调度")).toBeInTheDocument();
    expect(screen.getAllByText("夜间回归").length).toBeGreaterThan(0);
    expect(api.listPlanSchedule).toHaveBeenCalledWith(3);
  });

  it("generates a daily cron expression from the selected execution time", async () => {
    render(<PlansPage environmentId={1} environments={environments} onAction={vi.fn()} projectId={7} />);

    fireEvent.click(screen.getAllByRole("button", { name: /新建计划/ })[0]);
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("触发方式"), { target: { value: "cron" } });
    fireEvent.change(within(dialog).getByLabelText("执行时间"), { target: { value: "09:30" } });

    expect(within(dialog).getByLabelText("Cron 表达式")).toHaveValue("30 9 * * *");
  });

  it("uses the app confirmation dialog before deleting a plan", async () => {
    const plan = {
      id: "PLAN-DELETE",
      projectId: 7,
      version: 1,
      name: "待删除计划",
      description: "",
      enabled: true,
      triggerType: "manual",
      cronExpression: "",
      scheduleTimezone: "Asia/Shanghai",
      webhookEvent: "",
      environmentIds: [1],
      targets: [],
      executionMode: "serial",
      failurePolicy: "stop",
      retryCount: 0,
      timeoutMinutes: 30,
      notificationEmails: [],
      tags: [],
      createdAt: "",
      updatedAt: "",
    };
    api.plansByProject.set(7, [plan]);
    render(<PlansPage environments={environments} onAction={vi.fn()} projectId={7} />);

    const card = (await screen.findByText(plan.name)).closest(".plan-card") as HTMLElement;
    fireEvent.click(within(card).getByRole("button", { name: "删除" }));
    const dialog = screen.getByRole("alertdialog", { name: "删除测试计划？" });
    expect(api.deletePlan).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(api.deletePlan).not.toHaveBeenCalled();

    fireEvent.click(within(card).getByRole("button", { name: "删除" }));
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
    await waitFor(() => expect(api.deletePlan).toHaveBeenCalledWith(7, plan.id));
  });
});
