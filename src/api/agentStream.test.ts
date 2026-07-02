import { getAgentRunEventSnapshot, isAgentHeartbeatSseChunk, parseAgentSseChunk, subscribeAgentRunEvents } from "./agentStream";

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

describe("Agent SSE stream", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("parses standard SSE chunks and ignores heartbeat", () => {
    expect(parseAgentSseChunk(": keepalive\n\n")).toBeUndefined();
    expect(parseAgentSseChunk("event: heartbeat\ndata: {}\n\n")).toBeUndefined();
    expect(isAgentHeartbeatSseChunk(": keepalive\n\n")).toBe(true);
    expect(isAgentHeartbeatSseChunk("event: heartbeat\ndata: {}\n\n")).toBe(true);

    const event = parseAgentSseChunk('id: 3\nevent: run.completed\ndata: {"status":"completed"}\n\n');

    expect(event).toEqual({
      id: "3",
      sequence: 3,
      event: "run.completed",
      payload: { status: "completed" },
    });
  });

  it("parses EventStore replay data payloads", () => {
    const event = parseAgentSseChunk('id: 4\ndata: {"item_id":"agent-event://run-1/4","schema_version":"agent_event_v1","event_type":"tool.completed","event_seq":4,"run_id":"run-1","project_id":7,"occurred_at":"2026-07-02T00:00:00Z","payload_json":{"tool_call_id":"tool-1","model_response_item_id":"agent-model-response://run-1/call-1"},"model_response_item_id":"agent-model-response://run-1/call-1"}\n\n');

    expect(event).toEqual({
      id: "4",
      itemId: "agent-event://run-1/4",
      schemaVersion: "agent_event_v1",
      sequence: 4,
      runId: "run-1",
      projectId: 7,
      event: "tool.completed",
      payload: { tool_call_id: "tool-1", model_response_item_id: "agent-model-response://run-1/call-1" },
      modelResponseItemId: "agent-model-response://run-1/call-1",
      occurredAt: "2026-07-02T00:00:00Z",
      createdAt: undefined,
    });
  });

  it("streams split chunks with Last-Event-ID", async () => {
    localStorage.setItem("access_token", "token");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(streamResponse([
      'id: 5\nevent: model.delta\ndata: {"content":"hel',
      'lo"}\n\nid: 6\nevent: run.completed\ndata: {"status":"completed"}\n\n',
    ]));
    const events: string[] = [];

    const result = await subscribeAgentRunEvents("run-1", (event) => events.push(`${event.sequence}:${event.event}`), { lastEventId: 4 });

    expect(events).toEqual(["5:model.delta", "6:run.completed"]);
    expect(result).toEqual({ eventCount: 2, heartbeatCount: 0 });
    const [, init] = fetchMock.mock.calls[0];
    expect((init?.headers as Headers).get("Last-Event-ID")).toBe("4");
    expect((init?.headers as Headers).get("Accept")).toBe("text/event-stream");
  });

  it("reports heartbeat-only streams and maps snapshot backfill", async () => {
    localStorage.setItem("access_token", "token");
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(streamResponse([": keepalive\n\n", "event: heartbeat\ndata: {}\n\n"]))
      .mockResolvedValueOnce(jsonResponse({
        run: { item_id: "agent-run://run-heartbeat", run_id: "run-heartbeat", project_id: 7, status: "running" },
        events: [{ event_seq: 7, event_type: "model.delta", payload_json: { content: "backfill" } }],
        context_compactions: [{
          item_id: "agent-context-compaction://run-heartbeat/6",
          run_id: "run-heartbeat",
          event_seq: 6,
          event_type: "context.history_compacted",
          payload_json: { strategy: "summarize_older_keep_recent" },
          created_at: "2026-07-02T00:00:00Z",
        }],
        after_sequence: 6,
        event_count: 1,
        latest_event_sequence: 7,
        next_after_sequence: 7,
        terminal: false,
        generated_at: "2026-07-02T00:00:01Z",
      }));

    const events: string[] = [];
    const streamResult = await subscribeAgentRunEvents("run-heartbeat", (event) => events.push(event.event), { lastEventId: 6 });
    const snapshot = await getAgentRunEventSnapshot("run-heartbeat", 6);

    expect(streamResult).toEqual({ eventCount: 0, heartbeatCount: 2 });
    expect(events).toEqual([]);
    expect(snapshot.events[0]).toEqual(expect.objectContaining({
      sequence: 7,
      event: "model.delta",
      payload: { content: "backfill" },
    }));
    expect(snapshot.nextAfterSequence).toBe(7);
    expect(snapshot.contextCompactions[0]).toEqual(expect.objectContaining({
      itemId: "agent-context-compaction://run-heartbeat/6",
      runId: "run-heartbeat",
      sequence: 6,
    }));
    expect(snapshot.run?.itemId).toBe("agent-run://run-heartbeat");
    expect(String(fetchMock.mock.calls[1][0])).toContain("/agents/runs/run-heartbeat/events/snapshot?after_sequence=6");
  });
});

function jsonResponse(data: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ code: 0, message: "ok", data }),
  } as Response;
}
