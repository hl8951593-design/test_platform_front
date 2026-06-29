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
  afterEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState(null, "", "/defects");
  });

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
    expect(JSON.parse(String(init?.body))).not.toHaveProperty("media_ids");
  });

  it("inserts a pasted image into the rich text and saves a stable media marker", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse({
        id: 12,
        original_filename: "checkout.png",
        content_type: "image/png",
        size_bytes: 4,
        download_url: "https://minio.example/temporary-url",
        created_at: "2026-06-17T08:00:00",
      }))
      .mockResolvedValueOnce(jsonResponse({ id: 1, project_id: 1, title: "结算失败", attachments: [] }))
      .mockResolvedValueOnce(jsonResponse([]));

    render(<DefectsPage onAction={vi.fn()} projectId={1} />);
    expect(await screen.findByText("暂无缺陷记录")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /新建缺陷/ }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(screen.getByPlaceholderText("例如：支付成功后订单状态未同步"), { target: { value: "结算失败" } });
    const editor = within(dialog).getByRole("textbox", { name: "Bug 内容" });
    editor.innerHTML = "<p>复现步骤</p>";
    fireEvent.input(editor);

    const file = new File(["test"], "checkout.png", { type: "image/png" });
    fireEvent.paste(editor, { clipboardData: { files: [file] } });
    const inlineImage = await within(editor).findByAltText("checkout.png");
    expect(inlineImage).toHaveAttribute("data-media-id", "12");
    expect(dialog.querySelector(".defect-attachment-gallery")).not.toBeInTheDocument();
    expect(within(dialog).getByText(/粘贴截图会直接插入正文/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: /保存缺陷/ }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    expect(fetchMock.mock.calls[1][1]?.body).toBeInstanceOf(FormData);
    const payload = JSON.parse(String(fetchMock.mock.calls[2][1]?.body));
    expect(payload.media_ids).toEqual([12]);
    expect(payload.content_html).toContain('data-media-id="12"');
    expect(payload.content_html).toContain('src="/__defect_media__/12"');
    expect(payload.content_html).not.toContain("temporary-url");
  });

  it("restores a saved inline image when the backend stripped its data attribute", async () => {
    const defect = {
      id: 21,
      project_id: 1,
      title: "正文截图兼容",
      bug_type: "ui",
      urgency: "medium",
      status: "active",
      content_html: '<p>复现步骤</p><img alt="legacy.png">',
      attachments: [{
        id: 31,
        original_filename: "legacy.png",
        content_type: "image/png",
        size_bytes: 4,
        download_url: "https://minio.example/legacy",
        created_at: "2026-06-18T08:00:00",
      }],
    };
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse([defect]))
      .mockResolvedValueOnce(jsonResponse(defect));

    render(<DefectsPage onAction={vi.fn()} projectId={1} />);
    fireEvent.click(await screen.findByText("正文截图兼容"));

    const image = await screen.findByAltText("legacy.png");
    expect(image).toHaveAttribute("src", "https://minio.example/legacy");
    expect(screen.queryByRole("heading", { name: "图片附件" })).not.toBeInTheDocument();
  });

  it("previews rich text images and switches between them", async () => {
    const defect = {
      id: 22,
      project_id: 1,
      title: "多图预览",
      bug_type: "ui",
      urgency: "medium",
      status: "active",
      content_html: '<p>截图</p><img src="/__defect_media__/41" alt="first.png"><img src="/__defect_media__/42" alt="second.png">',
      attachments: [
        { id: 41, original_filename: "first.png", content_type: "image/png", size_bytes: 4, download_url: "https://minio.example/first", created_at: "2026-06-18T08:00:00" },
        { id: 42, original_filename: "second.png", content_type: "image/png", size_bytes: 4, download_url: "https://minio.example/second", created_at: "2026-06-18T08:01:00" },
      ],
    };
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse([defect]))
      .mockResolvedValueOnce(jsonResponse(defect));

    render(<DefectsPage onAction={vi.fn()} projectId={1} />);
    fireEvent.click(await screen.findByText("多图预览"));
    const firstImage = await screen.findByAltText("first.png");
    fireEvent.click(firstImage);
    fireEvent.click(firstImage, { detail: 2 });

    const preview = await screen.findByRole("dialog", { name: "图片预览" });
    expect(within(preview).getByText("1 / 2")).toBeInTheDocument();
    expect(within(preview).getByAltText("first.png")).toHaveAttribute("src", "https://minio.example/first");
    fireEvent.click(within(preview).getByRole("button", { name: "下一张图片" }));
    expect(within(preview).getByText("2 / 2")).toBeInTheDocument();
    expect(within(preview).getByAltText("second.png")).toHaveAttribute("src", "https://minio.example/second");
    fireEvent.click(within(preview).getByRole("button", { name: "上一张图片" }));
    expect(within(preview).getByText("1 / 2")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "图片预览" })).not.toBeInTheDocument();
  });

  it("refreshes an expired attachment URL after the image fails to load", async () => {
    const defect = {
      id: 18,
      project_id: 1,
      title: "截图已过期",
      assignee_name: "李雷",
      reporter_name: "韩梅梅",
      bug_type: "ui",
      urgency: "medium",
      status: "new",
      content_html: "<p>查看附件</p>",
      attachments: [{
        id: 12,
        original_filename: "expired.png",
        content_type: "image/png",
        size_bytes: 4,
        download_url: "https://minio.example/expired",
        created_at: "2026-06-17T08:00:00",
      }],
    };
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse([defect]))
      .mockResolvedValueOnce(jsonResponse(defect))
      .mockResolvedValueOnce(jsonResponse({ url: "https://minio.example/refreshed", expires_in: 3600 }));

    render(<DefectsPage onAction={vi.fn()} projectId={1} />);
    expect(await screen.findByText("截图已过期")).toBeInTheDocument();
    expect(screen.queryByText("查看附件")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "编辑缺陷" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "删除缺陷" })).not.toBeInTheDocument();

    const statusMenuButton = screen.getByRole("button", { name: "流转“截图已过期”状态" });
    fireEvent.click(statusMenuButton);
    expect(statusMenuButton.closest(".defect-summary-card")?.querySelector(".defect-status-menu")).toHaveClass("open");
    expect(screen.getByRole("menuitem", { name: /已激活/ })).toBeInTheDocument();
    fireEvent.click(screen.getByText("截图已过期"));

    const image = await screen.findByAltText("expired.png");
    expect(window.location.pathname).toBe("/defects/18");
    expect(screen.getByRole("button", { name: "编辑缺陷" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "删除缺陷" })).toBeInTheDocument();
    fireEvent.error(image);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(fetchMock.mock.calls[1][0]).toBe("http://127.0.0.1:8000/api/v1/defects/18?project_id=1");
    expect(fetchMock.mock.calls[2][0]).toBe("http://127.0.0.1:8000/api/v1/media/12/url?project_id=1");
    await waitFor(() => expect(image.getAttribute("src")).toContain("https://minio.example/refreshed"));
  });
});
