import { listDefects, saveDefect } from "./defects";

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
    }));
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
    });
  });
});
