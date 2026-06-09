import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { PlansPage } from "./PlansPage";

const environments = [
  { id: 1, name: "UAT", baseUrl: "https://uat.example.com", description: "", isDefault: true },
  { id: 2, name: "Prod", baseUrl: "https://prod.example.com", description: "", isDefault: false },
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
    } as Response)
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ code: 0, data: [{ id: 12, name: "核心回归流程", node_count: 3 }] }),
    } as Response);
}

describe("PlansPage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("creates, persists, filters, toggles, and runs a plan", async () => {
    mockAssets();
    const onAction = vi.fn();
    render(<PlansPage environmentId={1} environments={environments} onAction={onAction} projectId={7} />);

    fireEvent.click(screen.getAllByRole("button", { name: /新建计划/ })[0]);
    fireEvent.change(screen.getByLabelText("计划名称 *"), { target: { value: "核心回归" } });
    fireEvent.click(await screen.findByRole("button", { name: /登录接口/ }));
    fireEvent.click(screen.getByRole("button", { name: "创建计划" }));

    expect(await screen.findByText("核心回归")).toBeInTheDocument();
    expect(localStorage.getItem("testauto_plans_project_7")).toContain("核心回归");

    fireEvent.change(screen.getByPlaceholderText("搜索计划名称、说明或标签"), { target: { value: "不存在" } });
    expect(screen.getByText("没有匹配的测试计划")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("搜索计划名称、说明或标签"), { target: { value: "" } });

    const card = screen.getByText("核心回归").closest(".plan-card") as HTMLElement;
    fireEvent.click(within(card).getByTitle("停用计划"));
    expect(within(card).getByText("已停用")).toBeInTheDocument();

    fireEvent.click(within(card).getByTitle("运行 核心回归"));
    fireEvent.click(screen.getByRole("button", { name: "确认运行" }));

    expect(await screen.findByText("计划执行历史")).toBeInTheDocument();
    expect(screen.getByText("1 通过 / 0 失败 / 1 总计")).toBeInTheDocument();
    expect(localStorage.getItem("testauto_plan_runs_project_7")).toContain("核心回归");
  });

  it("keeps plans isolated by project", async () => {
    mockAssets();
    const { rerender } = render(<PlansPage environmentId={1} environments={environments} onAction={vi.fn()} projectId={1} />);
    fireEvent.click(screen.getAllByRole("button", { name: /新建计划/ })[0]);
    fireEvent.change(screen.getByLabelText("计划名称 *"), { target: { value: "项目一计划" } });
    fireEvent.click(await screen.findByRole("button", { name: /登录接口/ }));
    fireEvent.click(screen.getByRole("button", { name: "创建计划" }));
    expect(await screen.findByText("项目一计划")).toBeInTheDocument();

    mockAssets();
    rerender(<PlansPage environmentId={1} environments={environments} onAction={vi.fn()} projectId={2} />);

    await waitFor(() => expect(screen.queryByText("项目一计划")).not.toBeInTheDocument());
    expect(screen.getByText("暂无测试计划")).toBeInTheDocument();
  });

  it("shows enabled cron plans on the schedule calendar", async () => {
    localStorage.setItem("testauto_plans_project_3", JSON.stringify([{
      id: "PLN-1",
      projectId: 3,
      name: "夜间回归",
      description: "",
      enabled: true,
      triggerType: "cron",
      cronExpression: "0 2 * * *",
      webhookEvent: "",
      environmentIds: [1],
      targets: [{ id: "api-1", referenceId: 1, kind: "api_case", name: "登录", method: "POST" }],
      executionMode: "serial",
      failurePolicy: "stop",
      retryCount: 0,
      timeoutMinutes: 30,
      notificationEmails: [],
      tags: [],
      createdAt: "2026-06-08T00:00:00.000Z",
      updatedAt: "2026-06-08T00:00:00.000Z",
    }]));
    mockAssets();
    render(<PlansPage environments={environments} onAction={vi.fn()} projectId={3} />);

    fireEvent.click(screen.getByRole("button", { name: "调度日历" }));

    expect(screen.getByText("未来 14 天调度")).toBeInTheDocument();
    expect(screen.getAllByText("夜间回归").length).toBeGreaterThan(0);
  });
});
