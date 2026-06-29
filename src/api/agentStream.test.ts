import { parseAgentSseChunk, subscribeAgentRunEvents } from "./agentStream";

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

    const event = parseAgentSseChunk('id: 3\nevent: run.completed\ndata: {"status":"completed"}\n\n');

    expect(event).toEqual({
      id: "3",
      sequence: 3,
      event: "run.completed",
      payload: { status: "completed" },
    });
  });

  it("parses EventStore replay data payloads", () => {
    const event = parseAgentSseChunk('id: 4\ndata: {"event_type":"tool.completed","event_seq":4,"run_id":"run-1","payload_json":{"tool_call_id":"tool-1"}}\n\n');

    expect(event).toEqual({
      id: "4",
      sequence: 4,
      runId: "run-1",
      event: "tool.completed",
      payload: { tool_call_id: "tool-1" },
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

    await subscribeAgentRunEvents("run-1", (event) => events.push(`${event.sequence}:${event.event}`), { lastEventId: 4 });

    expect(events).toEqual(["5:model.delta", "6:run.completed"]);
    const [, init] = fetchMock.mock.calls[0];
    expect((init?.headers as Headers).get("Last-Event-ID")).toBe("4");
    expect((init?.headers as Headers).get("Accept")).toBe("text/event-stream");
  });
});
