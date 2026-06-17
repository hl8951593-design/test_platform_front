import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { DefectsPage } from "./DefectsPage";

function jsonResponse(data: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ code: 0, message: "ok", data }),
  } as Response;
}

describe("DefectsPage", () => {
  afterEach(() => vi.restoreAllMocks());

  it("creates a defect with rich text content", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse({
        id: 1,
        project_id: 1,
        title: "支付成功后订单未完成",
        assignee_name: "QA Owner",
        bug_type: "functional",
        urgency: "critical",
        status: "new",
        content_html: "<p><strong>实际结果</strong>：订单仍为待支付</p>",
      }))
      .mockResolvedValueOnce(jsonResponse([]));

    render(<DefectsPage onAction={vi.fn()} projectId={1} />);

    expect(await screen.findByText("暂无缺陷记录")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /新建缺陷/ }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(screen.getByPlaceholderText("例如：支付成功后订单状态未同步"), {
      target: { value: "支付成功后订单未完成" },
    });
    fireEvent.change(screen.getByPlaceholderText("请输入处理人"), { target: { value: "QA Owner" } });
    fireEvent.change(within(dialog).getByLabelText("紧急程度"), { target: { value: "critical" } });
    const editor = within(dialog).getByRole("textbox", { name: "Bug 内容" });
    editor.innerHTML = "<p><strong>实际结果</strong>：订单仍为待支付</p>";
    fireEvent.input(editor);
    fireEvent.click(screen.getByRole("button", { name: /保存缺陷/ }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    const [, init] = fetchMock.mock.calls[1];
    expect(JSON.parse(String(init?.body))).toEqual(expect.objectContaining({
      title: "支付成功后订单未完成",
      assignee: "QA Owner",
      urgency: "critical",
      content_html: "<p><strong>实际结果</strong>：订单仍为待支付</p>",
    }));
  });
});
