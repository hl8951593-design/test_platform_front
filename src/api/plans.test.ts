import { listPlans, savePlan } from "./plans";

function jsonResponse(data: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ code: 0, message: "ok", data }),
  } as Response;
}

describe("plans API", () => {
  afterEach(() => vi.restoreAllMocks());

  it("maps paginated snake_case plan responses", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({
      items: [{
        id: 8,
        project_id: 1,
        version: 4,
        name: "夜间回归",
        enabled: true,
        trigger_type: "cron",
        cron_expression: "0 2 * * *",
        schedule_timezone: "Asia/Shanghai",
        environment_ids: [2],
        targets: [{
          reference_id: 11,
          kind: "scenario",
          sort_order: 1,
          scenario_version: 3,
          scenario_name: "登录下单",
        }],
        execution_mode: "serial",
        failure_policy: "stop",
        retry_count: 1,
        timeout_minutes: 30,
        notification_emails: ["qa@example.com"],
        tags: ["regression"],
      }],
      total: 1,
      page: 1,
      page_size: 200,
    }));

    const plans = await listPlans(1);
    expect(plans[0]).toEqual(expect.objectContaining({
      id: "8",
      version: 4,
      triggerType: "cron",
      environmentIds: [2],
      targets: [expect.objectContaining({
        referenceId: 11,
        kind: "scenario",
        name: "登录下单",
        scenarioVersion: 3,
      })],
    }));
  });

  it("submits optimistic-lock version and bound scenario version", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({
      id: 8,
      project_id: 1,
      version: 5,
      name: "夜间回归",
      environment_ids: [2],
      targets: [],
    }));

    await savePlan(1, {
      id: "8",
      version: 4,
      name: "夜间回归",
      description: "",
      enabled: true,
      triggerType: "cron",
      cronExpression: "0 2 * * *",
      scheduleTimezone: "Asia/Shanghai",
      webhookEvent: "",
      environmentIds: [2],
      targets: [{
        id: "scenario-11",
        referenceId: 11,
        kind: "scenario",
        name: "登录下单",
        scenarioVersion: 3,
      }],
      executionMode: "serial",
      failurePolicy: "stop",
      retryCount: 1,
      timeoutMinutes: 30,
      notificationEmails: [],
      tags: [],
      lastRunAt: undefined,
      nextRunAt: undefined,
    });

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(init?.body))).toEqual(expect.objectContaining({
      version: 4,
      trigger_type: "cron",
      environment_ids: [2],
      targets: [{
        reference_id: 11,
        kind: "scenario",
        sort_order: 1,
        scenario_version: 3,
      }],
    }));
  });
});
