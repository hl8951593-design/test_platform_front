import { expandAiTestCase, generateAiTestCases } from "./apiCases";

function jsonResponse(data: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ code: 0, message: "ok", data }),
  } as Response;
}

function errorResponse(status: number, detail: string) {
  return {
    ok: false,
    status,
    json: async () => ({ detail }),
  } as Response;
}

describe("api cases AI skill API", () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("generates HTTP test cases through the skill runner", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({
      project_id: 1,
      environment_id: 2,
      environment_ids: [2],
      cases: [],
      warnings: [],
    }));

    await expect(generateAiTestCases(1, 2, {
      interface_text: "POST /login",
      generate_count: 3,
      include_assertions: true,
    })).resolves.toEqual({
      project_id: 1,
      environment_id: 2,
      environment_ids: [2],
      cases: [],
      warnings: [],
    });

    expect(String(fetchMock.mock.calls[0][0])).toContain("/ai/skills/http-test-case/run");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      operation: "generate",
      project_id: 1,
      environment_id: 2,
      input: {
        interface_text: "POST /login",
        generate_count: 3,
        include_assertions: true,
      },
    });
  });

  it("expands a saved HTTP test case through the skill runner", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({
      project_id: 1,
      environment_id: 2,
      environment_ids: [2],
      source_summary: "扩写登录异常场景",
      cases: [],
      warnings: [],
    }));

    await expandAiTestCase(1, "10", {
      requirement: "扩写空用户名和密码错误",
      generate_count: 2,
      expansion_types: ["empty_value"],
      include_assertions: true,
    }, 2);

    expect(String(fetchMock.mock.calls[0][0])).toContain("/ai/skills/http-test-case/run");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      operation: "expand",
      project_id: 1,
      environment_id: 2,
      source_id: 10,
      input: {
        requirement: "扩写空用户名和密码错误",
        generate_count: 2,
        expansion_types: ["empty_value"],
        include_assertions: true,
      },
    });
  });

  it("falls back to the legacy generation endpoint when the skill route is unavailable", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(errorResponse(404, "Not Found"))
      .mockResolvedValueOnce(jsonResponse({
        project_id: 1,
        environment_id: 2,
        environment_ids: [2],
        cases: [],
      }));

    await generateAiTestCases(1, 2, {
      interface_text: "GET /users",
    });

    expect(String(fetchMock.mock.calls[0][0])).toContain("/ai/skills/http-test-case/run");
    expect(String(fetchMock.mock.calls[1][0])).toContain("/ai/test-cases/generate?project_id=1&environment_id=2");
  });

  it("falls back to the legacy expansion endpoint when the skill route is unavailable", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(errorResponse(404, "Not Found"))
      .mockResolvedValueOnce(jsonResponse({
        project_id: 1,
        environment_id: 2,
        environment_ids: [2],
        cases: [],
      }));

    await expandAiTestCase(1, 10, {
      requirement: "扩写字段类型错误",
    });

    expect(String(fetchMock.mock.calls[0][0])).toContain("/ai/skills/http-test-case/run");
    expect(String(fetchMock.mock.calls[1][0])).toContain("/ai/test-cases/10/expand?project_id=1");
  });
});
