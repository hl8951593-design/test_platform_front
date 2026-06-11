import { listScenarios, saveScenario } from "./scenarios";

function jsonResponse(data: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ code: 0, message: "ok", data }),
  } as Response;
}

describe("scenarios API", () => {
  afterEach(() => vi.restoreAllMocks());

  it("maps snake_case steps and datasets into editor JSON", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({
      items: [{
        id: 11,
        project_id: 1,
        version: 3,
        name: "登录下单",
        environment_id: 2,
        steps: [{
          id: "STEP-1",
          kind: "api_case",
          reference_id: 9,
          name: "登录",
          method: "POST",
          path: "/login",
          config: { extract: "token" },
          continue_on_failure: false,
        }],
        datasets: [{
          id: "DATA-1",
          name: "普通用户",
          enabled: true,
          variables: { username: "tester" },
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
      })],
      datasets: [expect.objectContaining({
        variablesText: '{\n  "username": "tester"\n}',
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
      steps: [],
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
      }],
      createdAt: "",
      updatedAt: "",
    });

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(init?.body))).toEqual(expect.objectContaining({
      version: 3,
      environment_id: 2,
      steps: [expect.objectContaining({
        reference_id: 9,
        config: { extract: "token" },
        continue_on_failure: false,
      })],
      datasets: [expect.objectContaining({
        variables: { username: "tester" },
      })],
    }));
  });
});
