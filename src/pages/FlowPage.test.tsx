import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FlowPage } from "./FlowPage";

describe("FlowPage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("adds a component and edits its properties", () => {
    render(<FlowPage onAction={vi.fn()} />);

    fireEvent.doubleClick(screen.getByRole("button", { name: /条件分支/ }));

    expect(screen.getByText("1 节点 · 0 关联")).toBeInTheDocument();
    const nameInput = screen.getByLabelText("节点名称");
    fireEvent.change(nameInput, { target: { value: "校验登录结果" } });
    expect(screen.getByText("校验登录结果")).toBeInTheDocument();
  });

  it("connects two nodes through their ports", () => {
    render(<FlowPage onAction={vi.fn()} />);

    fireEvent.doubleClick(screen.getByRole("button", { name: /开始 流程执行入口/ }));
    fireEvent.doubleClick(screen.getByRole("button", { name: /结束 流程执行终点/ }));
    fireEvent.click(screen.getByRole("button", { name: "从 开始 建立连接" }));
    fireEvent.click(screen.getByRole("button", { name: "连接到 结束" }));

    expect(screen.getByText("2 节点 · 1 关联")).toBeInTheDocument();
    expect(screen.getByText("1 上游 · 0 下游")).toBeInTheDocument();
    expect(screen.getByText("上游节点")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "查看上游节点 开始" })).toBeInTheDocument();
    expect(screen.getByText(/把上游节点输出写入当前节点的请求变量/)).toBeInTheDocument();
  });

  it("connects nodes by dragging from an output port to an input port", () => {
    const { container } = render(<FlowPage onAction={vi.fn()} />);

    fireEvent.doubleClick(screen.getByRole("button", { name: /开始 流程执行入口/ }));
    fireEvent.doubleClick(screen.getByRole("button", { name: /结束 流程执行终点/ }));
    fireEvent.pointerDown(screen.getByRole("button", { name: "从 开始 建立连接" }), { clientX: 100, clientY: 100 });
    fireEvent.pointerUp(screen.getByRole("button", { name: "连接到 结束" }), { clientX: 300, clientY: 100 });

    expect(screen.getByText("2 节点 · 1 关联")).toBeInTheDocument();
    expect(container.querySelector(".flow-canvas")).toHaveStyle({ width: "100%", height: "100%" });
  });

  it("deletes the selected node and its connections", () => {
    render(<FlowPage onAction={vi.fn()} />);

    fireEvent.doubleClick(screen.getByRole("button", { name: /开始 流程执行入口/ }));
    fireEvent.doubleClick(screen.getByRole("button", { name: /结束 流程执行终点/ }));
    fireEvent.click(screen.getByRole("button", { name: "从 开始 建立连接" }));
    fireEvent.click(screen.getByRole("button", { name: "连接到 结束" }));
    fireEvent.click(screen.getByRole("button", { name: "删除节点" }));

    expect(screen.getByText("1 节点 · 0 关联")).toBeInTheDocument();
  });

  it("removes input bindings when their upstream edge is deleted", () => {
    const { container } = render(<FlowPage onAction={vi.fn()} />);

    fireEvent.doubleClick(screen.getByRole("button", { name: /开始 流程执行入口/ }));
    fireEvent.doubleClick(screen.getByRole("button", { name: /结束 流程执行终点/ }));
    fireEvent.click(screen.getByRole("button", { name: "从 开始 建立连接" }));
    fireEvent.click(screen.getByRole("button", { name: "连接到 结束" }));
    fireEvent.click(screen.getByRole("button", { name: "+ 新增" }));
    expect(screen.getByLabelText("目标字段")).toBeInTheDocument();

    fireEvent.click(container.querySelector(".flow-lines path") as SVGPathElement);

    expect(screen.queryByLabelText("目标字段")).not.toBeInTheDocument();
    expect(screen.getByText("2 节点 · 0 关联")).toBeInTheDocument();
  });

  it("preserves the current canvas when only the environment changes", () => {
    const { rerender } = render(<FlowPage environmentId={1} onAction={vi.fn()} projectId={1} />);
    fireEvent.doubleClick(screen.getByRole("button", { name: /条件分支/ }));
    expect(screen.getByText("1 节点 · 0 关联")).toBeInTheDocument();

    rerender(<FlowPage environmentId={2} onAction={vi.fn()} projectId={1} />);

    expect(screen.getByText("1 节点 · 0 关联")).toBeInTheDocument();
  });

  it("edits node-local caseConfig without changing the referenced case", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ code: 0, message: "ok", data: [{ id: 10, name: "登录接口", method: "POST", path: "/login" }] }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ code: 0, message: "ok", data: [] }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ code: 0, message: "ok", data: [] }),
      } as Response);
    render(<FlowPage onAction={vi.fn()} projectId={1} />);

    fireEvent.doubleClick(await screen.findByRole("button", { name: /登录接口/ }));
    const editor = screen.getByLabelText("完整本地配置 caseConfig");
    fireEvent.change(editor, { target: { value: '{"path":"/flow-login"}' } });

    expect(JSON.parse(String((editor as HTMLTextAreaElement).value))).toEqual({ path: "/flow-login" });
    expect(screen.getAllByText("/login").length).toBeGreaterThan(0);
  });

  it("confirms before deleting a saved flow", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ code: 0, message: "ok", data: [] }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ code: 0, message: "ok", data: [] }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          code: 0,
          message: "ok",
          data: [{ id: 12, name: "支付回归流程", description: "", node_count: 2 }],
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ code: 0, message: "ok", data: null }),
      } as Response);
    const onAction = vi.fn();
    render(<FlowPage onAction={onAction} projectId={1} />);

    fireEvent.click(await screen.findByRole("button", { name: "删除流程 支付回归流程" }));
    expect(screen.getByRole("dialog", { name: "确认删除该可视化流程？" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(3);

    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));

    await waitFor(() => expect(screen.queryByText("支付回归流程")).not.toBeInTheDocument());
    expect(fetchMock).toHaveBeenLastCalledWith(
      "http://127.0.0.1:8000/api/v1/flows/12?project_id=1",
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(onAction).toHaveBeenCalledWith("已删除流程 支付回归流程");
  });
});
