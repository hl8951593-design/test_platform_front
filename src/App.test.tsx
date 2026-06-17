import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import App from "./App";
import { listProjects } from "./api/projects";
import { ApiPage } from "./pages/ApiPage";

function createJwt(payload: Record<string, unknown>) {
  const base64UrlEncode = (value: string) =>
    window.btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  return `${base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${base64UrlEncode(
    JSON.stringify(payload),
  )}.signature`;
}

describe("App routing shell", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("renders the reports page from the current path", () => {
    window.history.pushState(null, "", "/reports#/");
    render(<App />);
    expect(screen.getByText("核心结算流程测试报告")).toBeInTheDocument();
    expect(screen.getByText("失败聚类分析")).toBeInTheDocument();
  });

  it("opens the profile page when the user entry is clicked", () => {
    localStorage.setItem("auth_user", JSON.stringify({
      id: 8,
      username: "测试管理员",
      avatar: null,
      account: "admin",
      phone: "13800138000",
      email: "admin@example.com",
      is_active: true,
      created_at: "2026-06-02T10:00:00",
    }));
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ code: 0, message: "ok", data: [] }),
    } as Response);
    window.history.pushState(null, "", "/dashboard#/");

    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "进入个人中心" }));

    expect(window.location.pathname).toBe("/profile");
    expect(screen.getByRole("heading", { name: "个人中心" })).toBeInTheDocument();
    expect(screen.getAllByText("测试管理员").length).toBeGreaterThan(0);
    expect(screen.getByText("admin@example.com")).toBeInTheDocument();
  });

  it("renders required register fields on the login page", () => {
    window.history.pushState(null, "", "/login#/");
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "注册" }));

    expect(screen.getByLabelText(/用户名/)).toBeInTheDocument();
    expect(screen.getByLabelText(/账号/)).toBeInTheDocument();
    expect(screen.getByLabelText(/手机号/)).toBeInTheDocument();
    expect(screen.getByLabelText(/密码/)).toBeInTheDocument();
    expect(screen.getByLabelText(/邮箱/)).toBeInTheDocument();
    expect(screen.getByLabelText(/头像地址/)).toBeInTheDocument();
  });

  it("calls the login API, stores tokens, and enters the dashboard", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          code: 0,
          message: "登录成功",
          data: {
            access_token: "access-token",
            refresh_token: "refresh-token",
            token_type: "bearer",
            user: {
              id: 1,
              username: "测试用户",
              avatar: null,
              account: "test_user",
              phone: "13800138000",
              email: "test@example.com",
              is_active: true,
              created_at: "2026-06-02T10:00:00",
            },
          },
        }),
      } as Response)
      .mockResolvedValue({
        ok: true,
        json: async () => ({ code: 0, message: "ok", data: [] }),
      } as Response);

    window.history.pushState(null, "", "/login#/");
    render(<App />);

    fireEvent.change(screen.getByLabelText(/账号/), { target: { value: "test_user" } });
    fireEvent.change(screen.getByLabelText(/密码/), { target: { value: "123456" } });
    fireEvent.click(screen.getAllByRole("button", { name: "登录" })[1]);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "http://127.0.0.1:8000/api/v1/auth/login",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ account: "test_user", password: "123456" }),
        }),
      ),
    );
    await waitFor(() => expect(localStorage.getItem("access_token")).toBe("access-token"));
    expect(window.location.pathname).toBe("/dashboard");
  });

  it("refreshes the access token before protected requests when it is about to expire", async () => {
    localStorage.setItem("access_token", createJwt({ exp: Math.floor(Date.now() / 1000) + 60 }));
    localStorage.setItem("refresh_token", "refresh-token");

    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          code: 0,
          message: "ok",
          data: {
            access_token: "fresh-access-token",
            refresh_token: "fresh-refresh-token",
            token_type: "bearer",
          },
        }),
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
          data: [],
        }),
      } as Response);

    await listProjects();

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://127.0.0.1:8000/api/v1/auth/refresh",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ refresh_token: "refresh-token" }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:8000/api/v1/projects",
      expect.objectContaining({
        headers: expect.any(Headers),
      }),
    );
    expect(localStorage.getItem("access_token")).toBe("fresh-access-token");
  });

  it("clears expired credentials and redirects to login when a protected API returns 401", async () => {
    localStorage.setItem("access_token", "expired-access-token");
    localStorage.setItem("refresh_token", "expired-refresh-token");
    window.history.pushState(null, "", "/api#/");

    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ detail: "登录凭证已过期，请重新登录" }),
    } as Response);

    render(<App />);

    await waitFor(() => expect(window.location.pathname).toBe("/login"));
    expect(localStorage.getItem("access_token")).toBeNull();
    expect(localStorage.getItem("refresh_token")).toBeNull();
    expect(screen.getByText(/authenticated|登录凭证/)).toBeInTheDocument();
  });

  it("filters API test cases by title and request method", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => ({
      ok: true,
      json: async () => ({
        code: 0,
        message: "ok",
        data: String(input).includes("/websocket-test-cases")
          ? []
          : [
          {
            id: 1,
            name: "登录用户",
            method: "POST",
            path: "/auth/login",
            group: "Auth",
            creator_name: "QA",
            status: "enabled",
            last_execution_status: "passed",
            environment_ids: [1, 2],
          },
          {
            id: 2,
            name: "查询用户详情",
            method: "GET",
            path: "/users/{id}",
            group: "User",
            creator_name: "QA",
            status: "draft",
            last_execution_status: "failed",
            environment_ids: [2],
          },
            ],
      }),
    }) as Response);

    render(
      <ApiPage
        environmentError=""
        environmentId={1}
        environmentLoading={false}
        environments={[
          { id: 1, name: "UAT", baseUrl: "https://api.test", description: "", isDefault: true },
          { id: 2, name: "TEST", baseUrl: "https://test.api", description: "", isDefault: false },
        ]}
        onAction={vi.fn()}
        projectId={1}
      />,
    );

    expect(await screen.findByText("登录用户")).toBeInTheDocument();
    expect(screen.getByText("查询用户详情")).toBeInTheDocument();
    expect(screen.getByText("通过")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("按用例标题查询"), { target: { value: "登录" } });
    expect(screen.getByText("登录用户")).toBeInTheDocument();
    expect(screen.queryByText("查询用户详情")).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("按用例标题查询"), { target: { value: "" } });
    expect(screen.getByText("查询用户详情")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("请求方式"));
    fireEvent.click(screen.getByRole("button", { name: /POST/ }));
    expect(screen.getByText("登录用户")).toBeInTheDocument();
    expect(screen.queryByText("查询用户详情")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /GET/ }));
    expect(screen.getByText("登录用户")).toBeInTheDocument();
    expect(screen.getByText("查询用户详情")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /POST/ }));
    expect(screen.queryByText("登录用户")).not.toBeInTheDocument();
    expect(screen.getByText("查询用户详情")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "草稿" }));
    expect(screen.getByText("查询用户详情")).toBeInTheDocument();
    expect(screen.queryByText("登录用户")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "已启用" }));
    expect(screen.queryByText("查询用户详情")).not.toBeInTheDocument();
    expect(screen.queryByText("登录用户")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "全部" }));
    expect(screen.getByText("查询用户详情")).toBeInTheDocument();
  });

  it("paginates API test cases and keeps the total count visible", async () => {
    const testCases = Array.from({ length: 12 }, (_, index) => ({
      id: index + 1,
      case_no: `API-${String(index + 1).padStart(3, "0")}`,
      name: `分页用例 ${index + 1}`,
      method: "GET",
      path: `/items/${index + 1}`,
      status: "enabled",
      environment_ids: [1],
    }));
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => ({
      ok: true,
      json: async () => ({
        code: 0,
        message: "ok",
        data: String(input).includes("/websocket-test-cases") ? [] : testCases,
      }),
    }) as Response);

    render(
      <ApiPage
        environmentError=""
        environmentId={1}
        environmentLoading={false}
        environments={[{ id: 1, name: "test", baseUrl: "https://api.test", description: "", isDefault: true }]}
        onAction={vi.fn()}
        projectId={1}
      />,
    );

    expect(await screen.findByText("分页用例 1")).toBeInTheDocument();
    expect(screen.getByText("分页用例 10")).toBeInTheDocument();
    expect(screen.queryByText("分页用例 11")).not.toBeInTheDocument();
    expect(screen.getByText("显示 1-10，共 12 条用例")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    expect(screen.getByText("分页用例 11")).toBeInTheDocument();
    expect(screen.getByText("分页用例 12")).toBeInTheDocument();
    expect(screen.queryByText("分页用例 1")).not.toBeInTheDocument();
  });

  it("creates an environment variable from the API test case page", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          code: 0,
          message: "ok",
          data: [
            {
              id: 1,
              name: "登录用户",
              method: "POST",
              path: "/auth/login",
              group: "Auth",
              environment_id: 1,
              creator_name: "QA",
              status: "enabled",
            },
          ],
        }),
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
          data: [
            { id: 9, name: "user_id", value: "1001", is_secret: false },
            { id: 10, name: "access_token", value: "real-token", is_secret: true },
          ],
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          code: 0,
          message: "ok",
          data: { id: 1, name: "access_token", value: "abc123", is_secret: true },
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          code: 0,
          message: "ok",
          data: { id: 9, name: "user_id", value: "1002", is_secret: false },
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ code: 0, message: "ok", data: null }),
      } as Response);
    const onAction = vi.fn();

    render(
      <ApiPage
        environmentError=""
        environmentId={1}
        environmentLoading={false}
        environments={[{ id: 1, name: "UAT", baseUrl: "https://api.test", description: "", isDefault: true }]}
        onAction={onAction}
        projectId={1}
      />,
    );

    expect(await screen.findByText("登录用户")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /新增变量/ }));
    expect(await screen.findByText("user_id")).toBeInTheDocument();
    expect(screen.getByText("1001")).toBeInTheDocument();
    expect(screen.getByText("******")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("例如 access_token"), { target: { value: "access_token" } });
    fireEvent.change(screen.getByPlaceholderText("例如 Bearer token"), { target: { value: "abc123" } });
    fireEvent.click(screen.getByLabelText("敏感变量"));
    fireEvent.click(screen.getByRole("button", { name: /保存变量/ }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith(
        "http://127.0.0.1:8000/api/v1/environment-configs/1/variables?project_id=1",
        expect.objectContaining({
          body: JSON.stringify({ name: "access_token", value: "abc123", is_secret: true }),
          method: "POST",
        }),
      ),
    );
    expect(onAction).toHaveBeenCalledWith("新增环境变量 access_token");

    fireEvent.click(screen.getAllByTitle("编辑变量")[0]);
    expect(screen.getByRole("heading", { name: "编辑环境变量" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("user_id")).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText("例如 Bearer token"), { target: { value: "1002" } });
    fireEvent.click(screen.getByRole("button", { name: /保存修改/ }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith(
        "http://127.0.0.1:8000/api/v1/environment-configs/1/variables?project_id=1",
        expect.objectContaining({
          body: JSON.stringify({ name: "user_id", value: "1002", is_secret: false }),
          method: "POST",
        }),
      ),
    );
    expect(screen.getByText("1002")).toBeInTheDocument();

    fireEvent.click(screen.getAllByTitle("删除变量")[0]);
    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith(
        "http://127.0.0.1:8000/api/v1/environment-configs/1/variables/9?project_id=1",
        expect.objectContaining({ method: "DELETE" }),
      ),
    );
    expect(screen.queryByText("user_id")).not.toBeInTheDocument();
  });

  it("shows debug execution response in the API case editor", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          code: 0,
          message: "ok",
          data: [
            {
              id: 1,
              name: "登录用户",
              method: "POST",
              path: "/finance/api/login",
              group: "Auth",
              environment_id: 1,
              creator_name: "QA",
              status: "enabled",
            },
          ],
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ code: 0, message: "ok", data: [] }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          code: 0,
          message: "临时测试用例执行完成",
          data: {
            status: "passed",
            duration_ms: 1744,
            request_snapshot: {
              url: "https://app.familyassistant.top/finance/api/login",
              method: "POST",
              body_type: "json",
            },
            response_snapshot: {
              status_code: 403,
              body: null,
              json: { message: "error code: 1010" },
              headers: { Server: "cloudflare" },
            },
            assertion_results: [
              {
                actual: 403,
                passed: false,
                assertion: { path: null, type: "status_code", expected: 200 },
              },
            ],
            error_message: null,
            created_at: "2026-06-04T07:00:43",
          },
        }),
      } as Response);

    render(
      <ApiPage
        environmentError=""
        environmentId={1}
        environmentLoading={false}
        environments={[{ id: 1, name: "UAT", baseUrl: "https://api.test", description: "", isDefault: true }]}
        onAction={vi.fn()}
        projectId={1}
      />,
    );

    fireEvent.click(await screen.findByText("登录用户"));
    expect(screen.getByRole("button", { name: "响应" })).toBeInTheDocument();
    expect(screen.queryByText(["示例", "响应"].join(""))).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /调试/ }));

    expect(await screen.findByText("执行响应")).toBeInTheDocument();
    expect(screen.getByText("HTTP 403")).toBeInTheDocument();
    expect(screen.getAllByText(/error code: 1010/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "格式化 JSON" }));
    expect(screen.getByText("JSON 已格式化")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "响应头" }));
    expect(screen.getByText(/cloudflare/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "请求快照" }));
    expect(screen.getByText(/familyassistant/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "断言结果" }));
    expect(screen.getByText(/notpass/)).toBeInTheDocument();
    expect(screen.getByText(/期望 200，实际 403/)).toBeInTheDocument();
    expect(screen.getByRole("tabpanel")).toHaveClass("notpass");
    expect(screen.queryByText(/"actual": 403/)).not.toBeInTheDocument();
  });

  it("uses the bound environment host variable in the case URL", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          code: 0,
          message: "ok",
          data: [{
            id: 1,
            name: "host variable case",
            method: "POST",
            path: "/api/orders",
            environment_id: 1,
          }],
        }),
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
          data: {
            id: 1,
            name: "host variable case",
            method: "POST",
            path: "{{host}}/api/orders",
            environment_id: 1,
          },
        }),
      } as Response);

    render(
      <ApiPage
        environmentError=""
        environmentId={1}
        environmentLoading={false}
        environments={[{
          id: 1,
          name: "test",
          baseUrl: "https://fallback.example.com",
          description: "",
          isDefault: true,
          variables: [{ id: "1", name: "host", value: "https://test.example.com", isSecret: false }],
        }]}
        onAction={vi.fn()}
        projectId={1}
      />,
    );

    fireEvent.click(await screen.findByText("host variable case"));
    expect(screen.getByDisplayValue("{{host}}/api/orders")).toBeInTheDocument();
    const saveButton = screen.getByRole("dialog").querySelector<HTMLButtonElement>(".modal-actions .primary");
    expect(saveButton).not.toBeNull();
    fireEvent.click(saveButton!);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith(
        "http://127.0.0.1:8000/api/v1/test-cases/1?project_id=1",
        expect.objectContaining({
          body: expect.stringContaining('"path":"{{host}}/api/orders"'),
          method: "PUT",
        }),
      ),
    );
  });

  it("updates only the edited test case when display codes are duplicated", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          code: 0,
          message: "ok",
          data: [
            {
              id: 11,
              case_no: "API-006",
              name: "商标信息接口",
              method: "GET",
              path: "/trademarks",
              environment_id: 1,
            },
            {
              id: 12,
              case_no: "API-006",
              name: "专利信息接口",
              method: "GET",
              path: "/patents",
              environment_id: 1,
            },
          ],
        }),
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
          data: {
            name: "商标查询接口",
            method: "GET",
            path: "/trademarks",
            environment_id: 1,
          },
        }),
      } as Response);

    render(
      <ApiPage
        environmentError=""
        environmentId={1}
        environmentLoading={false}
        environments={[{ id: 1, name: "test", baseUrl: "https://api.test", description: "", isDefault: true }]}
        onAction={vi.fn()}
        projectId={1}
      />,
    );

    fireEvent.click(await screen.findByText("商标信息接口"));
    fireEvent.change(screen.getByDisplayValue("商标信息接口"), { target: { value: "商标查询接口" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getAllByText("商标查询接口")).toHaveLength(1);
    expect(screen.getAllByText("专利信息接口")).toHaveLength(1);
    expect(screen.queryByText("商标信息接口")).not.toBeInTheDocument();
    expect(screen.getByText("共 2 条用例")).toBeInTheDocument();
  });

  it("formats the JSON request body from the editor toolbar", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          code: 0,
          message: "ok",
          data: [{
            id: 1,
            name: "JSON 用例",
            method: "POST",
            path: "/json",
            environment_id: 1,
            body_type: "json",
            body: { compact: true },
          }],
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ code: 0, message: "ok", data: [] }),
      } as Response);

    render(
      <ApiPage
        environmentError=""
        environmentId={1}
        environmentLoading={false}
        environments={[{ id: 1, name: "UAT", baseUrl: "https://api.test", description: "", isDefault: true }]}
        onAction={vi.fn()}
        projectId={1}
      />,
    );

    fireEvent.click(await screen.findByText("JSON 用例"));
    fireEvent.click(screen.getByRole("button", { name: "Body" }));
    const editor = screen.getByPlaceholderText("请输入 JSON 请求体；留空则按无请求体提交。");
    fireEvent.change(editor, { target: { value: '{"name":"test","nested":{"enabled":true}}' } });
    fireEvent.click(screen.getByRole("button", { name: "格式化 JSON" }));

    expect(editor).toHaveValue('{\n  "name": "test",\n  "nested": {\n    "enabled": true\n  }\n}');
    expect(screen.getByText("JSON 格式正常")).toBeInTheDocument();
  });

  it("keeps focus while typing a custom request header key", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          code: 0,
          message: "ok",
          data: [{
            id: 1,
            name: "Header 用例",
            method: "GET",
            path: "/headers",
            environment_id: 1,
          }],
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ code: 0, message: "ok", data: [] }),
      } as Response);

    render(
      <ApiPage
        environmentError=""
        environmentId={1}
        environmentLoading={false}
        environments={[{ id: 1, name: "UAT", baseUrl: "https://api.test", description: "", isDefault: true }]}
        onAction={vi.fn()}
        projectId={1}
      />,
    );

    fireEvent.click(await screen.findByText("Header 用例"));
    fireEvent.click(screen.getByRole("button", { name: "Headers" }));
    fireEvent.click(screen.getByRole("button", { name: "添加请求头" }));

    const keyInput = screen.getByPlaceholderText("选择或输入 Header Key");
    keyInput.focus();
    fireEvent.change(keyInput, { target: { value: "L" } });
    expect(screen.getByPlaceholderText("选择或输入 Header Key")).toBe(keyInput);
    expect(document.activeElement).toBe(keyInput);

    fireEvent.change(keyInput, { target: { value: "Link" } });
    expect(keyInput).toHaveValue("Link");
    expect(document.activeElement).toBe(keyInput);
  });

  it("converts GET URL query string into request params", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => ({
      ok: true,
      json: async () => ({
        code: 0,
        message: "ok",
        data: String(input).includes("/websocket-test-cases")
          ? []
          : [
          {
            id: 1,
            name: "stats case",
            method: "GET",
            path: "/finance/api/statistics",
            group: "UAT",
            environment_id: 1,
            creator_name: "QA",
            status: "enabled",
          },
            ],
      }),
    }) as Response);

    render(
      <ApiPage
        environmentError=""
        environmentId={1}
        environmentLoading={false}
        environments={[{ id: 1, name: "UAT", baseUrl: "https://api.test", description: "", isDefault: true }]}
        onAction={vi.fn()}
        projectId={1}
      />,
    );

    fireEvent.click(await screen.findByText("stats case"));
    const urlInput = screen.getByPlaceholderText(/接口地址/);
    fireEvent.change(urlInput, {
      target: {
        value:
          "https://app.familyassistant.top/finance/api/statistics?start_date=2026-05-31&end_date=2026-06-04",
      },
    });
    fireEvent.blur(urlInput);

    expect(screen.getByDisplayValue("https://app.familyassistant.top/finance/api/statistics")).toBeInTheDocument();
    expect(screen.getByDisplayValue("start_date")).toBeInTheDocument();
    expect(screen.getByDisplayValue("2026-05-31")).toBeInTheDocument();
    expect(screen.getByDisplayValue("end_date")).toBeInTheDocument();
    expect(screen.getByDisplayValue("2026-06-04")).toBeInTheDocument();
  });

  it("saves API test cases with multiple bound environments", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          code: 0,
          message: "ok",
          data: [
            {
              id: 1,
              name: "multi env case",
              method: "GET",
              path: "/health",
              group: "UAT",
              environment_ids: [1],
              creator_name: "QA",
              status: "enabled",
            },
          ],
        }),
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
          data: { id: 1, name: "multi env case", method: "GET", path: "/health", environment_ids: [1, 2] },
        }),
      } as Response);

    render(
      <ApiPage
        environmentError=""
        environmentId={1}
        environmentLoading={false}
        environments={[
          { id: 1, name: "UAT", baseUrl: "https://api.test", description: "", isDefault: true },
          { id: 2, name: "TEST", baseUrl: "https://test.api", description: "", isDefault: false },
        ]}
        onAction={vi.fn()}
        projectId={1}
      />,
    );

    fireEvent.click(await screen.findByText("multi env case"));
    const dialog = screen.getByRole("dialog");
    const environmentPicker = dialog.querySelector(".case-environment-picker");
    expect(environmentPicker).toBeInTheDocument();
    const testEnvironmentButton = within(environmentPicker as HTMLElement).getByText("TEST").closest("button");
    expect(testEnvironmentButton).toBeInTheDocument();
    fireEvent.click(testEnvironmentButton as HTMLButtonElement);
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      const [, init] = fetchMock.mock.calls[2];
      expect(JSON.parse(String((init as RequestInit).body))).toEqual(
        expect.objectContaining({
          environment_id: 1,
          environment_ids: [1, 2],
          name: "multi env case",
        }),
      );
    });
  });

  it("updates the latest execution status after running a saved API case", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          code: 0,
          message: "ok",
          data: [
            {
              id: 1,
              name: "run me",
              method: "GET",
              path: "/health",
              group: "UAT",
              environment_id: 1,
              creator_name: "QA",
              status: "enabled",
              last_execution_status: "failed",
            },
          ],
        }),
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
          data: { status: "passed", duration_ms: 128 },
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ code: 0, message: "ok", data: null }),
      } as Response);

    render(
      <ApiPage
        environmentError=""
        environmentId={1}
        environmentLoading={false}
        environments={[{ id: 1, name: "UAT", baseUrl: "https://api.test", description: "", isDefault: true }]}
        onAction={vi.fn()}
        projectId={1}
      />,
    );

    expect(await screen.findByText("run me")).toBeInTheDocument();
    expect(screen.getByText("失败")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /运行/ }));
    await waitFor(() => expect(screen.getByText("通过")).toBeInTheDocument());
    expect(screen.queryByText("失败")).not.toBeInTheDocument();
    expect(screen.getByText("运行完成")).toBeInTheDocument();
    expect(screen.getByText(/run me 运行通过，耗时 128ms/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "运行" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    expect(screen.getByRole("dialog", { name: "确认删除该测试用例？" })).toBeInTheDocument();
    expect(screen.getByText(/即将删除“run me”/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(3);

    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith(
        "http://127.0.0.1:8000/api/v1/test-cases/1?project_id=1",
        expect.objectContaining({ method: "DELETE" }),
      ),
    );
    expect(screen.queryByText("run me")).not.toBeInTheDocument();
    expect(screen.getByText(/run me 已删除/)).toBeInTheDocument();
  });

  it("creates and debugs a WebSocket test case through the WebSocket APIs", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
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
          data: {
            status: "passed",
            duration_ms: 35,
            request_snapshot: { url: "wss://socket.example.com/events", message: "ping" },
            response_snapshot: { messages: ["pong"] },
            assertion_results: [{ passed: true }],
          },
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          code: 0,
          message: "ok",
          data: {
            id: 7,
            protocol: "websocket",
            name: "新建 WebSocket 测试用例",
            websocket_url: "wss://socket.example.com/events",
            environment_id: 1,
          },
        }),
      } as Response);

    render(
      <ApiPage
        environmentError=""
        environmentId={1}
        environmentLoading={false}
        environments={[{ id: 1, name: "UAT", baseUrl: "https://api.test", description: "", isDefault: true }]}
        onAction={vi.fn()}
        projectId={1}
      />,
    );

    await screen.findByText("暂无接口测试用例");
    fireEvent.click(screen.getByRole("button", { name: /新建 WebSocket 用例/ }));
    fireEvent.change(screen.getByPlaceholderText(/WebSocket 地址/), { target: { value: "wss://socket.example.com/events" } });
    fireEvent.change(screen.getByPlaceholderText(/空数组表示仅测试连接/), {
      target: { value: JSON.stringify([{ type: "text", data: "ping" }]) },
    });
    fireEvent.click(screen.getByRole("button", { name: /调试/ }));

    expect(await screen.findByText(/^调试完成：/)).toBeInTheDocument();
    expect(fetchMock.mock.calls[2][0]).toContain("/websocket-test-cases/execute-unsaved?");
    expect(JSON.parse(String((fetchMock.mock.calls[2][1] as RequestInit).body))).toEqual(
      expect.objectContaining({
        path: "wss://socket.example.com/events",
        receive_count: 1,
        messages: [{ type: "text", data: "ping" }],
      }),
    );
    fireEvent.click(screen.getByRole("tab", { name: "断言结果" }));
    expect(screen.getByText("pass")).toBeInTheDocument();
    expect(screen.getByRole("tabpanel")).toHaveClass("pass");

    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(fetchMock.mock.calls[3][0]).toContain("/websocket-test-cases?"));
  });

  it("connects, exchanges messages, and disconnects a WebSocket test case manually", async () => {
    class MockWebSocket {
      static instances: MockWebSocket[] = [];
      readyState = 0;
      onopen: (() => void) | null = null;
      onmessage: ((event: { data: string }) => void) | null = null;
      onerror: (() => void) | null = null;
      onclose: ((event: { code: number; reason: string }) => void) | null = null;
      send = vi.fn();
      url: string;

      constructor(url: string) {
        this.url = url;
        MockWebSocket.instances.push(this);
      }

      open() {
        this.readyState = 1;
        this.onopen?.();
      }

      receive(message: string) {
        this.onmessage?.({ data: message });
      }

      close(_code?: number, reason = "") {
        this.readyState = 3;
        this.onclose?.({ code: 1000, reason });
      }
    }

    vi.stubGlobal("WebSocket", MockWebSocket);
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ code: 0, message: "ok", data: [] }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ code: 0, message: "ok", data: [] }),
      } as Response);

    render(
      <ApiPage
        environmentError=""
        environmentId={1}
        environmentLoading={false}
        environments={[{ id: 1, name: "UAT", baseUrl: "https://api.test", description: "", isDefault: true }]}
        onAction={vi.fn()}
        projectId={1}
      />,
    );

    await screen.findByText("暂无接口测试用例");
    fireEvent.click(screen.getByRole("button", { name: /新建 WebSocket 用例/ }));
    fireEvent.change(screen.getByPlaceholderText(/WebSocket 地址/), { target: { value: "/events" } });
    fireEvent.click(screen.getByRole("button", { name: "建立连接" }));

    expect(MockWebSocket.instances[0].url).toBe("wss://api.test/events");
    expect(screen.getByText("连接中")).toBeInTheDocument();

    act(() => MockWebSocket.instances[0].open());
    expect(screen.getByText("已连接")).toBeInTheDocument();
    act(() => MockWebSocket.instances[0].receive("server-pong"));
    expect(screen.getByText("server-pong")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("手动发送消息"), { target: { value: "client-ping" } });
    fireEvent.click(screen.getByRole("button", { name: "发送消息" }));
    expect(MockWebSocket.instances[0].send).toHaveBeenCalledWith("client-ping");

    fireEvent.click(screen.getByRole("button", { name: "断开连接" }));
    expect(screen.getByText("未连接")).toBeInTheDocument();
  });

  it("loads and runs saved WebSocket test cases through the independent APIs", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ code: 0, message: "ok", data: [] }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          code: 0,
          message: "ok",
          data: [
            {
              id: 8,
              name: "实时通知",
              path: "wss://socket.example.com/events",
              environment_id: 1,
              last_execution_status: "failed",
            },
          ],
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ code: 0, message: "ok", data: { status: "passed" } }),
      } as Response)
      ;

    render(
      <ApiPage
        environmentError=""
        environmentId={1}
        environmentLoading={false}
        environments={[{ id: 1, name: "UAT", baseUrl: "https://api.test", description: "", isDefault: true }]}
        onAction={vi.fn()}
        projectId={1}
      />,
    );

    expect(await screen.findByText("实时通知")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /运行/ }));
    await waitFor(() => expect(fetchMock.mock.calls[2][0]).toContain("/websocket-test-cases/8/execute?"));
    expect(screen.queryByRole("button", { name: /AI扩展/ })).not.toBeInTheDocument();
  });

  it("collapses the sidebar labels while keeping navigation available", () => {
    window.history.pushState(null, "", "/dashboard#/");
    render(<App />);

    expect(screen.getByRole("button", { name: /测试计划/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "收起菜单" }));

    expect(screen.queryByText("测试计划")).not.toBeInTheDocument();
    expect(screen.getByTitle("测试计划")).toBeInTheDocument();
  });
});
