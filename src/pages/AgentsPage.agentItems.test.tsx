import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AgentsPage } from "./AgentsPage";

function jsonResponse(data: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ code: 0, message: "ok", data }),
  } as Response;
}

function emptyStreamResponse() {
  return {
    ok: true,
    status: 200,
    body: new ReadableStream({
      start(controller) {
        controller.close();
      },
    }),
    json: async () => null,
  } as Response;
}

function mockCommonAgentEndpoints(url: string) {
  if (url.includes("/agents/dashboard")) return jsonResponse({ readiness: "pass", checks: [] });
  if (url.includes("/agents/metrics")) return jsonResponse({});
  if (url.includes("/agents/alerts")) return jsonResponse({ items: [] });
  if (url.includes("/agents/release-gates/promotion")) return jsonResponse({ gate_id: "promotion", status: "pass" });
  if (url.includes("/agents/release-gates")) return jsonResponse({ items: [] });
  return undefined;
}

describe("AgentsPage backend item identity contract", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("uses action resource item ids to focus the target ToolCall", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      const common = mockCommonAgentEndpoints(url);
      if (common) return common;
      if (url.endsWith("/agents/runs") && init?.method === "POST") {
        return jsonResponse({ item_id: "agent-run://run-action", run_id: "run-action", conversation_id: "agent-conv-action", status: "queued" });
      }
      if (url.includes("/agents/runs/run-action/events")) return emptyStreamResponse();
      if (url.includes("/agents/runs/run-action/actions")) {
        return jsonResponse({
          actions: [{
            action_id: "review_approvals",
            label: "Review approvals",
            enabled: true,
            resource_ids: ["approval-1"],
            resource_item_ids: ["agent-tool-call://run-action/tool-1"],
          }],
          primary_action_ids: ["review_approvals"],
          blocked_reasons: [],
        });
      }
      if (url.includes("/agents/runs/run-action/runbook")) return jsonResponse({ run_id: "run-action", safe_actions: [] });
      if (url.includes("/agents/memory-usage-events")) return jsonResponse({ items: [] });
      if (url.includes("/agents/runs/run-action")) {
        return jsonResponse({
          item_id: "agent-run://run-action",
          run_id: "run-action",
          project_id: 7,
          conversation_id: "agent-conv-action",
          intent: "approval action",
          status: "needs_human",
          current_iteration: 1,
          current_step_index: 0,
          max_iterations: 3,
          migration_block_count: 0,
          events: [],
          tool_calls: [{
            item_id: "agent-tool-call://run-action/tool-1",
            tool_call_id: "tool-1",
            tool_name: "scenario.compose",
            status: "uncertain",
            effect_submission_state: "unknown",
          }],
          approvals: [{
            item_id: "agent-approval://run-action/approval-1",
            tool_call_item_id: "agent-tool-call://run-action/tool-1",
            approval_id: "approval-1",
            tool_call_id: "tool-1",
            status: "pending",
          }],
          migration_blocks: [],
          context_builds: [],
          loop_observations: [],
        });
      }
      return jsonResponse({});
    });

    const { container } = render(<AgentsPage projectId={7} />);
    const composer = container.querySelector("textarea") as HTMLTextAreaElement;
    fireEvent.change(composer, { target: { value: "approval action" } });
    fireEvent.keyDown(composer, { key: "Enter", code: "Enter" });

    fireEvent.click(await screen.findByRole("button", { name: "Review approvals" }));

    await waitFor(() => {
      const inspector = container.querySelector(".agent-inspector");
      expect(inspector).toHaveTextContent("Tool Detail");
      expect(inspector).toHaveTextContent("scenario.compose");
    });
  });

  it("downloads conversation export from the backend when a conversation id exists", async () => {
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn() });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    const createObjectUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:agent-export");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      const common = mockCommonAgentEndpoints(url);
      if (common) return common;
      if (url.includes("/agents/conversations/agent-conv-export/export")) {
        return jsonResponse({
          conversation: { item_id: "agent-conversation://agent-conv-export", conversation_id: "agent-conv-export", project_id: 7 },
          turns: [],
          context_compactions: [],
          events_by_run_id: { "run-export": [{ item_id: "agent-event://run-export/1", event_seq: 1, event_type: "run.completed" }] },
          tool_calls_by_run_id: {},
          approvals_by_run_id: {},
          migration_blocks_by_run_id: {},
          export_format: "agent_conversation_export_v1",
        });
      }
      return jsonResponse({});
    });
    localStorage.setItem("agent_conversation_history_7", JSON.stringify([{
      itemId: "agent-run://run-export",
      runId: "run-export",
      projectId: 7,
      conversationId: "agent-conv-export",
      intent: "export me",
      status: "completed",
      updatedAt: "2026-07-02T00:00:00Z",
    }]));

    const { container } = render(<AgentsPage projectId={7} />);
    await screen.findByText("export me");
    fireEvent.click(container.querySelector('button[aria-label="导出"]') as HTMLButtonElement);

    await waitFor(() => {
      expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("/agents/conversations/agent-conv-export/export?project_id=7"))).toBe(true);
      expect(createObjectUrl).toHaveBeenCalled();
    });
  });

  it("shows terminal migration action guidance from action details", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      const common = mockCommonAgentEndpoints(url);
      if (common) return common;
      if (url.endsWith("/agents/runs") && init?.method === "POST") {
        return jsonResponse({ item_id: "agent-run://run-migration", run_id: "run-migration", conversation_id: "agent-conv-migration", status: "queued" });
      }
      if (url.includes("/agents/runs/run-migration/events")) return emptyStreamResponse();
      if (url.includes("/agents/runs/run-migration/actions")) {
        return jsonResponse({
          run_summary: { terminal: true, open_migration_block_count: 1 },
          actions: [{
            action_id: "resolve_migration",
            label: "Resolve migration",
            enabled: true,
            reason: "Run is terminal after migration block",
            details: {
              run_terminal: true,
              resolve_preserves_terminal_run: true,
              post_resolve_next_action: "reconcile_run",
            },
            resource_item_ids: ["agent-migration-block://run-migration/block-1"],
          }],
          primary_action_ids: ["resolve_migration"],
          blocked_reasons: ["migration_blocked"],
        });
      }
      if (url.includes("/agents/runs/run-migration/runbook")) return jsonResponse({ run_id: "run-migration", safe_actions: [] });
      if (url.includes("/agents/memory-usage-events")) return jsonResponse({ items: [] });
      if (url.includes("/agents/runs/run-migration")) {
        return jsonResponse({
          item_id: "agent-run://run-migration",
          run_id: "run-migration",
          project_id: 7,
          conversation_id: "agent-conv-migration",
          intent: "migration action",
          status: "migration_blocked",
          current_iteration: 1,
          current_step_index: 0,
          max_iterations: 3,
          migration_block_count: 1,
          events: [],
          tool_calls: [],
          approvals: [],
          migration_blocks: [{
            item_id: "agent-migration-block://run-migration/block-1",
            block_id: "block-1",
            status: "open",
            reason: "schema drift",
          }],
          context_builds: [],
          loop_observations: [],
        });
      }
      return jsonResponse({});
    });

    const { container } = render(<AgentsPage projectId={7} />);
    const composer = container.querySelector("textarea") as HTMLTextAreaElement;
    fireEvent.change(composer, { target: { value: "migration action" } });
    fireEvent.keyDown(composer, { key: "Enter", code: "Enter" });

    await screen.findByRole("button", { name: "Resolve migration" });

    expect(await screen.findByText("Resolve migration")).toBeInTheDocument();
    expect(screen.getByText(/continue reconcile/i)).toBeInTheDocument();
  });
});
