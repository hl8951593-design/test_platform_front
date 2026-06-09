import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ScenariosPage } from "./ScenariosPage";

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
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("creates, configures, saves, and runs a scenario", async () => {
    mockAssets();
    const onAction = vi.fn();
    render(<ScenariosPage environmentId={1} environments={environments} onAction={onAction} projectId={7} />);

    fireEvent.click(screen.getByTitle("新建场景"));
    fireEvent.change(screen.getByLabelText("场景名称"), { target: { value: "登录消息场景" } });
    fireEvent.click(await screen.findByRole("button", { name: /登录接口/ }));
    fireEvent.change(screen.getByLabelText("步骤配置 JSON"), { target: { value: '{"extract":"token"}' } });
    fireEvent.click(screen.getByRole("button", { name: "保存场景" }));

    expect(localStorage.getItem("testauto_scenarios_project_7")).toContain("登录消息场景");
    expect(screen.getByText("1 步骤 · 1 数据集")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "运行场景" }));

    expect(await screen.findByRole("button", { name: "调试记录" })).toHaveClass("active");
    expect(screen.getByText("UAT · 默认数据")).toBeInTheDocument();
    expect(screen.getByText("执行通过")).toBeInTheDocument();
    expect(localStorage.getItem("testauto_scenario_runs_project_7")).toContain("登录消息场景");
  });

  it("supports step ordering and data-driven datasets", async () => {
    mockAssets();
    render(<ScenariosPage environmentId={1} environments={environments} onAction={vi.fn()} projectId={3} />);

    fireEvent.click(screen.getByTitle("新建场景"));
    fireEvent.click(await screen.findByRole("button", { name: /登录接口/ }));
    fireEvent.click(screen.getByRole("button", { name: /等待事件/ }));
    const waitStep = screen.getAllByText("等待事件").find((element) => element.closest(".scenario-step-card"))?.closest(".scenario-step-card") as HTMLElement;
    fireEvent.click(within(waitStep).getByTitle("上移"));

    const stepCards = document.querySelectorAll(".scenario-step-card");
    expect(stepCards[0]).toHaveTextContent("等待事件");

    fireEvent.click(screen.getByRole("button", { name: "数据驱动" }));
    fireEvent.click(screen.getByRole("button", { name: "新增数据集" }));
    fireEvent.change(screen.getByLabelText("数据集 2 名称"), { target: { value: "VIP 用户" } });
    fireEvent.change(screen.getByLabelText("VIP 用户 变量 JSON"), { target: { value: '{"user_id":1001}' } });
    fireEvent.click(screen.getByRole("button", { name: "保存场景" }));
    fireEvent.click(screen.getByRole("button", { name: "运行场景" }));

    expect(localStorage.getItem("testauto_scenarios_project_3")).toContain("VIP 用户");
    expect(localStorage.getItem("testauto_scenarios_project_3")).toContain("等待事件");
    expect(JSON.parse(localStorage.getItem("testauto_scenario_runs_project_3") ?? "[]")).toHaveLength(2);
  });

  it("keeps scenarios isolated by project", async () => {
    mockAssets();
    const { rerender } = render(<ScenariosPage environmentId={1} environments={environments} onAction={vi.fn()} projectId={1} />);
    fireEvent.click(screen.getByTitle("新建场景"));
    fireEvent.change(screen.getByLabelText("场景名称"), { target: { value: "项目一场景" } });
    fireEvent.click(await screen.findByRole("button", { name: /登录接口/ }));
    fireEvent.click(screen.getByRole("button", { name: "保存场景" }));
    expect(screen.getByText("项目一场景")).toBeInTheDocument();

    mockAssets();
    rerender(<ScenariosPage environmentId={1} environments={environments} onAction={vi.fn()} projectId={2} />);

    await waitFor(() => expect(screen.queryByText("项目一场景")).not.toBeInTheDocument());
    expect(screen.getByText("暂无场景")).toBeInTheDocument();
  });

  it("copies and deletes a saved scenario", async () => {
    mockAssets();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<ScenariosPage environmentId={1} environments={environments} onAction={vi.fn()} projectId={9} />);

    fireEvent.click(screen.getByTitle("新建场景"));
    fireEvent.click(screen.getByRole("button", { name: /等待事件/ }));
    fireEvent.click(screen.getByRole("button", { name: "保存场景" }));
    fireEvent.click(screen.getByRole("button", { name: "复制" }));

    expect(screen.getByText("未命名测试场景 - 副本")).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("testauto_scenarios_project_9") ?? "[]")).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "删除" }));

    expect(JSON.parse(localStorage.getItem("testauto_scenarios_project_9") ?? "[]")).toHaveLength(1);
    expect(screen.queryByText("未命名测试场景 - 副本")).not.toBeInTheDocument();
  });
});
