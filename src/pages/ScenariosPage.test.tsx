import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ScenariosPage } from "./ScenariosPage";

const api = vi.hoisted(() => {
  const scenariosByProject = new Map<number, any[]>();
  const runsByProject = new Map<number, any[]>();
  let lastAiRunPayload: any;
  const editorScenario = (scenario: any) => scenario && ({ ...scenario, steps: scenario.steps.map((step: any) => ({ nodeId: step.nodeId ?? `NODE-${step.id}`, actionPosition: step.actionPosition ?? "main", ...step })) });
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
    resetAiRunPayload: () => {
      lastAiRunPayload = undefined;
    },
    composeScenarioWithAi: vi.fn(async (_projectId: number, environmentId: number, payload: any) => ({
      projectId: _projectId,
      environmentId,
      sourceSummary: "组合登录后查询用户详情",
      scenario: {
        id: "",
        projectId: _projectId,
        version: 0,
        name: payload.scenario_name || "AI 组合场景",
        description: payload.requirement,
        environmentId,
        tags: ["ai-composed"],
        datasets: [],
        createdAt: "",
        updatedAt: "",
        steps: [{
          id: "AI-STEP-1",
          kind: "api_case",
          referenceId: payload.http_test_case_ids[0],
          name: "登录接口",
          method: "POST",
          path: "/login",
          configText: "{}",
          continueOnFailure: false,
          nodeId: "AI-NODE-1",
          actionPosition: "main",
        }],
      },
      warnings: ["请确认 token 绑定"],
    })),
    createAiSkillRun: vi.fn(async (skillId: string, payload: any) => {
      lastAiRunPayload = { skillId, payload };
      return {
        runId: "ai-run-1",
        skillId,
        operation: payload.operation,
        status: "queued",
      };
    }),
    getAiSkillRun: vi.fn(async () => ({
      runId: "ai-run-1",
      skillId: "scenario-composer",
      operation: "compose",
      projectId: lastAiRunPayload?.payload?.project_id ?? 7,
      status: "completed",
      events: [],
      result: {
        project_id: lastAiRunPayload?.payload?.project_id ?? 7,
        environment_id: lastAiRunPayload?.payload?.environment_id ?? 1,
        source_summary: "组合登录后查询用户详情",
        scenario: {
          name: lastAiRunPayload?.payload?.input?.scenario_name || "AI 组合场景",
          description: lastAiRunPayload?.payload?.input?.requirement,
          environment_id: lastAiRunPayload?.payload?.environment_id ?? 1,
          tags: ["ai-composed"],
          datasets: [],
          nodes: [{
            id: "AI-NODE-1",
            name: "登录接口",
            test_case: {
              id: "AI-STEP-1",
              kind: "api_case",
              reference_id: lastAiRunPayload?.payload?.input?.http_test_case_ids?.[0],
              name: "登录接口",
              method: "POST",
              path: "/login",
              config: {},
            },
            before_actions: [],
            after_actions: [],
          }],
        },
        warnings: ["请确认 token 绑定"],
      },
      createdAt: "",
      updatedAt: "",
    })),
    subscribeAiSkillRunEvents: vi.fn(async (_runId: string, onEvent: (event: any) => void) => {
      onEvent({ id: "1", sequence: 1, event: "run.queued", payload: { skill_id: "scenario-composer", operation: "compose" } });
      onEvent({ id: "2", sequence: 2, event: "run.started", payload: {} });
      onEvent({ id: "3", sequence: 3, event: "model.delta", payload: { content: "正在分析候选用例..." } });
      onEvent({ id: "4", sequence: 4, event: "step.started", payload: { title: "读取候选用例" } });
      onEvent({ id: "5", sequence: 5, event: "tool.started", payload: { name: "load_candidate_cases", summary: "读取候选用例" } });
      onEvent({ id: "6", sequence: 6, event: "tool.completed", payload: { name: "load_candidate_cases", summary: "已读取 2 个候选" } });
      onEvent({
        id: "7",
        sequence: 7,
        event: "run.completed",
        payload: {
          result: {
            project_id: lastAiRunPayload?.payload?.project_id ?? 7,
            environment_id: lastAiRunPayload?.payload?.environment_id ?? 1,
            source_summary: "组合登录后查询用户详情",
            scenario: {
              name: lastAiRunPayload?.payload?.input?.scenario_name || "AI 组合场景",
              description: lastAiRunPayload?.payload?.input?.requirement,
              environment_id: lastAiRunPayload?.payload?.environment_id ?? 1,
              tags: ["ai-composed"],
              datasets: [],
              nodes: [{
                id: "AI-NODE-1",
                name: "登录接口",
                test_case: {
                  id: "AI-STEP-1",
                  kind: "api_case",
                  reference_id: lastAiRunPayload?.payload?.input?.http_test_case_ids?.[0],
                  name: "登录接口",
                  method: "POST",
                  path: "/login",
                  config: {},
                },
                before_actions: [],
                after_actions: [],
              }],
            },
            warnings: ["请确认 token 绑定"],
          },
        },
      });
    }),
    createScenario: vi.fn(save),
    deleteScenario: vi.fn(async (projectId: number, scenarioId: string) => {
      scenariosByProject.set(projectId, (scenariosByProject.get(projectId) ?? []).filter((item) => item.id !== scenarioId));
    }),
    deleteScenarioRun: vi.fn(async (projectId: number, runId: string) => {
      runsByProject.set(projectId, (runsByProject.get(projectId) ?? []).filter((item) => item.id !== runId));
    }),
    duplicateScenario: vi.fn(async (projectId: number, source: any) => save(projectId, {
      ...source,
      id: "",
      version: 0,
      name: `${source.name} - 副本`,
    })),
    getScenario: vi.fn(async (projectId: number, scenarioId: string) =>
      editorScenario((scenariosByProject.get(projectId) ?? []).find((item) => item.id === scenarioId))),
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
        datasetName: scenario.datasets[0]?.name ?? "无数据输入",
        status: "passed",
        startedAt: new Date().toISOString(),
        durationMs: 350,
        detailLoaded: true,
        stepResults: scenario.steps.map((step: any) => ({
          stepId: step.id,
          name: step.name,
          kind: step.kind,
          status: "passed",
          durationMs: 350,
          message: "执行通过",
          errorMessage: "",
          request: {
            method: step.method,
            url: `https://uat.example.com${step.path}`,
            headers: { Authorization: "***" },
            queryParams: { tenant_id: "1" },
            body: { company_id: 9527 },
          },
          response: {
            statusCode: 200,
            headers: { "content-type": "application/json" },
            body: { code: 0, message: "ok" },
          },
          assertions: [{
            name: "HTTP 状态码",
            status: "passed",
            message: "",
            expected: 200,
            actual: 200,
          }],
          extractedVariables: [],
          resolvedBindings: [],
        })),
      };
      runsByProject.set(projectId, [run, ...(runsByProject.get(projectId) ?? [])]);
      return {
        executionId: `execution-${run.id}`,
        scenarioId: scenario.id,
        scenarioVersion: scenario.version,
        status: "queued",
        createdAt: run.startedAt,
        runs: [{
          runId: run.id,
          datasetId: scenario.datasets[0]?.id,
          datasetName: run.datasetName,
          recordId: scenario.datasets[0]?.records?.[0]?.id,
          recordName: scenario.datasets[0]?.records?.[0]?.name,
          status: "queued",
          eventsUrl: `/api/v1/scenario-runs/${run.id}/events?project_id=${projectId}`,
          detailUrl: `/api/v1/scenario-runs/${run.id}?project_id=${projectId}`,
        }],
      };
    }),
    saveScenario: vi.fn(save),
    subscribeScenarioRunEvents: vi.fn(async (projectId: number, target: any, onEvent: (event: any) => void, _options?: any) => {
      const run = (runsByProject.get(projectId) ?? []).find((item) => item.id === target.runId);
      run?.stepResults.forEach((step: any, index: number) => {
        if (index > 0) onEvent({ event: "transition_started", targetStepIndex: index, sequence: index * 3 });
        onEvent({ event: "step_started", stepIndex: index, stepId: step.stepId, status: "running", sequence: index * 3 + 1 });
        onEvent({ event: "step_completed", stepIndex: index, stepId: step.stepId, status: "passed", sequence: index * 3 + 2 });
      });
      onEvent({ event: "run_completed", status: "passed", sequence: 999 });
    }),
  };
});

vi.mock("../api/scenarios", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/scenarios")>();
  return {
    ...actual,
    composeScenarioWithAi: api.composeScenarioWithAi,
    createScenario: api.createScenario,
    deleteScenario: api.deleteScenario,
    deleteScenarioRun: api.deleteScenarioRun,
    duplicateScenario: api.duplicateScenario,
    getScenario: api.getScenario,
    getScenarioRun: api.getScenarioRun,
    listScenarioRuns: api.listScenarioRuns,
    listScenarios: api.listScenarios,
    runScenario: api.runScenario,
    saveScenario: api.saveScenario,
    subscribeScenarioRunEvents: api.subscribeScenarioRunEvents,
  };
});

vi.mock("../api/aiSkillRuns", () => ({
  createAiSkillRun: api.createAiSkillRun,
  getAiSkillRun: api.getAiSkillRun,
  subscribeAiSkillRunEvents: api.subscribeAiSkillRunEvents,
}));

const environments = [
  { id: 1, name: "UAT", baseUrl: "https://uat.example.com", description: "", isDefault: true },
  { id: 2, name: "预发布", baseUrl: "https://staging.example.com", description: "", isDefault: false },
];

function mockAssets(options: { withMetadata?: boolean } = {}) {
  return vi.spyOn(globalThis, "fetch")
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        code: 0,
        data: [{
          id: 10,
          name: "登录接口",
          method: "POST",
          path: "/login",
          headers: { Authorization: "Bearer token" },
          query_params: { tenant_id: "1" },
          body_type: "json",
          body: { company_id: "", order: { user_id: "" } },
          extractors: options.withMetadata ? [{ name: "token", path: "data.token" }] : [],
          assertions: options.withMetadata ? [{ type: "status_code", expected: 200 }] : [],
          latest_execution_status: options.withMetadata ? "passed" : undefined,
        }],
      }),
    } as Response)
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ code: 0, data: [{ id: 11, name: "消息订阅", path: "/events", latest_execution_status: options.withMetadata ? "failed" : undefined, extractors: [], assertions: [] }] }),
    } as Response);
}

async function addMainAction(name: RegExp) {
  const sidebar = document.querySelector(".scenario-sidebar") as HTMLElement;
  const assetList = document.querySelector(".scenario-asset-list") as HTMLElement;
  fireEvent.click(await within(assetList).findByRole("button", { name }));
}

async function addAttachedAction(name: RegExp, position: "前置" | "后置" = "前置") {
  fireEvent.click(screen.getByRole("button", { name: `添加${position}动作` }));
  const picker = screen.getByRole("dialog", { name: `添加${position}动作` });
  fireEvent.click(within(picker).getByRole("button", { name }));
}

function expandRequestConfig() {
  const toggles = screen.getAllByRole("button", { name: /请求配置/ });
  const toggle = toggles[toggles.length - 1];
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute("aria-expanded", "true");
}

describe("ScenariosPage", () => {
    beforeEach(() => {
    api.scenariosByProject.clear();
    api.runsByProject.clear();
    api.resetAiRunPayload();
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
    await addMainAction(/登录接口/);
    expect(screen.getByText("测试用例节点 1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "添加后置动作" }));
    const teardownPicker = screen.getByRole("dialog", { name: "添加后置动作" });
    expect(within(teardownPicker).getByText(/动作将绑定/)).toBeInTheDocument();
    fireEvent.click(within(teardownPicker).getByRole("button", { name: /生成随机值/ }));
    expect(screen.queryByText("高级配置 JSON")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("步骤配置 JSON")).not.toBeInTheDocument();
    expect(screen.getByText("随机值生成")).toBeInTheDocument();
    expect(screen.getByText("后置 · 始终执行")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "保存场景" }));

    expect(await screen.findByText(/2 步骤 · 1 数据集 · v1/)).toBeInTheDocument();
    expect(api.saveScenario).toHaveBeenCalledWith(7, expect.objectContaining({
      id: "",
      version: 0,
      steps: expect.arrayContaining([expect.objectContaining({ actionPosition: "after" })]),
    }));

    fireEvent.click(screen.getByRole("button", { name: "运行场景" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "调试记录" })).toHaveClass("active"));
    expect(screen.getByText("UAT · 默认数据")).toBeInTheDocument();
    expect(api.runScenario).toHaveBeenCalled();

    fireEvent.click(screen.getByText("UAT · 默认数据").closest("summary") as HTMLElement);
    const runStepSummary = screen.getAllByText("登录接口").find((element) => element.closest("summary"))?.closest("summary") as HTMLElement;
    fireEvent.click(runStepSummary);
    expect(screen.getAllByText("执行通过").length).toBeGreaterThan(0);
    const runStep = runStepSummary.closest(".scenario-run-step") as HTMLElement;
    const requestSection = within(runStep).getByText("请求信息").closest("details") as HTMLDetailsElement;
    const responseSection = within(runStep).getByText("响应信息").closest("details") as HTMLDetailsElement;
    const assertionSection = within(runStep).getByText("断言结果").closest("details") as HTMLDetailsElement;
    expect(requestSection).not.toHaveAttribute("open");
    expect(responseSection).not.toHaveAttribute("open");
    expect(assertionSection).not.toHaveAttribute("open");
    expect(screen.getAllByText("https://uat.example.com/login").length).toBeGreaterThan(0);
    expect(screen.getAllByText("HTTP 200").length).toBeGreaterThan(0);

    fireEvent.click(within(requestSection).getByText("请求信息").closest("summary") as HTMLElement);
    expect(requestSection).toHaveAttribute("open");
    expect(within(requestSection).getByText("Request Body")).toBeInTheDocument();
    fireEvent.click(within(responseSection).getByText("响应信息").closest("summary") as HTMLElement);
    expect(responseSection).toHaveAttribute("open");
    expect(within(responseSection).getByText("Response Body")).toBeInTheDocument();
    fireEvent.click(within(assertionSection).getByText("断言结果").closest("summary") as HTMLElement);
    expect(assertionSection).toHaveAttribute("open");
    expect(within(assertionSection).getByText("HTTP 状态码")).toBeInTheDocument();
  });

  it("previews and saves an AI scenario composer draft after confirmation", async () => {
    const onAction = vi.fn();
    mockAssets({ withMetadata: true });
    render(<ScenariosPage environmentId={1} environments={environments} onAction={onAction} projectId={7} />);

    await screen.findByText("登录接口");
    fireEvent.click(screen.getByRole("button", { name: "AI 组合" }));
    const dialog = screen.getByRole("dialog", { name: "AI 智能场景组合" });
    fireEvent.change(within(dialog).getByLabelText("智能场景组合目标"), {
      target: { value: "组合登录后查询用户详情的主链路" },
    });
    fireEvent.change(within(dialog).getByLabelText("智能场景名称"), {
      target: { value: "用户详情主链路" },
    });
    expect(within(dialog).getAllByText(/passed/).length).toBeGreaterThan(0);
    expect(within(dialog).getAllByText(/提取器 1/).length).toBeGreaterThan(0);
    expect(within(dialog).getAllByText(/断言 1/).length).toBeGreaterThan(0);
    expect(within(dialog).getByLabelText("智能场景执行环境")).toHaveValue("1");
    expect(within(dialog).getByText("已选顺序")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "清空 HTTP" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "清空 WebSocket" })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "清空" }));
    expect(within(dialog).getByText("尚未选择候选测试用例。")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "全选 HTTP" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "全选 WebSocket" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "生成场景草稿" }));

    await waitFor(() => expect(api.createAiSkillRun).toHaveBeenCalledWith("scenario-composer", {
      operation: "compose",
      project_id: 7,
      environment_id: 1,
      input: expect.objectContaining({
        requirement: "组合登录后查询用户详情的主链路",
        scenario_name: "用户详情主链路",
        http_test_case_ids: [10],
        websocket_test_case_ids: [11],
        include_bindings: true,
        include_assertions: true,
        include_hooks: true,
        include_datasets: false,
        include_latest_execution: true,
        execute_candidates: false,
        max_nodes: 10,
      }),
    }));
    expect(await within(dialog).findByText("AI Skill Run")).toBeInTheDocument();
    expect(within(dialog).getByText(/正在分析候选用例/)).toBeInTheDocument();
    expect(within(dialog).getByText("AI 流式输出")).toBeInTheDocument();
    expect(within(dialog).queryByText("事件历史")).not.toBeInTheDocument();
    expect(within(dialog).getAllByText("读取候选用例").length).toBeGreaterThan(0);
    expect(within(dialog).getAllByText("load_candidate_cases").length).toBeGreaterThan(0);
    const preview = screen.getByRole("dialog", { name: "AI 生成结果预览" });
    expect(within(preview).getByText("用户详情主链路")).toBeInTheDocument();
    expect(within(preview).getByText("请确认 token 绑定")).toBeInTheDocument();
    expect(within(preview).getByText(/reference_id 10/)).toBeInTheDocument();
    expect(api.createScenario).not.toHaveBeenCalled();
    fireEvent.click(within(preview).getByRole("button", { name: "确认保存场景" }));

    await waitFor(() => expect(api.createScenario).toHaveBeenCalledWith(7, expect.objectContaining({
      id: "",
      name: "用户详情主链路",
      steps: expect.arrayContaining([expect.objectContaining({ referenceId: 10 })]),
    })));
    expect(screen.queryByRole("dialog", { name: "AI 生成结果预览" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("场景名称")).toHaveValue("用户详情主链路");
    expect(screen.getByText("测试用例节点 1")).toBeInTheDocument();
    expect(onAction).toHaveBeenCalledWith(expect.stringContaining("AI 生成场景草稿 用户详情主链路 已完成"));
    expect(onAction).toHaveBeenCalledWith(expect.stringContaining("已保存 AI 生成场景 用户详情主链路"));
  });

  it("opens a phase-specific action picker from each canvas section", async () => {
    mockAssets();
    render(<ScenariosPage environmentId={1} environments={environments} onAction={vi.fn()} projectId={8} />);

    fireEvent.click(screen.getByTitle("新建场景"));
    await addMainAction(/登录接口/);
    fireEvent.click(screen.getByRole("button", { name: "添加前置动作" }));
    const setupPicker = screen.getByRole("dialog", { name: "添加前置动作" });
    expect(within(setupPicker).getByPlaceholderText("搜索可添加的前置动作")).toBeInTheDocument();
    expect(within(setupPicker).getByText("准备数据、变量与依赖")).toBeInTheDocument();
    expect(await within(setupPicker).findByRole("button", { name: /登录接口/ })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "添加前置动作" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "添加后置动作" }));
    expect(screen.getByRole("dialog", { name: "添加后置动作" })).toBeInTheDocument();
  });

  it("supports step ordering and server-backed datasets", async () => {
    mockAssets();
    render(<ScenariosPage environmentId={1} environments={environments} onAction={vi.fn()} projectId={3} />);

    fireEvent.click(screen.getByTitle("新建场景"));
    await addMainAction(/登录接口/);
    await addMainAction(/消息订阅/);
    const websocketStep = screen.getAllByText("消息订阅").find((element) => element.closest(".scenario-step-card"))?.closest(".scenario-step-card") as HTMLElement;
    fireEvent.click(within(websocketStep).getByTitle("上移"));
    expect(document.querySelectorAll(".scenario-step-card")[0]).toHaveTextContent("消息订阅");

    fireEvent.click(screen.getByRole("button", { name: "数据驱动" }));
    fireEvent.click(screen.getByRole("button", { name: "新增数据集" }));
    expect(screen.getByText("数据集配置")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("当前数据集名称"), { target: { value: "VIP 用户" } });
    expect(screen.queryByText("附加变量 JSON")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "保存场景" }));

    await waitFor(() => expect(api.saveScenario).toHaveBeenCalledWith(3, expect.objectContaining({
      datasets: expect.arrayContaining([expect.objectContaining({ name: "VIP 用户" })]),
      steps: expect.arrayContaining([expect.objectContaining({ name: "消息订阅" })]),
    })));
  });

  it("configures condition and wait steps without editing JSON", async () => {
    mockAssets();
    render(<ScenariosPage environmentId={1} environments={environments} onAction={vi.fn()} projectId={5} />);

    fireEvent.click(screen.getByTitle("新建场景"));
    await addMainAction(/登录接口/);
    await addAttachedAction(/条件判断/);
    expect(screen.getByText("判断条件")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("条件判断变量"), { target: { value: "orderStatus" } });
    fireEvent.change(screen.getByLabelText("条件比较方式"), { target: { value: "!=" } });
    fireEvent.change(screen.getByLabelText("条件值类型"), { target: { value: "number" } });
    fireEvent.change(screen.getByLabelText("条件期望值"), { target: { value: "500" } });

    await addAttachedAction(/等待事件/);
    expect(screen.getByText("等待条件")).toBeInTheDocument();
    expect(screen.getByLabelText("等待时间单位")).toHaveValue("s");
    fireEvent.change(screen.getByLabelText("等待时长"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "保存场景" }));

    await waitFor(() => expect(api.saveScenario).toHaveBeenCalled());
    const savedScenario = api.saveScenario.mock.calls[api.saveScenario.mock.calls.length - 1]?.[1];
    const conditionStep = savedScenario.steps.find((step: any) => step.kind === "condition");
    const waitStep = savedScenario.steps.find((step: any) => step.kind === "delay");
    expect(JSON.parse(conditionStep.configText)).toEqual(expect.objectContaining({ expression: "{{orderStatus}} != 500" }));
    expect(conditionStep.path).toBe("{{orderStatus}} != 500");
    expect(JSON.parse(waitStep.configText)).toEqual(expect.objectContaining({ duration_ms: 5000 }));
    expect(waitStep.path).toBe("等待 5 秒");
  });

  it("binds random, fixed-value, and script tools to a test-case node", async () => {
    mockAssets();
    render(<ScenariosPage environmentId={1} environments={environments} onAction={vi.fn()} projectId={15} />);
    fireEvent.click(screen.getByTitle("新建场景"));
    await addMainAction(/登录接口/);

    await addAttachedAction(/生成随机值/);
    fireEvent.change(screen.getByLabelText("随机值输出变量"), { target: { value: "orderNo" } });
    fireEvent.change(screen.getByLabelText("随机值类型"), { target: { value: "uuid" } });

    await addAttachedAction(/设置固定值/, "后置");
    fireEvent.change(screen.getByLabelText("固定值输出变量"), { target: { value: "cleanupResult" } });
    fireEvent.change(screen.getByLabelText("固定值 JSON"), { target: { value: "true" } });

    await addAttachedAction(/执行脚本/);
    fireEvent.change(screen.getByLabelText("脚本语言"), { target: { value: "javascript" } });
    fireEvent.change(screen.getByLabelText("脚本输入变量"), { target: { value: "token" } });
    expect(screen.getByText(/输入变量不来自前置节点：token/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "保存场景" }));
    expect(api.saveScenario).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("脚本输入变量"), { target: { value: "orderNo" } });
    fireEvent.change(screen.getByLabelText("脚本输出变量"), { target: { value: "result" } });
    expect(await screen.findByRole("textbox", { name: "脚本代码" })).toHaveAttribute("contenteditable", "true");
    fireEvent.click(screen.getByRole("button", { name: "保存场景" }));

    await waitFor(() => expect(api.saveScenario).toHaveBeenCalled());
    const saved = api.saveScenario.mock.calls[api.saveScenario.mock.calls.length - 1]?.[1];
    expect(saved.steps.filter((step: any) => step.nodeId === saved.steps[0].nodeId)).toHaveLength(4);
    expect(saved.steps.find((step: any) => step.kind === "random")).toEqual(expect.objectContaining({ actionPosition: "before" }));
    expect(JSON.parse(saved.steps.find((step: any) => step.kind === "fixed_value").configText)).toEqual(expect.objectContaining({ output: "cleanupResult", value: true }));
    expect(JSON.parse(saved.steps.find((step: any) => step.kind === "script").configText)).toEqual(expect.objectContaining({ language: "javascript", inputs: ["orderNo"], outputs: ["result"] }));
    expect(document.querySelector(".scenario-node-connector")).not.toBeInTheDocument();
    expect(document.querySelector(".scenario-node-actions .scenario-connector")).not.toBeInTheDocument();
  });

  it("shows realtime recovery status and calibrates from run detail after an event gap", async () => {
    mockAssets();
    api.subscribeScenarioRunEvents.mockImplementationOnce(async (
      _projectId: number,
      _run: any,
      _onEvent: (event: any) => void,
      options: any,
    ) => {
      options.onReconnect?.(1, 4);
      await options.onSequenceGap?.(5, 7);
    });
    render(<ScenariosPage environmentId={1} environments={environments} onAction={vi.fn()} projectId={6} />);

    fireEvent.click(screen.getByTitle("新建场景"));
    await addMainAction(/登录接口/);
    fireEvent.click(screen.getByRole("button", { name: "运行场景" }));

    expect(await screen.findByText("运行状态已按服务端详情完成校准")).toBeInTheDocument();
    expect(api.getScenarioRun).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "关闭实时连接提示" }));
    expect(screen.queryByText("运行状态已按服务端详情完成校准")).not.toBeInTheDocument();
  });

  it("discovers deeply nested request fields and saves structured dataset overrides", async () => {
    mockAssets();
    const deepPath = "level1.level2.level3.level4.level5.level6";
    api.scenariosByProject.set(7, [{
      id: "SCENARIO-DEEP-DATA",
      projectId: 7,
      version: 1,
      name: "深层请求数据驱动",
      description: "",
      environmentId: 1,
      tags: [],
      datasets: [{
        id: "DATA-1",
        name: "默认数据",
        enabled: true,
        variablesText: "{}",
        records: [{
          id: "RECORD-1",
          name: "测试记录 1",
          enabled: true,
          requestOverrides: [],
        }],
      }],
      createdAt: "",
      updatedAt: "",
      steps: [{
        id: "STEP-DEEP",
        kind: "api_case",
        referenceId: 10,
        name: "提交深层订单",
        method: "POST",
        path: "/orders",
        continueOnFailure: false,
        configText: JSON.stringify({
          method: "POST",
          path: "/orders",
          body_type: "json",
          body: {
            level1: {
              level2: {
                level3: {
                  level4: {
                    level5: {
                      level6: "original",
                    },
                  },
                },
              },
            },
          },
        }),
      }],
    }]);

    render(<ScenariosPage environmentId={1} environments={environments} onAction={vi.fn()} projectId={7} />);
    fireEvent.click(await screen.findByRole("button", { name: /深层请求数据驱动/ }));
    await waitFor(() => expect(screen.getByLabelText("场景名称")).toHaveValue("深层请求数据驱动"));
    fireEvent.click(screen.getByRole("button", { name: "数据驱动" }));

    const fieldPath = screen.getByText(deepPath);
    fireEvent.click(fieldPath.closest("button") as HTMLButtonElement);
    fireEvent.click(screen.getByRole("button", { name: /已驱动字段/ }));
    expect(screen.getByRole("dialog", { name: "已驱动请求字段" })).toHaveTextContent(deepPath);
    fireEvent.click(screen.getByRole("button", { name: "关闭详情" }));
    fireEvent.click(screen.getByRole("button", { name: /默认数据.*1 个字段.*1 条启用/ }));
    expect(screen.getByText("数据集配置")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /请求覆盖字段/ }));
    expect(screen.getByRole("dialog", { name: "请求覆盖字段" })).toHaveTextContent("1 条记录已配置");
    fireEvent.click(screen.getByRole("button", { name: "知道了" }));
    const valueInput = screen.getByLabelText(`默认数据 测试记录 1 步骤 1 Body ${deepPath}`);
    expect(valueInput).toHaveValue("original");
    fireEvent.change(valueInput, { target: { value: '{"customer":"VIP","priority":2}' } });
    fireEvent.click(screen.getByRole("button", { name: "新增测试记录" }));
    const secondValueInput = screen.getByLabelText(`默认数据 测试记录 2 步骤 1 Body ${deepPath}`);
    expect(secondValueInput).toHaveValue('{"customer":"VIP","priority":2}');
    fireEvent.change(secondValueInput, { target: { value: '{"customer":"NORMAL","priority":1}' } });
    fireEvent.click(screen.getByRole("button", { name: "保存场景" }));

    await waitFor(() => expect(api.saveScenario).toHaveBeenCalledWith(7, expect.objectContaining({
      datasets: [expect.objectContaining({
        records: [
          expect.objectContaining({
            name: "测试记录 1",
            requestOverrides: [{
              stepId: "STEP-DEEP",
              target: "body",
              path: deepPath,
              value: { customer: "VIP", priority: 2 },
            }],
          }),
          expect.objectContaining({
            name: "测试记录 2",
            requestOverrides: [{
              stepId: "STEP-DEEP",
              target: "body",
              path: deepPath,
              value: { customer: "NORMAL", priority: 1 },
            }],
          }),
        ],
      })],
    })));
  });

  it("opens dataset records from the data-driven tab", async () => {
    mockAssets();
    api.scenariosByProject.set(7, [{
      id: "SCENARIO-NAV",
      projectId: 7,
      version: 1,
      name: "核心下单流程",
      description: "",
      environmentId: 1,
      tags: [],
      steps: [{
        id: "STEP-1",
        kind: "api_case",
        referenceId: 10,
        name: "提交订单",
        method: "POST",
        path: "/orders",
        configText: "{}",
        continueOnFailure: false,
      }],
      datasets: [{
        id: "DATA-1",
        name: "默认数据",
        enabled: true,
        variablesText: "{}",
        records: [{
          id: "RECORD-1",
          name: "正常下单",
          enabled: true,
          requestOverrides: [],
        }],
      }],
      createdAt: "",
      updatedAt: "",
    }]);

    render(<ScenariosPage environmentId={1} environments={environments} onAction={vi.fn()} projectId={7} />);
    fireEvent.click(await screen.findByRole("button", { name: /核心下单流程/ }));
    await waitFor(() => expect(screen.getByLabelText("场景名称")).toHaveValue("核心下单流程"));

    fireEvent.click(screen.getByRole("button", { name: "数据驱动" }));

    expect(screen.getByRole("button", { name: "数据驱动" })).toHaveClass("active");
    expect(screen.getByText("请求数据驱动")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /默认数据.*0 个字段.*1 条启用/ }));
    const inspector = screen.getByText("数据集配置").closest("aside") as HTMLElement;
    fireEvent.click(within(inspector).getByRole("button", { name: /^1 测试记录$/ }));
    expect(inspector.querySelector(".scenario-dataset-inspector-fields")).toHaveClass("scenario-focus-target");
  });

  it("animates the execution path from one node to the next while a scenario is running", async () => {
    mockAssets();
    const scenario = {
      id: "SCENARIO-FLOW",
      projectId: 7,
      version: 1,
      name: "FLOW ANIMATION",
      description: "",
      environmentId: 1,
      tags: [],
      datasets: [{ id: "DATA-1", name: "Default", enabled: true, variablesText: "{}" }],
      createdAt: "2026-06-12T00:00:00Z",
      updatedAt: "2026-06-12T00:00:00Z",
      steps: [1, 2, 3].map((index) => ({
        id: `STEP-${index}`,
        kind: "delay",
        name: `Step ${index}`,
        method: "WAIT",
        path: `${index * 100}ms`,
        configText: JSON.stringify({ duration_ms: index * 100 }),
        continueOnFailure: false,
      })),
    };
    api.scenariosByProject.set(7, [scenario]);
    const running = {
      id: "RUN-FLOW",
      scenarioId: scenario.id,
      scenarioName: scenario.name,
      projectId: 7,
      datasetName: "Default",
      status: "running",
      startedAt: "2026-06-12T00:00:00Z",
      durationMs: 0,
      detailLoaded: true,
      stepResults: [],
    };
    api.runsByProject.set(7, [running]);
    api.runScenario.mockResolvedValueOnce({
      executionId: "EXEC-FLOW",
      scenarioId: scenario.id,
      scenarioVersion: 1,
      status: "queued",
      createdAt: running.startedAt,
      runs: [{
        runId: running.id,
        datasetId: "DATA-1",
        datasetName: "Default",
        recordId: undefined,
        recordName: undefined,
        status: "queued",
        eventsUrl: `/api/v1/scenario-runs/${running.id}/events?project_id=7`,
        detailUrl: `/api/v1/scenario-runs/${running.id}?project_id=7`,
      }],
    });
    let emitEvent: (event: any) => void = () => {};
    let finishEvents = () => {};
    api.subscribeScenarioRunEvents.mockImplementationOnce(async (_projectId: number, _run: any, onEvent: (event: any) => void) => {
      emitEvent = onEvent;
      await new Promise<void>((resolve) => {
        finishEvents = resolve;
      });
    });

    render(<ScenariosPage environmentId={1} environments={environments} onAction={vi.fn()} projectId={7} />);
    fireEvent.click(await screen.findByRole("button", { name: /FLOW ANIMATION/ }));
    await waitFor(() => expect(document.querySelectorAll(".scenario-step-card")).toHaveLength(3));
    fireEvent.click(document.querySelector(".scenario-actions .btn.primary") as HTMLButtonElement);

    await waitFor(() => expect(api.subscribeScenarioRunEvents).toHaveBeenCalled());
    act(() => emitEvent({ event: "step_started", stepIndex: 0, stepId: "STEP-1", status: "running", sequence: 1 }));
    await waitFor(() => {
      expect(document.querySelector(".scenario-step-card.flow-running")).toHaveTextContent("Step 1");
      expect(document.querySelector(".scenario-actions .btn.primary")).toHaveClass("loading");
    });

    act(() => {
      emitEvent({ event: "step_completed", stepIndex: 0, stepId: "STEP-1", status: "passed", sequence: 2 });
      emitEvent({ event: "transition_started", sourceStepIndex: 0, targetStepIndex: 1, sequence: 3 });
    });
    await waitFor(() => {
      const activeConnector = document.querySelector(".scenario-connector.flow-active");
      expect(activeConnector).toBeInTheDocument();
      expect(activeConnector?.querySelector(".scenario-connector-track")).toBeInTheDocument();
      expect(activeConnector?.querySelectorAll(".scenario-flow-pulse")).toHaveLength(2);
      expect(activeConnector?.querySelector(".scenario-connector-port.target")).toBeInTheDocument();
    });
    act(() => emitEvent({ event: "step_started", stepIndex: 1, stepId: "STEP-2", status: "running", sequence: 4 }));
    await waitFor(() => {
      expect(document.querySelector(".scenario-step-card.flow-running")).toHaveTextContent("Step 2");
      expect(document.querySelector(".scenario-connector.flow-active")).toBeInTheDocument();
    });

    api.runsByProject.set(7, [{ ...running, status: "passed", finishedAt: "2026-06-12T00:00:01Z", durationMs: 1000 }]);
    await act(async () => finishEvents());
    await waitFor(() => expect(document.querySelector(".scenario-actions .btn.primary")).not.toHaveClass("loading"));
  });

  it("switches the canvas between dataset record runs with isolated realtime progress", async () => {
    mockAssets();
    const scenario = {
      id: "SCENARIO-MULTI-RUN",
      projectId: 7,
      version: 1,
      name: "MULTI RUN",
      description: "",
      environmentId: 1,
      tags: [],
      datasets: [{
        id: "DATA-A",
        name: "数据集 A",
        enabled: true,
        variablesText: "{}",
        records: [{ id: "RECORD-A", name: "正常记录", enabled: true, requestOverrides: [] }],
      }, {
        id: "DATA-B",
        name: "数据集 B",
        enabled: true,
        variablesText: "{}",
        records: [{ id: "RECORD-B", name: "异常记录", enabled: true, requestOverrides: [] }],
      }],
      createdAt: "2026-06-15T00:00:00Z",
      updatedAt: "2026-06-15T00:00:00Z",
      steps: [1, 2].map((index) => ({
        id: `STEP-${index}`,
        kind: "delay",
        name: `Step ${index}`,
        method: "WAIT",
        path: `${index * 100}ms`,
        configText: JSON.stringify({ duration_ms: index * 100 }),
        continueOnFailure: false,
      })),
    };
    api.scenariosByProject.set(7, [scenario]);
    const launchRuns = [{
      runId: "RUN-A",
      datasetId: "DATA-A",
      datasetName: "数据集 A",
      recordId: "RECORD-A",
      recordName: "正常记录",
      status: "queued",
      eventsUrl: "/api/v1/scenario-runs/RUN-A/events?project_id=7",
      detailUrl: "/api/v1/scenario-runs/RUN-A?project_id=7",
    }, {
      runId: "RUN-B",
      datasetId: "DATA-B",
      datasetName: "数据集 B",
      recordId: "RECORD-B",
      recordName: "异常记录",
      status: "queued",
      eventsUrl: "/api/v1/scenario-runs/RUN-B/events?project_id=7",
      detailUrl: "/api/v1/scenario-runs/RUN-B?project_id=7",
    }];
    api.runScenario.mockResolvedValueOnce({
      executionId: "EXEC-MULTI",
      scenarioId: scenario.id,
      scenarioVersion: scenario.version,
      status: "queued",
      createdAt: "2026-06-15T00:00:01Z",
      runs: launchRuns,
    });
    const emitters = new Map<string, (event: any) => void>();
    const finishers = new Map<string, () => void>();
    const subscribe = async (_projectId: number, run: any, onEvent: (event: any) => void) => {
      emitters.set(run.runId, onEvent);
      await new Promise<void>((resolve) => finishers.set(run.runId, resolve));
    };
    api.subscribeScenarioRunEvents
      .mockImplementationOnce(subscribe)
      .mockImplementationOnce(subscribe);

    const onAction = vi.fn();
    render(<ScenariosPage environmentId={1} environments={environments} onAction={onAction} projectId={7} />);
    fireEvent.click(await screen.findByRole("button", { name: /MULTI RUN/ }));
    await waitFor(() => expect(document.querySelectorAll(".scenario-step-card")).toHaveLength(2));
    fireEvent.click(screen.getByRole("button", { name: "运行场景" }));

    await waitFor(() => expect(api.runScenario).toHaveBeenCalled());
    expect(onAction).not.toHaveBeenCalled();
    expect(await screen.findByLabelText("当前画布运行")).toBeInTheDocument();
    await waitFor(() => expect(api.subscribeScenarioRunEvents).toHaveBeenCalledTimes(2));
    act(() => {
      emitters.get("RUN-A")?.({ event: "step_started", runId: "RUN-A", stepIndex: 0, status: "running", sequence: 1 });
      emitters.get("RUN-B")?.({ event: "step_started", runId: "RUN-B", stepIndex: 1, status: "running", sequence: 1 });
    });

    await waitFor(() => expect(document.querySelector(".scenario-step-card.flow-running")).toHaveTextContent("Step 1"));
    expect(screen.getByRole("tab", { name: "查看运行 数据集 A · 正常记录" })).toHaveAttribute("aria-selected", "true");

    fireEvent.click(screen.getByRole("tab", { name: "查看运行 数据集 B · 异常记录" }));
    await waitFor(() => expect(document.querySelector(".scenario-step-card.flow-running")).toHaveTextContent("Step 2"));
    expect(screen.getByText("数据集 B · 异常记录")).toBeInTheDocument();

    const completedRuns = launchRuns.map((run) => ({
      id: run.runId,
      scenarioId: scenario.id,
      scenarioName: scenario.name,
      projectId: 7,
      environmentId: 1,
      environmentName: "UAT",
      datasetId: run.datasetId,
      datasetName: run.datasetName,
      recordId: run.recordId,
      recordName: run.recordName,
      status: "passed",
      startedAt: "2026-06-15T00:00:01Z",
      finishedAt: "2026-06-15T00:00:02Z",
      durationMs: 1000,
      detailLoaded: true,
      stepResults: [],
    }));
    api.runsByProject.set(7, completedRuns);
    await act(async () => {
      finishers.get("RUN-A")?.();
      finishers.get("RUN-B")?.();
    });
    await waitFor(() => expect(screen.getByRole("button", { name: "调试记录" })).toHaveClass("active"));
    expect(screen.getByText("UAT · 数据集 B · 异常记录")).toBeInTheDocument();
    expect(screen.getByText(/记录 RECORD-B/)).toBeInTheDocument();
  });

  it("does not display a single test record as a second dataset", async () => {
    mockAssets();
    const scenario = {
      id: "SCENARIO-SINGLE-RECORD",
      projectId: 7,
      version: 1,
      name: "单记录场景",
      description: "",
      environmentId: 1,
      tags: [],
      datasets: [{
        id: "DATA-1",
        name: "数据集1",
        enabled: true,
        variablesText: "{}",
        records: [{ id: "RECORD-1", name: "数据集2", enabled: true, requestOverrides: [] }],
      }],
      createdAt: "2026-06-15T00:00:00Z",
      updatedAt: "2026-06-15T00:00:00Z",
      steps: [{
        id: "STEP-1",
        kind: "delay",
        name: "Step 1",
        method: "WAIT",
        path: "100ms",
        configText: JSON.stringify({ duration_ms: 100 }),
        continueOnFailure: false,
      }],
    };
    api.scenariosByProject.set(7, [scenario]);
    api.runScenario.mockResolvedValueOnce({
      executionId: "EXEC-SINGLE",
      scenarioId: scenario.id,
      scenarioVersion: scenario.version,
      status: "queued",
      createdAt: "2026-06-15T00:00:01Z",
      runs: [{
        runId: "RUN-SINGLE",
        datasetId: "DATA-1",
        datasetName: "数据集1",
        recordId: "RECORD-1",
        recordName: "数据集2",
        status: "queued",
        eventsUrl: "/api/v1/scenario-runs/RUN-SINGLE/events?project_id=7",
        detailUrl: "/api/v1/scenario-runs/RUN-SINGLE?project_id=7",
      }],
    });
    let finishEvents = () => {};
    api.subscribeScenarioRunEvents.mockImplementationOnce(async (_projectId: number, _run: any, onEvent: (event: any) => void) => {
      await new Promise<void>((resolve) => {
        finishEvents = () => {
          onEvent({ event: "run_completed", runId: "RUN-SINGLE", status: "passed", sequence: 1 });
          resolve();
        };
      });
    });
    api.runsByProject.set(7, [{
      id: "RUN-SINGLE",
      scenarioId: scenario.id,
      scenarioName: scenario.name,
      projectId: 7,
      environmentId: 1,
      environmentName: "UAT",
      datasetId: "DATA-1",
      datasetName: "数据集1",
      recordId: "RECORD-1",
      recordName: "数据集2",
      status: "passed",
      startedAt: "2026-06-15T00:00:01Z",
      finishedAt: "2026-06-15T00:00:02Z",
      durationMs: 1000,
      detailLoaded: true,
      stepResults: [],
    }]);

    render(<ScenariosPage environmentId={1} environments={environments} onAction={vi.fn()} projectId={7} />);
    fireEvent.click(await screen.findByRole("button", { name: /单记录场景/ }));
    await waitFor(() => expect(document.querySelectorAll(".scenario-step-card")).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "运行场景" }));

    const switcher = await screen.findByLabelText("当前画布运行");
    expect(within(switcher).getByRole("tab", { name: "查看运行 数据集1" })).toBeInTheDocument();
    expect(within(switcher).getByText("单条测试记录")).toBeInTheDocument();
    expect(within(switcher).queryByText("数据集1 · 数据集2")).not.toBeInTheDocument();

    await act(async () => finishEvents());
    await waitFor(() => expect(screen.getByRole("button", { name: "调试记录" })).toHaveClass("active"));
    expect(screen.getByText("UAT · 数据集1")).toBeInTheDocument();
    expect(screen.queryByText("UAT · 数据集1 · 数据集2")).not.toBeInTheDocument();
  });

  it("executes one step and turns a response field into a variable", async () => {
    const fetchMock = mockAssets();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        code: 0,
        data: {
          status: "passed",
          duration_ms: 36,
          response_snapshot: {
            status_code: 200,
            json: { data: { company_id: 9527, company_name: "测试企业" } },
          },
        },
      }),
    } as Response);
    render(<ScenariosPage environmentId={1} environments={environments} onAction={vi.fn()} projectId={7} />);

    fireEvent.click(screen.getByTitle("新建场景"));
    await addMainAction(/登录接口/);
    expandRequestConfig();
    fireEvent.change(screen.getByLabelText("请求头 1 值"), { target: { value: "Bearer debug-token" } });
    const assertionToggle = screen.getByRole("button", { name: /断言/ });
    expect(assertionToggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("尚未配置断言")).not.toBeInTheDocument();
    fireEvent.click(assertionToggle);
    expect(assertionToggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("尚未配置断言")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "新增断言" }));
    fireEvent.change(screen.getByLabelText("断言 1 类型"), { target: { value: "json_equals" } });
    fireEvent.change(screen.getByLabelText("断言 1 JSON 路径"), { target: { value: "code" } });
    fireEvent.change(screen.getByLabelText("断言 1 预期值"), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "执行步骤" }));
    expect(screen.getByRole("button", { name: "执行步骤" })).toHaveClass("loading");

    const responseExpand = await screen.findByRole("button", { name: "展开响应信息" });
    expect(screen.queryByRole("dialog", { name: "登录接口 调试响应" })).not.toBeInTheDocument();
    const responseCard = responseExpand.closest(".scenario-debug-response-card") as HTMLElement;
    expect(responseCard).toHaveTextContent("响应信息");
    expect(responseCard).toHaveTextContent("36 ms");
    expect(responseCard).toHaveTextContent("200");
    expect(responseCard).toHaveTextContent("响应预览");
    expect(responseCard).toHaveTextContent("data.company_id");
    expect(responseCard).toHaveTextContent("9527");
    fireEvent.click(responseExpand);
    const responseDialog = screen.getByRole("dialog", { name: "登录接口 调试响应" });
    const executeCall = fetchMock.mock.calls.find(([url]) => String(url).includes("/test-cases/execute-unsaved"));
    expect(executeCall).toBeDefined();
    expect(JSON.parse(String((executeCall?.[1] as RequestInit).body))).toEqual(expect.objectContaining({
      environment_id: 1,
      headers: { Authorization: "Bearer debug-token" },
      query_params: { tenant_id: "1" },
      body: { company_id: "", order: { user_id: "" } },
      assertions: [{ type: "json_equals", path: "code", expected: 0 }],
    }));
    expect(within(responseDialog).queryByText("company_id")).not.toBeInTheDocument();
    expect(within(responseDialog).getByRole("button", { name: "展开 data" })).toHaveAttribute("aria-expanded", "false");
    fireEvent.change(within(responseDialog).getByLabelText("搜索响应字段"), { target: { value: "company_id" } });
    expect(within(responseDialog).getByText("找到 1 个匹配字段")).toBeInTheDocument();
    expect(within(responseDialog).getByText("company_id")).toBeInTheDocument();
    expect(within(responseDialog).queryByText("company_name")).not.toBeInTheDocument();
    fireEvent.click(within(responseDialog).getByTitle("清空响应搜索"));
    expect(within(responseDialog).queryByText("company_id")).not.toBeInTheDocument();
    fireEvent.click(within(responseDialog).getByRole("button", { name: "展开 data" }));
    expect(within(responseDialog).getByText("9527")).toBeInTheDocument();
    expect(within(responseDialog).getByText("company_name")).toBeInTheDocument();
    fireEvent.click(within(responseDialog).getByRole("button", { name: "将 data.company_id 设为断言" }));
    fireEvent.click(within(responseDialog).getByRole("button", { name: "将 data.company_id 设为变量" }));
    expect(within(responseDialog).queryByTitle("全部收起响应节点")).not.toBeInTheDocument();
    expect(within(responseDialog).getByRole("button", { name: "收起 data" })).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(within(responseDialog).getByTitle("关闭响应详情"));

    expect(screen.getByLabelText("断言 2 类型")).toHaveValue("json_equals");
    expect(screen.getByLabelText("断言 2 JSON 路径")).toHaveValue("data.company_id");
    expect(screen.getByLabelText("断言 2 预期值")).toHaveValue("9527");
    expect(screen.getByLabelText("取值变量名")).toHaveValue("company_id");
    expect(screen.getByLabelText("响应 JSON 路径")).toHaveValue("data.company_id");
    expect(screen.getByText("本次调试取值").closest("small")).toHaveTextContent("9527");
    fireEvent.change(screen.getByLabelText("响应 JSON 路径"), { target: { value: "data.company_name" } });
    expect(screen.getByText("本次调试取值").closest("small")).toHaveTextContent("测试企业");
    expect(screen.getByText("1 取值 · 0 引用")).toBeInTheDocument();
  });

  it("debugs a script action with manual input values", async () => {
    const fetchMock = mockAssets();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        code: 0,
        data: {
          status: "passed",
          duration_ms: 22,
          outputs: {
            result: { success: true, companyId: 9527 },
          },
        },
      }),
    } as Response);
    render(<ScenariosPage environmentId={1} environments={environments} onAction={vi.fn()} projectId={7} />);

    fireEvent.click(screen.getByTitle("新建场景"));
    await addMainAction(/登录接口/);
    await addAttachedAction(/设置固定值/);
    fireEvent.change(screen.getByLabelText("固定值输出变量"), { target: { value: "companyId" } });
    await addAttachedAction(/执行脚本/);
    expect(screen.queryByRole("button", { name: /请求配置/ })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("脚本输入变量"), { target: { value: "companyId" } });
    expect(screen.getByLabelText("脚本调试输入 JSON")).toHaveValue(JSON.stringify({ companyId: null }, null, 2));
    fireEvent.change(screen.getByLabelText("脚本调试输入 JSON"), { target: { value: '{"companyId":9527}' } });

    fireEvent.click(screen.getByRole("button", { name: "执行步骤" }));

    const responseExpand = await screen.findByRole("button", { name: "展开调试结果" });
    const executeCall = fetchMock.mock.calls.find(([url]) => String(url).includes("/scenarios/actions/script/execute-unsaved"));
    expect(executeCall).toBeDefined();
    expect(JSON.parse(String((executeCall?.[1] as RequestInit).body))).toEqual({
      code: "result = None",
      environment_id: 1,
      input_values: { companyId: 9527 },
      inputs: ["companyId"],
      language: "python",
      outputs: ["result"],
      timeout_ms: 10000,
    });
    expect(responseExpand.closest(".scenario-debug-response-card")).toHaveTextContent("22 ms");
    expect(responseExpand.closest(".scenario-debug-response-card")).toHaveTextContent("调试结果");
    expect(responseExpand.closest(".scenario-debug-response-card")).toHaveTextContent("1 个");
    expect(responseExpand.closest(".scenario-debug-response-card")).toHaveTextContent("输出变量");
    expect(responseExpand.closest(".scenario-debug-response-card")).toHaveTextContent("result.success");
    expect(responseExpand.closest(".scenario-debug-response-card")).toHaveTextContent("true");
    fireEvent.click(responseExpand);
    const responseDialog = screen.getByRole("dialog", { name: "执行脚本 调试结果" });
    fireEvent.click(within(responseDialog).getByRole("button", { name: "展开 result" }));
    expect(within(responseDialog).getByText("companyId")).toBeInTheDocument();
    expect(within(responseDialog).getByText("9527")).toBeInTheDocument();
    expect(within(responseDialog).queryByRole("button", { name: /设为变量/ })).not.toBeInTheDocument();
    expect(within(responseDialog).queryByRole("button", { name: /设为断言/ })).not.toBeInTheDocument();
  });

  it("shows a script debug result card when the debug request fails", async () => {
    const fetchMock = mockAssets();
    fetchMock.mockRejectedValueOnce(new Error("脚本沙箱执行失败"));
    const onAction = vi.fn();
    render(<ScenariosPage environmentId={1} environments={environments} onAction={onAction} projectId={7} />);

    fireEvent.click(screen.getByTitle("新建场景"));
    await addMainAction(/登录接口/);
    await addAttachedAction(/执行脚本/);
    fireEvent.click(screen.getByRole("button", { name: "执行步骤" }));

    const responseExpand = await screen.findByRole("button", { name: "展开调试结果" });
    const responseCard = responseExpand.closest(".scenario-debug-response-card") as HTMLElement;
    expect(responseCard).toHaveClass("error");
    expect(responseCard).toHaveTextContent("调试结果");
    expect(responseCard).toHaveTextContent("脚本沙箱执行失败");
    expect(onAction).toHaveBeenCalledWith("脚本沙箱执行失败");
  });

  it("marks the canvas step as failed after a failed single-step execution", async () => {
    const fetchMock = mockAssets();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        code: 0,
        data: {
          status: "failed",
          duration_ms: 559,
          error_message: "请求未授权",
          response_snapshot: {
            status_code: 200,
            json: { msg: "请求未授权", code: 90001, data: null },
          },
        },
      }),
    } as Response);
    render(<ScenariosPage environmentId={1} environments={environments} onAction={vi.fn()} projectId={7} />);

    fireEvent.click(screen.getByTitle("新建场景"));
    await addMainAction(/登录接口/);
    const stepCard = document.querySelector(".scenario-step-card") as HTMLElement;
    fireEvent.click(within(stepCard).getByTitle("单独执行步骤"));

    await waitFor(() => expect(stepCard).toHaveClass("debug-failed"));
    expect(stepCard).toHaveTextContent("单步失败 · 559ms");
    const responseCard = screen.getByRole("button", { name: "展开响应信息" }).closest(".scenario-debug-response-card") as HTMLElement;
    expect(responseCard).toHaveClass("failed");
    expect(responseCard).toHaveTextContent("请求未授权");
    expect(screen.queryByRole("dialog", { name: "登录接口 调试响应" })).not.toBeInTheDocument();
  });

  it("edits request headers, query, and body for a scenario step", async () => {
    mockAssets();
    render(<ScenariosPage environmentId={1} environments={environments} onAction={vi.fn()} projectId={7} />);

    fireEvent.click(screen.getByTitle("新建场景"));
    await addMainAction(/登录接口/);
    expandRequestConfig();
    fireEvent.change(screen.getByLabelText("请求头 1 值"), { target: { value: "Bearer scenario-token" } });
    fireEvent.click(screen.getByRole("button", { name: /Query/ }));
    fireEvent.change(screen.getByLabelText("Query 参数 1 值"), { target: { value: "tenant-9" } });
    fireEvent.click(screen.getByRole("button", { name: "Body" }));
    fireEvent.change(screen.getByLabelText("请求体 JSON"), {
      target: { value: '{"company_id":"{{companyId}}","enabled":true}' },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存场景" }));

    await waitFor(() => expect(api.saveScenario).toHaveBeenCalledWith(7, expect.objectContaining({
      steps: expect.arrayContaining([
        expect.objectContaining({
          configText: expect.stringMatching(/Bearer scenario-token[\s\S]*tenant-9[\s\S]*companyId/),
        }),
      ]),
    })));
  });

  it("binds an upstream variable directly inside a request field", async () => {
    mockAssets();
    render(<ScenariosPage environmentId={1} environments={environments} onAction={vi.fn()} projectId={7} />);

    fireEvent.click(screen.getByTitle("新建场景"));
    await addMainAction(/登录接口/);
    const extractionSection = screen.getByText("响应取值").closest("section") as HTMLElement;
    fireEvent.click(within(extractionSection).getByRole("button", { name: "新增" }));
    fireEvent.change(screen.getByLabelText("取值变量名"), { target: { value: "companyId" } });
    fireEvent.change(screen.getByLabelText("响应 JSON 路径"), { target: { value: "data.company_id" } });

    await addMainAction(/登录接口/);
    expandRequestConfig();
    fireEvent.click(screen.getByRole("button", { name: "Body" }));
    const bodyVariableSelect = screen.getByLabelText("请求体 company_id 引用上游变量") as HTMLSelectElement;
    fireEvent.change(bodyVariableSelect, { target: { value: bodyVariableSelect.options[1].value } });

    expect(bodyVariableSelect.value).toContain("::");
    expect(screen.queryByLabelText("引用 1 写入位置")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("引用 1 写入字段")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "保存场景" }));
    await waitFor(() => expect(api.saveScenario).toHaveBeenCalledWith(7, expect.objectContaining({
      steps: expect.arrayContaining([
        expect.objectContaining({ configText: expect.stringContaining('"target_path": "company_id"') }),
      ]),
    })));
  });

  it("shows variable relationships and runtime values across the canvas and inspector", async () => {
    const fetchMock = mockAssets();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        code: 0,
        data: {
          status: "passed",
          duration_ms: 42,
          response_snapshot: {
            status_code: 200,
            json: { data: { id: 2048 } },
          },
        },
      }),
    } as Response);
    const scenario = {
      id: "SCENARIO-TRACE",
      projectId: 7,
      version: 1,
      name: "变量链路场景",
      description: "",
      environmentId: 1,
      tags: [],
      datasets: [{ id: "DATA-1", name: "默认数据", enabled: true, variablesText: "{}" }],
      createdAt: "2026-06-11T10:00:00Z",
      updatedAt: "2026-06-11T10:00:00Z",
      steps: [{
        id: "STEP-1",
        kind: "api_case",
        referenceId: 10,
        name: "获取企业",
        method: "POST",
        path: "/companies",
        continueOnFailure: false,
        configText: JSON.stringify({
          _scenario_context: {
            extractions: [{ id: "VAR-1", name: "companyId", path: "data.id" }],
            bindings: [],
          },
        }),
      }, {
        id: "STEP-2",
        kind: "api_case",
        referenceId: 10,
        name: "获取企业详情",
        method: "GET",
        path: "/company/detail",
        continueOnFailure: false,
        configText: JSON.stringify({
          query_params: { companyId: "{{companyId}}" },
          _scenario_context: {
            extractions: [],
            bindings: [{
              id: "BIND-1",
              sourceStepId: "STEP-1",
              sourceExtractionId: "VAR-1",
              target: "query_params",
              targetPath: "companyId",
            }],
          },
        }),
      }],
    };
    api.scenariosByProject.set(7, [scenario]);
    api.runsByProject.set(7, [{
      id: "RUN-TRACE",
      scenarioId: scenario.id,
      scenarioName: scenario.name,
      projectId: 7,
      environmentId: 1,
      environmentName: "UAT",
      datasetName: "默认数据",
      status: "passed",
      startedAt: "2026-06-11T10:10:00Z",
      durationMs: 180,
      stepResults: [{
        stepId: "STEP-1",
        name: "获取企业",
        status: "passed",
        durationMs: 80,
        message: "执行通过",
        resolvedBindings: [],
        extractedVariables: [{
          extractionId: "VAR-1",
          name: "companyId",
          path: "data.id",
          value: 9527,
          masked: false,
        }],
      }, {
        stepId: "STEP-2",
        name: "获取企业详情",
        status: "passed",
        durationMs: 100,
        message: "执行通过",
        extractedVariables: [],
        resolvedBindings: [{
          bindingId: "BIND-1",
          sourceStepId: "STEP-1",
          sourceExtractionId: "VAR-1",
          target: "query_params",
          targetPath: "companyId",
          value: 9527,
          masked: false,
        }],
      }],
    }]);

    render(<ScenariosPage environmentId={1} environments={environments} onAction={vi.fn()} projectId={7} />);
    fireEvent.click(await screen.findByRole("button", { name: /变量链路场景/ }));

    const connector = await waitFor(() => {
      const element = document.querySelector(".scenario-connector-bindings");
      expect(element).toBeInTheDocument();
      return element as HTMLElement;
    });
    expect(connector).toHaveTextContent("1 条跨节点引用");
    expect(connector).toHaveTextContent("进入测试用例节点 2");
    expect(connector).toHaveTextContent("步骤 1");

    const cards = document.querySelectorAll(".scenario-step-card");
    expect(cards[0]).toHaveTextContent("下游引用");
    expect(cards[0]).toHaveTextContent("1 个变量 · 1 处");
    expect(within(cards[0] as HTMLElement).getByRole("button", { name: "展开下游引用" })).toHaveAttribute("aria-expanded", "false");
    expect(cards[0]).not.toHaveTextContent("响应：data.id");
    fireEvent.click(within(cards[0] as HTMLElement).getByRole("button", { name: "展开下游引用" }));
    expect(cards[0]).toHaveTextContent("响应：data.id");
    expect(cards[0]).toHaveTextContent("步骤 2");
    expect(cards[0]).toHaveTextContent("Query.companyId");
    expect(cards[0]).toHaveTextContent("9527");
    expect(cards[1]).toHaveTextContent("上游输入");
    expect(within(cards[1] as HTMLElement).getByRole("button", { name: "展开上游输入" })).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(within(cards[1] as HTMLElement).getByRole("button", { name: "展开上游输入" }));
    expect(cards[1]).toHaveTextContent("获取企业");
    expect(cards[1]).toHaveTextContent("当前步骤写入位置");
    expect(cards[1]).toHaveTextContent("9527");

    fireEvent.click(within(cards[0] as HTMLElement).getByRole("button", { name: "收起下游引用" }));
    expect(within(cards[0] as HTMLElement).getByRole("button", { name: "展开下游引用" })).toHaveAttribute("aria-expanded", "false");
    expect(cards[0]).not.toHaveTextContent("Query.companyId");
    fireEvent.click(within(cards[0] as HTMLElement).getByRole("button", { name: "展开下游引用" }));
    expect(cards[0]).toHaveTextContent("Query.companyId");

    fireEvent.click(within(cards[0] as HTMLElement).getByTitle("单独执行步骤"));
    await waitFor(() => expect(cards[0]).toHaveTextContent("2048"));
    expect(cards[0]).not.toHaveTextContent("9527");
    expect(cards[1]).toHaveTextContent("9527");
    expect(cards[0].querySelectorAll(".scenario-reference-value.debug")).toHaveLength(1);
    expect(within(document.querySelector(".scenario-inspector") as HTMLElement).getByText(/本次调试取值/)).toHaveTextContent("2048");

    fireEvent.click(cards[1]);
    expandRequestConfig();
    fireEvent.click(screen.getByRole("button", { name: /Query/ }));
    const inspector = document.querySelector(".scenario-inspector") as HTMLElement;
    expect(within(inspector).getByText(/本次值/)).toHaveTextContent("9527");
  });

  it("collapses large reference groups by default and expands them on demand", async () => {
    mockAssets();
    const sourceStep = {
      id: "STEP-1",
      kind: "api_case",
      referenceId: 10,
      name: "获取企业",
      method: "GET",
      path: "/companies",
      continueOnFailure: false,
      configText: JSON.stringify({
        _scenario_context: {
          extractions: [{ id: "VAR-1", name: "companyId", path: "data.id" }],
          bindings: [],
        },
      }),
    };
    const targetSteps = [2, 3, 4, 5].map((stepNumber) => ({
      id: `STEP-${stepNumber}`,
      kind: "api_case",
      referenceId: 10,
      name: `下游步骤 ${stepNumber}`,
      method: "POST",
      path: `/companies/${stepNumber}`,
      continueOnFailure: false,
      configText: JSON.stringify({
        body: { companyId: "{{companyId}}" },
        _scenario_context: {
          extractions: [],
          bindings: [{
            id: `BIND-${stepNumber}`,
            sourceStepId: "STEP-1",
            sourceExtractionId: "VAR-1",
            target: "body",
            targetPath: "companyId",
          }],
        },
      }),
    }));
    api.scenariosByProject.set(7, [{
      id: "SCENARIO-MANY-REFERENCES",
      projectId: 7,
      version: 1,
      name: "多引用场景",
      description: "",
      environmentId: 1,
      tags: [],
      datasets: [{ id: "DATA-1", name: "默认数据", enabled: true, variablesText: "{}" }],
      createdAt: "",
      updatedAt: "",
      steps: [sourceStep, ...targetSteps],
    }]);

    render(<ScenariosPage environmentId={1} environments={environments} onAction={vi.fn()} projectId={7} />);
    fireEvent.click(await screen.findByRole("button", { name: /多引用场景/ }));
    await waitFor(() => expect(document.querySelectorAll(".scenario-step-card")).toHaveLength(5));
    const sourceCard = document.querySelector(".scenario-step-card") as HTMLElement;
    const expandButton = within(sourceCard).getByRole("button", { name: "展开下游引用" });

    expect(expandButton).toHaveAttribute("aria-expanded", "false");
    expect(sourceCard).toHaveTextContent("1 个变量 · 4 处");
    expect(sourceCard).not.toHaveTextContent("下游步骤 5");

    fireEvent.click(expandButton);
    expect(within(sourceCard).getByRole("button", { name: "收起下游引用" })).toHaveAttribute("aria-expanded", "true");
    expect(sourceCard).toHaveTextContent("下游步骤 5");
    expect(sourceCard).toHaveClass("active");
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
    render(<ScenariosPage environmentId={1} environments={environments} onAction={vi.fn()} projectId={9} />);

    fireEvent.click(screen.getByTitle("新建场景"));
    await addMainAction(/登录接口/);
    fireEvent.click(screen.getByRole("button", { name: "保存场景" }));
    await screen.findByText(/1 步骤 · 1 数据集 · v1/);
    fireEvent.click(screen.getByRole("button", { name: "复制" }));

    expect(await screen.findByText("未命名测试场景 - 副本")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    expect(screen.getByRole("alertdialog", { name: "删除场景？" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));

    await waitFor(() => expect(screen.queryByText("未命名测试场景 - 副本")).not.toBeInTheDocument());
    expect(api.deleteScenario).toHaveBeenCalled();
  });

  it("uses the scenario environment name for debug runs when run payload omits it", async () => {
    const scenario = {
      id: "SCENARIO-RUN-ENV-NAME",
      projectId: 7,
      version: 1,
      name: "场景环境回退",
      description: "",
      environmentId: 4,
      environmentName: "test",
      tags: [],
      steps: [],
      datasets: [{ id: "DATA-1", name: "无数据输入", enabled: true, variablesText: "{}", records: [] }],
      createdAt: "",
      updatedAt: "",
    };
    api.scenariosByProject.set(7, [scenario]);
    api.runsByProject.set(7, [{
      id: "RUN-WITHOUT-ENV-NAME",
      scenarioId: scenario.id,
      scenarioName: scenario.name,
      projectId: 7,
      environmentId: 4,
      datasetName: "无数据输入",
      status: "passed",
      startedAt: "2026-06-23T00:00:38Z",
      durationMs: 15100,
      detailLoaded: true,
      stepResults: [],
    }]);
    mockAssets();

    render(<ScenariosPage environmentId={4} environments={environments} onAction={vi.fn()} projectId={7} />);
    fireEvent.click(await screen.findByRole("button", { name: /场景环境回退/ }));
    await waitFor(() => expect(screen.getByLabelText("场景名称")).toHaveValue("场景环境回退"));
    fireEvent.click(screen.getByRole("button", { name: "调试记录" }));

    expect(screen.getByText("test · 无数据输入")).toBeInTheDocument();
    expect(screen.queryByText(/未命名环境/)).not.toBeInTheDocument();
  });

  it("deletes a scenario debug run after confirmation", async () => {
    const scenario = {
      id: "SCENARIO-DELETE-RUN",
      projectId: 7,
      version: 1,
      name: "删除调试记录场景",
      description: "",
      environmentId: 1,
      tags: [],
      steps: [],
      datasets: [{ id: "DATA-1", name: "异常数据", enabled: true, variablesText: "{}" }],
      createdAt: "",
      updatedAt: "",
    };
    api.scenariosByProject.set(7, [scenario]);
    api.runsByProject.set(7, [{
      id: "RUN-DELETE",
      scenarioId: scenario.id,
      scenarioName: scenario.name,
      projectId: 7,
      environmentName: "UAT",
      datasetName: "异常数据",
      status: "failed",
      startedAt: "2026-06-12T07:43:35Z",
      durationMs: 2300,
      detailLoaded: true,
      stepResults: [{
        stepId: "STEP-FAILED",
        name: "失败步骤",
        kind: "api_case",
        status: "failed",
        durationMs: 800,
        message: "Execution failed",
        errorMessage: "Execution failed",
      }, {
        stepId: "STEP-PASSED",
        name: "通过步骤",
        kind: "api_case",
        status: "passed",
        durationMs: 700,
        message: "Execution passed",
        errorMessage: "",
      }, {
        stepId: "STEP-SKIPPED",
        name: "跳过步骤",
        kind: "api_case",
        status: "skipped",
        durationMs: 0,
        message: "Execution skipped",
        errorMessage: "",
      }],
    }]);
    mockAssets();

    render(<ScenariosPage environmentId={1} environments={environments} onAction={vi.fn()} projectId={7} />);
    fireEvent.click(await screen.findByRole("button", { name: /删除调试记录场景/ }));
    await waitFor(() => expect(screen.getByLabelText("场景名称")).toHaveValue("删除调试记录场景"));
    fireEvent.click(screen.getByRole("button", { name: "调试记录" }));
    expect(document.querySelector(".scenario-run-card.failed")).toBeInTheDocument();
    expect(document.querySelector(".scenario-run-step.failed")).toBeInTheDocument();
    expect(document.querySelector(".scenario-run-step.passed")).toBeInTheDocument();
    expect(document.querySelector(".scenario-run-step.skipped")).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "删除调试记录 异常数据" }));
    const dialog = screen.getByRole("alertdialog", { name: "删除调试记录？" });
    expect(dialog).toHaveTextContent("删除后无法恢复");
    fireEvent.click(within(dialog).getByRole("button", { name: "确认删除" }));

    await waitFor(() => expect(api.deleteScenarioRun).toHaveBeenCalledWith(7, "RUN-DELETE"));
    expect(screen.queryByText("UAT · 异常数据")).not.toBeInTheDocument();
    expect(screen.getByText("暂无调试记录")).toBeInTheDocument();
  });
});
