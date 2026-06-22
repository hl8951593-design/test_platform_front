import { deleteDefectImage, getDefect, listDefects, refreshDefectImageUrl, saveDefect, uploadDefectImage } from "./defects";

function jsonResponse(data: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ code: 0, message: "ok", data }),
  } as Response;
}

describe("defects API", () => {
  afterEach(() => vi.restoreAllMocks());

  it("maps paginated snake_case defect responses", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({
      items: [{
        id: 18,
        project_id: 1,
        title: "支付状态不同步",
        assignee_name: "李雷",
        bug_type: "functional",
        urgency: "critical",
        status: "confirmed",
        content_html: "<p>复现步骤</p>",
        reporter_name: "韩梅梅",
        created_at: "2026-06-17T08:00:00",
        updated_at: "2026-06-17T09:00:00",
        attachments: [{
          id: 12,
          original_filename: "checkout.png",
          content_type: "image/png",
          size_bytes: 183024,
          download_url: "https://minio.example/checkout.png",
          created_at: "2026-06-17T08:30:00",
        }],
      }],
      total: 1,
    }));

    const defects = await listDefects(1);

    expect(defects[0]).toEqual(expect.objectContaining({
      id: "18",
      projectId: 1,
      title: "支付状态不同步",
      assignee: "李雷",
      type: "functional",
      urgency: "critical",
      status: "confirmed",
      contentHtml: "<p>复现步骤</p>",
      reporter: "韩梅梅",
      attachments: [expect.objectContaining({
        id: 12,
        originalFilename: "checkout.png",
        downloadUrl: "https://minio.example/checkout.png",
      })],
    }));
  });

  it("loads one defect for the detail page", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({
      id: 18,
      project_id: 7,
      title: "详情缺陷",
      status: "active",
    }));

    await expect(getDefect(7, "18")).resolves.toEqual(expect.objectContaining({ id: "18", title: "详情缺陷" }));
    expect(fetchMock.mock.calls[0][0]).toBe("http://127.0.0.1:8000/api/v1/defects/18?project_id=7");
  });

  it("submits editable defect fields with rich text content", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({
      id: 19,
      project_id: 1,
      title: "头像上传失败",
      status: "new",
    }));

    await saveDefect(1, {
      title: "头像上传失败",
      assignee: "王强",
      type: "ui",
      urgency: "high",
      status: "new",
      contentHtml: "<p><strong>粘贴截图</strong><img src=\"data:image/png;base64,abc\" /></p>",
      mediaIds: [12],
    });

    const [, init] = fetchMock.mock.calls[0];
    expect(fetchMock.mock.calls[0][0]).toBe("http://127.0.0.1:8000/api/v1/defects?project_id=1");
    expect(JSON.parse(String(init?.body))).toEqual({
      title: "头像上传失败",
      assignee: "王强",
      bug_type: "ui",
      urgency: "high",
      status: "new",
      content_html: "<p><strong>粘贴截图</strong><img src=\"data:image/png;base64,abc\" /></p>",
      media_ids: [12],
    });
  });

  it("omits media_ids when an edit keeps its existing attachments", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ id: 19, project_id: 1 }));

    await saveDefect(1, {
      id: "19",
      title: "保留附件",
      assignee: "",
      type: "ui",
      urgency: "high",
      status: "new",
      contentHtml: "<p>内容</p>",
    });

    const payload = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(payload).not.toHaveProperty("media_ids");
  });

  it("sends an empty media_ids array when an edit unbinds every attachment", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ id: 19, project_id: 1 }));

    await saveDefect(1, {
      id: "19",
      title: "解绑附件",
      assignee: "",
      type: "ui",
      urgency: "high",
      status: "new",
      contentHtml: "<p>内容</p>",
      mediaIds: [],
    });

    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).media_ids).toEqual([]);
  });

  it("uploads, refreshes and deletes media with the project boundary", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({
        id: 23,
        original_filename: "failure.png",
        content_type: "image/png",
        size_bytes: 4,
        download_url: "https://minio.example/old",
        created_at: "2026-06-17T08:00:00",
      }))
      .mockResolvedValueOnce(jsonResponse({ url: "https://minio.example/new", expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse(null));

    const file = new File(["test"], "failure.png", { type: "image/png" });
    const uploaded = await uploadDefectImage(7, file);
    expect(uploaded.id).toBe(23);
    expect(fetchMock.mock.calls[0][0]).toBe("http://127.0.0.1:8000/api/v1/media/images?project_id=7");
    const uploadInit = fetchMock.mock.calls[0][1];
    expect(uploadInit?.body).toBeInstanceOf(FormData);
    expect((uploadInit?.headers as Headers).has("Content-Type")).toBe(false);
    expect((uploadInit?.body as FormData).get("file")).toBe(file);

    await expect(refreshDefectImageUrl(7, 23)).resolves.toBe("https://minio.example/new");
    expect(fetchMock.mock.calls[1][0]).toBe("http://127.0.0.1:8000/api/v1/media/23/url?project_id=7");

    await deleteDefectImage(7, 23);
    expect(fetchMock.mock.calls[2]).toEqual([
      "http://127.0.0.1:8000/api/v1/media/23?project_id=7",
      expect.objectContaining({ method: "DELETE" }),
    ]);
  });
});
