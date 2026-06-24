import { createAiSkillRun, getAiSkillRun, subscribeAiSkillRunEvents } from "./aiSkillRuns";

function jsonResponse(data: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ code: 0, message: "ok", data }),
  } as Response;
}

function streamResponse(chunks: string[]) {
  const encoder = new TextEncoder();
  return {
    ok: true,
    status: 200,
    body: new ReadableStream({
      start(controller) {
        chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
        controller.close();
      },
    }),
    json: async () => null,
  } as Response;
}

describe("AI skill runs API", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("creates an observable AI skill run", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({
      run_id: "ai-run-1",
      skill_id: "scenario-composer",
      operation: "compose",
      status: "queued",
    }));

    const result = await createAiSkillRun("scenario-composer", {
      operation: "compose",
      project_id: 7,
      environment_id: 1,
      input: { requirement: "登录后查询用户" },
    });

    expect(String(fetchMock.mock.calls[0][0])).toContain("/ai/skills/scenario-composer/runs");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      operation: "compose",
      project_id: 7,
      environment_id: 1,
      input: { requirement: "登录后查询用户" },
    });
    expect(result).toEqual({
      runId: "ai-run-1",
      skillId: "scenario-composer",
      operation: "compose",
      status: "queued",
    });
  });

  it("subscribes to authenticated AI run SSE events", async () => {
    localStorage.setItem("access_token", "token");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(streamResponse([
      'id: 1\nevent: run.started\ndata: {}\n\n',
      'id: 2\nevent: model.delta\ndata: {"content":"hello"}\n\n',
      'id: 3\nevent: run.completed\ndata: {"result":{"ok":true}}\n\n',
    ]));
    const events: string[] = [];

    await subscribeAiSkillRunEvents("ai-run-1", (event) => events.push(`${event.sequence}:${event.event}`), { lastEventId: 1 });

    expect(events).toEqual(["1:run.started", "2:model.delta", "3:run.completed"]);
    const [, init] = fetchMock.mock.calls[0];
    expect(String(fetchMock.mock.calls[0][0])).toBe("http://127.0.0.1:8000/api/v1/ai/skill-runs/ai-run-1/events");
    expect((init?.headers as Headers).get("Authorization")).toBe("Bearer token");
    expect((init?.headers as Headers).get("Accept")).toBe("text/event-stream");
    expect((init?.headers as Headers).get("Last-Event-ID")).toBe("1");
  });

  it("normalizes SSE payloads that carry the event name in data", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(streamResponse([
      'id: 4\ndata: {"event":"tool.started","payload":{"name":"validate_unsaved_scenario"}}\n\n',
      'id: 5\ndata: {"type":"model.delta","payload":{"content":"with tool output"}}\n\n',
    ]));
    const events: string[] = [];

    await subscribeAiSkillRunEvents("ai-run-1", (event) => events.push(`${event.sequence}:${event.event}:${event.payload.name ?? event.payload.content}`));

    expect(events).toEqual([
      "4:tool.started:validate_unsaved_scenario",
      "5:model.delta:with tool output",
    ]);
  });

  it("maps a completed AI skill run snapshot", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({
      run_id: "ai-run-1",
      skill_id: "scenario-composer",
      operation: "compose",
      project_id: 7,
      status: "completed",
      events: [{ sequence: 1, event: "run.completed", payload: { result: { ok: true } }, created_at: "2026-06-22T00:00:00Z" }],
      result: { ok: true },
      created_at: "2026-06-22T00:00:00Z",
      updated_at: "2026-06-22T00:00:01Z",
    }));

    const snapshot = await getAiSkillRun("ai-run-1");

    expect(snapshot.status).toBe("completed");
    expect(snapshot.events[0]).toEqual(expect.objectContaining({
      sequence: 1,
      event: "run.completed",
      payload: { result: { ok: true } },
    }));
  });
});
