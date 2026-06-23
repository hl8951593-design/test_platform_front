import { executeUnsavedScenarioScript, extractScenarioDebugValue, normalizeScenarioScriptDebug, normalizeScenarioStepDebug, suggestedVariableName } from "./scenarioStepDebug";

describe("scenario step debug response", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("normalizes an HTTP JSON response for field picking", () => {
    expect(normalizeScenarioStepDebug({
      status: "passed",
      duration_ms: 42,
      response_snapshot: {
        status_code: 200,
        json: { data: { company_id: 7 } },
      },
    }, "api_case")).toEqual({
      durationMs: 42,
      errorMessage: "",
      sources: [{ value: { data: { company_id: 7 } } }],
      status: "passed",
      statusCode: 200,
    });
  });

  it("normalizes websocket messages with their indexes", () => {
    const result = normalizeScenarioStepDebug({
      status: "passed",
      response_snapshot: {
        received_messages: [
          { json: { event: "ready" } },
          { data: "{\"connection_id\":\"abc\"}" },
        ],
      },
    }, "websocket_case");

    expect(result.sources).toEqual([
      { messageIndex: 0, value: { event: "ready" } },
      { messageIndex: 1, value: { connection_id: "abc" } },
    ]);
  });

  it("normalizes script outputs for the shared response viewer", () => {
    expect(normalizeScenarioScriptDebug({
      status: "passed",
      duration_ms: 18,
      outputs: {
        result: { ok: true, companyId: 9527 },
      },
    })).toEqual({
      durationMs: 18,
      errorMessage: "",
      sources: [{ value: { result: { ok: true, companyId: 9527 } } }],
      status: "passed",
    });
  });

  it("falls back to the legacy script debug route when the scenario namespace route is missing", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ detail: "Not Found" }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { status: "passed", outputs: { result: true } } }),
      } as Response);

    await expect(executeUnsavedScenarioScript(7, {
      code: "result = True",
      input_values: {},
      inputs: [],
      language: "python",
      outputs: ["result"],
      timeout_ms: 10000,
    })).resolves.toEqual({ status: "passed", outputs: { result: true } });

    expect(String(fetchMock.mock.calls[0][0])).toContain("/scenarios/actions/script/execute-unsaved?project_id=7");
    expect(String(fetchMock.mock.calls[1][0])).toContain("/scenario-actions/script/execute-unsaved?project_id=7");
  });

  it("suggests a variable name from a response path", () => {
    expect(suggestedVariableName("data.items.0.company_id")).toBe("company_id");
  });

  it("extracts the latest configured path without converting its JSON type", () => {
    const result = normalizeScenarioStepDebug({
      status: "passed",
      response_snapshot: {
        json: {
          data: {
            items: [{ company_id: 9527, active: true, optional: null }],
          },
        },
      },
    }, "api_case");

    expect(extractScenarioDebugValue(result, "data.items.0.company_id")).toEqual({
      found: true,
      value: 9527,
    });
    expect(extractScenarioDebugValue(result, "data.items.0.active")).toEqual({
      found: true,
      value: true,
    });
    expect(extractScenarioDebugValue(result, "data.items.0.optional")).toEqual({
      found: true,
      value: null,
    });
    expect(extractScenarioDebugValue(result, "data.items.1.company_id")).toEqual({
      found: false,
      value: undefined,
      error: "响应路径不存在：data.items.1.company_id",
    });
  });
});
