import {
  deleteScenarioRun,
  getScenarioRun,
  listScenarios,
  runScenario,
  saveScenario,
  subscribeScenarioRunEvents,
  type ScenarioRunEvent,
  type TestScenario,
} from "./scenarios";

function jsonResponse(data: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ code: 0, message: "ok", data }),
  } as Response;
}

describe("scenarios API", () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("maps snake_case steps and datasets into editor JSON", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({
      items: [{
        id: 11,
        project_id: 1,
        version: 3,
        name: "登录下单",
        environment_id: 2,
        nodes: [{
          id: "NODE-1",
          name: "登录",
          before_actions: [],
          test_case: { id: "STEP-1", kind: "api_case", reference_id: 9, name: "登录", method: "POST", path: "/login", config: { extract: "token" }, continue_on_failure: false },
          after_actions: [],
        }],
        datasets: [{
          id: "DATA-1",
          name: "普通用户",
          enabled: true,
          variables: { username: "tester" },
          request_overrides: [{
            step_id: "STEP-1",
            target: "body",
            path: "account.profile.name",
            value: "tester",
          }],
        }],
      }],
    }));

    const scenarios = await listScenarios(1);
    expect(scenarios[0]).toEqual(expect.objectContaining({
      id: "11",
      version: 3,
      environmentId: 2,
      steps: [expect.objectContaining({
        referenceId: 9,
        configText: '{\n  "extract": "token"\n}',
        nodeId: "NODE-1",
        actionPosition: "main",
      })],
      datasets: [expect.objectContaining({
        variablesText: '{\n  "username": "tester"\n}',
        records: [{
          id: "DATA-1-RECORD-1",
          name: "测试记录 1",
          enabled: true,
          requestOverrides: [{
            stepId: "STEP-1",
            target: "body",
            path: "account.profile.name",
            value: "tester",
          }],
        }],
      })],
    }));
  });

  it("parses editor JSON and submits the current version", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({
      id: 11,
      project_id: 1,
      version: 4,
      name: "登录下单",
      environment_id: 2,
      nodes: [],
      datasets: [],
    }));

    await saveScenario(1, {
      id: "11",
      projectId: 1,
      version: 3,
      name: "登录下单",
      description: "",
      environmentId: 2,
      tags: [],
      steps: [{
        id: "STEP-1",
        nodeId: "NODE-1",
        actionPosition: "main",
        kind: "api_case",
        referenceId: 9,
        name: "登录",
        method: "POST",
        path: "/login",
        configText: '{"extract":"token"}',
        continueOnFailure: false,
      }],
      datasets: [{
        id: "DATA-1",
        name: "普通用户",
        enabled: true,
        variablesText: '{"username":"tester"}',
        records: [{
          id: "RECORD-1",
          name: "VIP 用户",
          enabled: true,
          requestOverrides: [{
            stepId: "STEP-1",
            target: "body",
            path: "account.profile.name",
            value: "vip-user",
          }],
        }, {
          id: "RECORD-2",
          name: "停用用户",
          enabled: false,
          requestOverrides: [{
            stepId: "STEP-1",
            target: "body",
            path: "account.profile.name",
            value: "disabled-user",
          }],
        }],
      }],
      createdAt: "",
      updatedAt: "",
    });

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(init?.body))).toEqual(expect.objectContaining({
      version: 3,
      environment_id: 2,
      nodes: [expect.objectContaining({
        id: "NODE-1",
        before_actions: [],
        test_case: expect.objectContaining({ reference_id: 9, config: { extract: "token" }, continue_on_failure: false }),
        after_actions: [],
      })],
      datasets: [expect.objectContaining({
        variables: { username: "tester" },
        records: [{
          id: "RECORD-1",
          name: "VIP 用户",
          enabled: true,
          request_overrides: [{
            step_id: "STEP-1",
            target: "body",
            path: "account.profile.name",
            value: "vip-user",
          }],
        }, {
          id: "RECORD-2",
          name: "停用用户",
          enabled: false,
          request_overrides: [{
            step_id: "STEP-1",
            target: "body",
            path: "account.profile.name",
            value: "disabled-user",
          }],
        }],
      })],
    }));
  });

  it("maps extracted variables and resolved bindings from a run detail", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({
      id: "RUN-1",
      scenario_id: "SCENARIO-1",
      dataset_id: "DATA-1",
      dataset_name: "默认数据",
      record_id: "RECORD-1",
      record_name: "正常客户",
      status: "passed",
      step_results: [{
        step_id: "STEP-2",
        name: "获取企业详情",
        status: "passed",
        kind: "api_case",
        execution_id: "EXEC-2",
        request_snapshot: {
          method: "GET",
          url: "https://api.example.com/company?companyId=9527",
          headers: { Authorization: "***" },
          query_params: { companyId: 9527 },
        },
        response_snapshot: {
          status_code: 200,
          headers: { "content-type": "application/json" },
          json: { data: { name: "OpenAI" } },
        },
        assertion_results: [{
          name: "状态码",
          passed: true,
          expected: 200,
          actual: 200,
        }],
        extracted_variables: [{
          extraction_id: "VAR-2",
          name: "companyName",
          path: "data.name",
          value: null,
          masked: false,
          error: "Extraction path not found",
        }],
        resolved_bindings: [{
          binding_id: "BIND-1",
          source_step_id: "STEP-1",
          source_extraction_id: "VAR-1",
          target: "query_params",
          target_path: "companyId",
          value: 9527,
          masked: false,
        }],
      }],
    }));

    const run = await getScenarioRun(1, "RUN-1");

    expect(run).toEqual(expect.objectContaining({
      datasetId: "DATA-1",
      datasetName: "默认数据",
      recordId: "RECORD-1",
      recordName: "正常客户",
    }));
    expect(run.stepResults[0]).toEqual(expect.objectContaining({
      executionId: "EXEC-2",
      request: expect.objectContaining({
        method: "GET",
        queryParams: { companyId: 9527 },
      }),
      response: expect.objectContaining({
        statusCode: 200,
        body: { data: { name: "OpenAI" } },
      }),
      assertions: [expect.objectContaining({ name: "状态码", status: "passed" })],
      extractedVariables: [expect.objectContaining({
        extractionId: "VAR-2",
        value: null,
        error: "Extraction path not found",
      })],
      resolvedBindings: [expect.objectContaining({ bindingId: "BIND-1", value: 9527 })],
    }));
    expect(run.detailLoaded).toBe(true);
  });

  it("deletes a scenario run in the selected project", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(null));

    await deleteScenarioRun(7, "RUN-1");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8000/api/v1/scenario-runs/RUN-1?project_id=7",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("starts an asynchronous run and consumes authenticated SSE progress events", async () => {
    const scenario: TestScenario = {
      id: "SCENARIO-1",
      projectId: 7,
      version: 9,
      name: "Checkout",
      description: "",
      environmentId: 1,
      tags: [],
      steps: [],
      datasets: [],
      createdAt: "",
      updatedAt: "",
    };
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({
        execution_id: "SCENARIO-EXEC-1",
        scenario_id: scenario.id,
        scenario_version: 9,
        status: "queued",
        created_at: "2026-06-12T08:00:00.000Z",
        runs: [{
          run_id: "RUN-1",
          dataset_id: "DATA-1",
          dataset_name: "Default",
          record_id: "RECORD-1",
          record_name: "Valid customer",
          status: "queued",
          events_url: "/api/v1/scenario-runs/RUN-1/events?project_id=7",
          detail_url: "/api/v1/scenario-runs/RUN-1?project_id=7",
        }],
      }))
      .mockResolvedValueOnce(new Response([
        "id: 1",
        "event: step_started",
        'data: {"schema_version":1,"sequence":1,"event":"step_started","run_id":"RUN-1","scenario_id":"SCENARIO-1","dataset_id":"DATA-1","record_id":"RECORD-1","record_name":"Valid customer","step_id":"STEP-1","step_index":0,"status":"running"}',
        "",
        "id: 2",
        "event: transition_started",
        'data: {"schema_version":1,"sequence":2,"event":"transition_started","run_id":"RUN-1","scenario_id":"SCENARIO-1","source_step_index":0,"target_step_index":1}',
        "",
        "id: 3",
        "event: run_completed",
        'data: {"schema_version":1,"sequence":3,"event":"run_completed","run_id":"RUN-1","scenario_id":"SCENARIO-1","status":"passed"}',
        "",
        "",
      ].join("\n"), {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }));
    localStorage.setItem("access_token", "test-token");

    const launch = await runScenario(7, scenario, { idempotencyKey: "RUN-KEY" });
    const events: ScenarioRunEvent[] = [];
    await subscribeScenarioRunEvents(7, launch.runs[0], (event) => events.push(event), {
      lastEventId: 0,
    });

    expect(launch).toEqual(expect.objectContaining({
      executionId: "SCENARIO-EXEC-1",
      scenarioVersion: 9,
      runs: [expect.objectContaining({
        runId: "RUN-1",
        datasetId: "DATA-1",
        recordId: "RECORD-1",
        recordName: "Valid customer",
      })],
    }));
    expect(events.map((event) => `${event.event}:${event.stepIndex ?? event.targetStepIndex}`))
      .toEqual(["step_started:0", "transition_started:1", "run_completed:undefined"]);
    expect(events[0]).toEqual(expect.objectContaining({
      datasetId: "DATA-1",
      recordId: "RECORD-1",
      recordName: "Valid customer",
    }));
    const [streamUrl, streamInit] = fetchMock.mock.calls[1];
    expect(String(streamUrl)).toBe("http://127.0.0.1:8000/api/v1/scenario-runs/RUN-1/events?project_id=7");
    const headers = new Headers(streamInit?.headers);
    expect(headers.get("Authorization")).toBe("Bearer test-token");
    expect(headers.get("Accept")).toBe("text/event-stream");
    expect(headers.get("Last-Event-ID")).toBe("0");
  });

  it("reconnects from the last event, deduplicates replay, and reports sequence gaps", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response([
        "id: 1",
        "event: step_started",
        'data: {"sequence":1,"event":"step_started","run_id":"RUN-2","step_index":0}',
        "",
        "",
      ].join("\n"), { status: 200 }))
      .mockResolvedValueOnce(new Response([
        "id: 1",
        "event: step_started",
        'data: {"sequence":1,"event":"step_started","run_id":"RUN-2","step_index":0}',
        "",
        "id: 3",
        "event: step_completed",
        'data: {"sequence":3,"event":"step_completed","run_id":"RUN-2","step_index":0,"status":"passed"}',
        "",
        "id: 4",
        "event: run_completed",
        'data: {"sequence":4,"event":"run_completed","run_id":"RUN-2","status":"passed"}',
        "",
        "",
      ].join("\n"), { status: 200 }));
    localStorage.setItem("access_token", "test-token");
    const events: number[] = [];
    const reconnects: Array<[number, number]> = [];
    const gaps: Array<[number, number]> = [];

    await subscribeScenarioRunEvents(
      7,
      {
        runId: "RUN-2",
        datasetName: "Default",
        status: "queued",
        eventsUrl: "/api/v1/scenario-runs/RUN-2/events?project_id=7",
        detailUrl: "/api/v1/scenario-runs/RUN-2?project_id=7",
      },
      (event) => events.push(event.sequence),
      {
        reconnectDelayMs: 0,
        onReconnect: (attempt, lastEventId) => reconnects.push([attempt, lastEventId]),
        onSequenceGap: (expected, received) => {
          gaps.push([expected, received]);
        },
      },
    );

    expect(events).toEqual([1, 3, 4]);
    expect(reconnects).toEqual([[1, 1]]);
    expect(gaps).toEqual([[2, 3]]);
    const reconnectHeaders = new Headers(fetchMock.mock.calls[1][1]?.headers);
    expect(reconnectHeaders.get("Last-Event-ID")).toBe("1");
  });

  it("reports expired event history without repeatedly reconnecting", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(
      JSON.stringify({
        code: 409,
        message: "事件历史已过期",
        data: {
          code: "EVENT_HISTORY_EXPIRED",
          detail_url: "/api/v1/scenario-runs/RUN-3?project_id=7",
        },
      }),
      { status: 409, headers: { "Content-Type": "application/json" } },
    ));
    const expired = vi.fn();

    await subscribeScenarioRunEvents(
      7,
      {
        runId: "RUN-3",
        datasetName: "Default",
        status: "running",
        eventsUrl: "/api/v1/scenario-runs/RUN-3/events?project_id=7",
        detailUrl: "/api/v1/scenario-runs/RUN-3?project_id=7",
      },
      vi.fn(),
      { onHistoryExpired: expired, reconnectDelayMs: 0 },
    );

    expect(expired).toHaveBeenCalledWith(expect.objectContaining({
      code: "EVENT_HISTORY_EXPIRED",
      detailUrl: "/api/v1/scenario-runs/RUN-3?project_id=7",
      status: 409,
    }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
