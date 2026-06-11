import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ScenariosPage } from "./ScenariosPage";

const api = vi.hoisted(() => {
  const scenariosByProject = new Map<number, any[]>();
  const runsByProject = new Map<number, any[]>();
  const save = async (projectId: number, input: any) => {
    const existing = (scenariosByProject.get(projectId) ?? []).find((item) => item.id === input.id);
    const scenario = {
      ...input,
      id: input.id || String(Date.now()),
      projectId,
      version: existing ? existing.version + 1 : 1,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    scenariosByProject.set(projectId, [scenario, ...(scenariosByProject.get(projectId) ?? []).filter((item) => item.id !== scenario.id)]);
    return scenario;
  };
  return {
    scenariosByProject,
    runsByProject,
    deleteScenario: vi.fn(async (projectId: number, scenarioId: string) => {
      scenariosByProject.set(projectId, (scenariosByProject.get(projectId) ?? []).filter((item) => item.id !== scenarioId));
    }),
    duplicateScenario: vi.fn(async (projectId: number, source: any) => save(projectId, {
      ...source,
      id: "",
      version: 0,
      name: `${source.name} - 副本`,
    })),
    getScenario: vi.fn(async (projectId: number, scenarioId: string) =>
      (scenariosByProject.get(projectId) ?? []).find((item) => item.id === scenarioId)),
    getScenarioRun: vi.fn(async (projectId: number, runId: string) =>
      (runsByProject.get(projectId) ?? []).find((item) => item.id === runId)),
    listScenarioRuns: vi.fn(async (projectId: number) => runsByProject.get(projectId) ?? []),
    listScenarios: vi.fn(async (projectId: number) => scenariosByProject.get(projectId) ?? []),
    runScenario: vi.fn(async (projectId: number, scenario: any) => {
      const run = {
        id: `run-${Date.now()}`,
        scenarioId: scenario.id,
        scenarioName: scenario.name,
        projectId,
        environmentId: scenario.environmentId,
        environmentName: "UAT",
        datasetName: scenario.datasets[0]?.name ?? "空变量",
        status: "passed",
        startedAt: new Date().toISOString(),
        durationMs: 350,
        stepResults: scenario.steps.map((step: any) => ({
          stepId: step.id,
          name: step.name,
          status: "passed",
          durationMs: 350,
          message: "执行通过",
        })),
      };
      runsByProject.set(projectId, [run, ...(runsByProject.get(projectId) ?? [])]);
      return [run];
    }),
    saveScenario: vi.fn(save),
  };
});

vi.mock("../api/scenarios", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/scenarios")>();
  return {
    ...actual,
    deleteScenario: api.deleteScenario,
    duplicateScenario: api.duplicateScenario,
    getScenario: api.getScenario,
    getScenarioRun: api.getScenarioRun,
    listScenarioRuns: api.listScenarioRuns,
    listScenarios: api.listScenarios,
    runScenario: api.runScenario,
    saveScenario: api.saveScenario,
  };
});

const environments = [
  { id: 1, name: "UAT", baseUrl: "https://uat.example.com", description: "", isDefault: true },
  { id: 2, name: "预发布", baseUrl: "https://staging.example.com", description: "", isDefault: false },
];

function mockAssets() {
  return vi.spyOn(globalThis, "fetch")
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ code: 0, data: [{ id: 10, name: "登录接口", method: "POST", path: "/login" }] }),
    } as Response)
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ code: 0, data: [{ id: 11, name: "消息订阅", path: "/events" }] }),
    } as Response);
}

describe("ScenariosPage", () => {
  beforeEach(() => {
    api.scenariosByProject.clear();
    api.runsByProject.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates, saves with a backend version, and executes a scenario", async () => {
    mockAssets();
    render(<ScenariosPage environmentId={1} environments={environments} onAction={vi.fn()} projectId={7} />);

    fireEvent.click(screen.getByTitle("新建场景"));
    fireEvent.change(screen.getByLabelText("场景名称"), { target: { value: "登录消息场景" } });
    fireEvent.click(await screen.findByRole("button", { name: /登录接口/ }));
    fireEvent.change(screen.getByLabelText("步骤配置 JSON"), { target: { value: '{"extract":"token"}' } });
    fireEvent.click(screen.getByRole("button", { name: "保存场景" }));

    expect(await screen.findByText(/1 步骤 · 1 数据集 · v1/)).toBeInTheDocument();
    expect(api.saveScenario).toHaveBeenCalledWith(7, expect.objectContaining({ id: "", version: 0 }));

    fireEvent.click(screen.getByRole("button", { name: "运行场景" }));
    expect(await screen.findByRole("button", { name: "调试记录" })).toHaveClass("active");
    expect(screen.getByText("UAT · 默认数据")).toBeInTheDocument();
    expect(screen.getByText("执行通过")).toBeInTheDocument();
    expect(api.runScenario).toHaveBeenCalled();
  });

  it("supports step ordering and server-backed datasets", async () => {
    mockAssets();
    render(<ScenariosPage environmentId={1} environments={environments} onAction={vi.fn()} projectId={3} />);

    fireEvent.click(screen.getByTitle("新建场景"));
    fireEvent.click(await screen.findByRole("button", { name: /登录接口/ }));
    fireEvent.click(screen.getByRole("button", { name: /等待事件/ }));
    const waitStep = screen.getAllByText("等待事件").find((element) => element.closest(".scenario-step-card"))?.closest(".scenario-step-card") as HTMLElement;
    fireEvent.click(within(waitStep).getByTitle("上移"));
    expect(document.querySelectorAll(".scenario-step-card")[0]).toHaveTextContent("等待事件");

    fireEvent.click(screen.getByRole("button", { name: "数据驱动" }));
    fireEvent.click(screen.getByRole("button", { name: "新增数据集" }));
    fireEvent.change(screen.getByLabelText("数据集 2 名称"), { target: { value: "VIP 用户" } });
    fireEvent.change(screen.getByLabelText("VIP 用户 变量 JSON"), { target: { value: '{"user_id":1001}' } });
    fireEvent.click(screen.getByRole("button", { name: "保存场景" }));

    await waitFor(() => expect(api.saveScenario).toHaveBeenCalledWith(3, expect.objectContaining({
      datasets: expect.arrayContaining([expect.objectContaining({ name: "VIP 用户" })]),
      steps: expect.arrayContaining([expect.objectContaining({ name: "等待事件" })]),
    })));
  });

  it("loads the selected project only", async () => {
    api.scenariosByProject.set(1, [{
      id: "1",
      projectId: 1,
      version: 1,
      name: "项目一场景",
      description: "",
      environmentId: 1,
      tags: [],
      steps: [],
      datasets: [],
      createdAt: "",
      updatedAt: "",
    }]);
    mockAssets();
    const { rerender } = render(<ScenariosPage environmentId={1} environments={environments} onAction={vi.fn()} projectId={1} />);
    expect(await screen.findByText("项目一场景")).toBeInTheDocument();

    mockAssets();
    rerender(<ScenariosPage environmentId={1} environments={environments} onAction={vi.fn()} projectId={2} />);
    await waitFor(() => expect(screen.queryByText("项目一场景")).not.toBeInTheDocument());
    expect(screen.getByText("暂无场景")).toBeInTheDocument();
  });

  it("copies and soft-deletes a saved scenario through the API", async () => {
    mockAssets();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<ScenariosPage environmentId={1} environments={environments} onAction={vi.fn()} projectId={9} />);

    fireEvent.click(screen.getByTitle("新建场景"));
    fireEvent.click(screen.getByRole("button", { name: /等待事件/ }));
    fireEvent.click(screen.getByRole("button", { name: "保存场景" }));
    await screen.findByText(/1 步骤 · 1 数据集 · v1/);
    fireEvent.click(screen.getByRole("button", { name: "复制" }));

    expect(await screen.findByText("未命名测试场景 - 副本")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "删除" }));

    await waitFor(() => expect(screen.queryByText("未命名测试场景 - 副本")).not.toBeInTheDocument());
    expect(api.deleteScenario).toHaveBeenCalled();
  });
});
