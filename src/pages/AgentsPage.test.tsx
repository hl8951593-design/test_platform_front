import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

function sseStreamResponse(chunks: string[]) {
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

function delayedSseStreamResponse(chunks: string[], delayMs = 20) {
  const encoder = new TextEncoder();
  return {
    ok: true,
    status: 200,
    body: new ReadableStream({
      start(controller) {
        window.setTimeout(() => {
          chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
          controller.close();
        }, delayMs);
      },
    }),
    json: async () => null,
  } as Response;
}

function mockAgentFetch() {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.includes("/agents/dashboard")) {
      return jsonResponse({
        readiness: "attention",
        checks: [{ key: "approval_pending", status: "attention", severity: "P1", message: "存在待审批项" }],
        alert_summary: { P1: 1 },
      });
    }
    if (url.includes("/agents/metrics")) return jsonResponse({ tool_success_rate: 0.95 });
    if (url.includes("/agents/alerts")) return jsonResponse({ items: [{ alert_id: "alert-1", severity: "P1", message: "attention" }] });
    if (url.includes("/agents/release-gates/promotion")) return jsonResponse({ gate_id: "promotion", status: "attention" });
    if (url.includes("/agents/release-gates")) return jsonResponse({ items: [{ gate_id: "gate-1", status: "attention" }] });
    if (url.endsWith("/agents/runs") && init?.method === "POST") {
      return jsonResponse({ run_id: "run-1", conversation_id: "agent-conv-local-test", status: "queued", runtime_snapshot_id: "snap-1" });
    }
    if (url.includes("/agents/runs/run-1/events")) return emptyStreamResponse();
    if (url.includes("/agents/runs/run-1/runbook")) {
      return jsonResponse({ run_id: "run-1", diagnosis: "可以恢复", safe_actions: [{ action: "resume", label: "恢复 Run", reason: "后端判定可安全恢复" }] });
    }
    if (url.includes("/agents/memory-usage-events") && url.includes("/feedback")) {
      return jsonResponse({ usage_event_id: "mem-1", memory_key: "project-standard", feedback: "useful" });
    }
    if (url.includes("/agents/memory-usage-events")) {
      return jsonResponse({ items: [{ usage_event_id: "mem-1", memory_key: "project-standard", risk_level: "low", evidence_json: { source: "memory" } }] });
    }
    if (url.includes("/agents/tool-calls/tool-1/approve")) {
      return jsonResponse({ approval_id: "approval-1", tool_call_id: "tool-1", status: "approved" });
    }
    if (url.includes("/agents/runs/run-1")) {
      return jsonResponse({
        run_id: "run-1",
        project_id: 7,
        conversation_id: "agent-conv-local-test",
        intent: "生成登录测试计划",
        status: "needs_human",
        current_iteration: 1,
        current_step_index: 1,
        max_iterations: 5,
        auto_complete: false,
        runtime_snapshot_id: "snap-1",
        last_event_sequence: 8,
        migration_block_count: 0,
        events: [
          { event_seq: 1, event_type: "run.queued", payload_json: { run_id: "run-1" } },
          { event_seq: 2, event_type: "run.started", payload_json: { run_id: "run-1", provider: "deepseek" } },
          { event_seq: 3, event_type: "model.started", payload_json: { provider: "deepseek" } },
          { event_seq: 4, event_type: "model.delta", payload_json: { content: "Plan ready\n\n" } },
          { event_seq: 5, event_type: "model.delta", payload_json: { content: "- **接口测试**：生成草稿" } },
          { event_seq: 6, event_type: "tool.completed", payload_json: { tool_call_id: "tool-1" } },
          { event_seq: 7, event_type: "tool.send_intent_recorded", payload_json: { effect_submission_state: "send_intent_recorded" } },
          { event_seq: 8, event_type: "run.completed", payload_json: { run_id: "run-1" } },
        ],
        tool_calls: [{
          tool_call_id: "tool-1",
          tool_name: "scenario.compose",
          status: "uncertain",
          effect_submission_state: "unknown",
          input_json_redacted: { prompt: "***" },
          output_json_redacted: { draft: true },
          required_permissions_json: ["scenario:create"],
          recent_reconcile_attempts: [{ status: "pending" }],
        }],
        approvals: [{
          approval_id: "approval-1",
          tool_call_id: "tool-1",
          status: "pending",
          input_hash: "input-hash",
          runtime_snapshot_id: "snap-1",
          resource_scope_hash: "scope-hash",
          approval_lineage_id: "lineage-1",
          approval_epoch: 3,
        }],
        migration_blocks: [],
        context_builds: [{ context_build_id: "ctx-1", degradation_reason: "missing evidence", required_evidence_json: ["api contract"] }],
        loop_observations: [{ observation_id: "loop-1", root_cause: "approval wait", mitigation: "approve or reject" }],
      });
    }
    return jsonResponse({});
  });
}

function mockStreamingAgentFetch() {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.includes("/agents/dashboard")) return jsonResponse({ readiness: "pass", checks: [] });
    if (url.includes("/agents/metrics")) return jsonResponse({});
    if (url.includes("/agents/alerts")) return jsonResponse({ items: [] });
    if (url.includes("/agents/release-gates/promotion")) return jsonResponse({ gate_id: "promotion", status: "pass" });
    if (url.endsWith("/agents/runs") && init?.method === "POST") {
      return jsonResponse({ run_id: "run-stream", conversation_id: "agent-conv-local-stream", status: "queued", runtime_snapshot_id: "snap-stream" });
    }
    if (url.includes("/agents/runs/run-stream/events")) {
      return sseStreamResponse(Array.from({ length: 12 }, (_, index) => (
        `id: ${index + 1}\nevent: model.delta\ndata: {"content":"${index}"}\n\n`
      )));
    }
    return jsonResponse({});
  });
}

function mockFinalContentAgentFetch() {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.includes("/agents/dashboard")) return jsonResponse({ readiness: "pass", checks: [] });
    if (url.includes("/agents/metrics")) return jsonResponse({});
    if (url.includes("/agents/alerts")) return jsonResponse({ items: [] });
    if (url.includes("/agents/release-gates/promotion")) return jsonResponse({ gate_id: "promotion", status: "pass" });
    if (url.includes("/agents/release-gates")) return jsonResponse({ items: [] });
    if (url.endsWith("/agents/runs") && init?.method === "POST") {
      return jsonResponse({ run_id: "run-final", conversation_id: "agent-conv-final", status: "queued", runtime_snapshot_id: "snap-final" });
    }
    if (url.includes("/agents/runs/run-final/events")) return emptyStreamResponse();
    if (url.includes("/agents/runs/run-final")) {
      const finalContent = "Plan ready\n\n- **API test**: draft";
      return jsonResponse({
        run_id: "run-final",
        project_id: 7,
        conversation_id: "agent-conv-final",
        intent: "final content",
        status: "completed",
        current_iteration: 1,
        current_step_index: 0,
        max_iterations: 3,
        auto_complete: false,
        runtime_snapshot_id: "snap-final",
        last_event_sequence: 6,
        migration_block_count: 0,
        events: [
          { event_seq: 1, event_type: "run.started", payload_json: { run_id: "run-final" } },
          { event_seq: 2, event_type: "model.started", payload_json: { provider: "test" } },
          { event_seq: 3, event_type: "model.delta", payload_json: { content: "Plan ready\n\n" } },
          { event_seq: 4, event_type: "model.delta", payload_json: { content: "- **API test**: draft" } },
          { event_seq: 5, event_type: "model.markdown_normalized", payload_json: { content: finalContent } },
          { event_seq: 6, event_type: "model.completed", payload_json: { content: finalContent } },
        ],
        tool_calls: [],
        approvals: [],
        migration_blocks: [],
        context_builds: [],
        loop_observations: [],
      });
    }
    return jsonResponse({});
  });
}

function mockPendingAgentFetch() {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.includes("/agents/dashboard")) return jsonResponse({ readiness: "pass", checks: [] });
    if (url.includes("/agents/metrics")) return jsonResponse({});
    if (url.includes("/agents/alerts")) return jsonResponse({ items: [] });
    if (url.includes("/agents/release-gates/promotion")) return jsonResponse({ gate_id: "promotion", status: "pass" });
    if (url.includes("/agents/release-gates")) return jsonResponse({ items: [] });
    if (url.endsWith("/agents/runs") && init?.method === "POST") {
      return jsonResponse({ run_id: "run-pending", conversation_id: "agent-conv-local-pending", status: "queued", runtime_snapshot_id: "snap-pending" });
    }
    if (url.includes("/agents/runs/run-pending/events")) return emptyStreamResponse();
    if (url.includes("/agents/runs/run-pending/runbook")) return jsonResponse({ run_id: "run-pending", diagnosis: "等待模型返回", safe_actions: [] });
    if (url.includes("/agents/memory-usage-events")) return jsonResponse({ items: [] });
    if (url.includes("/agents/runs/run-pending")) {
      return jsonResponse({
        run_id: "run-pending",
        project_id: 7,
        conversation_id: "agent-conv-local-pending",
        intent: "等待回复目标",
        status: "running",
        current_iteration: 0,
        current_step_index: 0,
        max_iterations: 3,
        auto_complete: false,
        runtime_snapshot_id: "snap-pending",
        last_event_sequence: 1,
        migration_block_count: 0,
        events: [{ event_seq: 1, event_type: "run.started", payload_json: { run_id: "run-pending" } }],
        tool_calls: [],
        approvals: [],
        migration_blocks: [],
        context_builds: [],
        loop_observations: [],
      });
    }
    return jsonResponse({});
  });
}

function mockMultiTurnAgentFetch() {
  let createCount = 0;
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.includes("/agents/dashboard")) return jsonResponse({ readiness: "pass", checks: [] });
    if (url.includes("/agents/metrics")) return jsonResponse({});
    if (url.includes("/agents/alerts")) return jsonResponse({ items: [] });
    if (url.includes("/agents/release-gates/promotion")) return jsonResponse({ gate_id: "promotion", status: "pass" });
    if (url.includes("/agents/release-gates")) return jsonResponse({ items: [] });
    if (url.includes("/agents/conversations/agent-conv-shared/transcript")) {
      const index = createCount;
      return jsonResponse({
        conversation: { conversation_id: "agent-conv-shared", project_id: 7 },
        turns: [{
          run: {
            run_id: `run-turn-${index}`,
            project_id: 7,
            conversation_id: "agent-conv-shared",
            intent: index === 1 ? "第一轮目标" : "第二轮目标",
            status: "completed",
            current_iteration: index,
            current_step_index: 0,
            max_iterations: 3,
            auto_complete: false,
            runtime_snapshot_id: `snap-turn-${index}`,
            migration_block_count: 0,
          },
          assistant_message: `第${index}轮回复`,
          latest_event_sequence: 2,
        }],
      });
    }
    if (url.endsWith("/agents/runs") && init?.method === "POST") {
      createCount += 1;
      return jsonResponse({
        run_id: `run-turn-${createCount}`,
        conversation_id: "agent-conv-shared",
        status: "queued",
        runtime_snapshot_id: `snap-turn-${createCount}`,
      });
    }
    const runMatch = url.match(/\/agents\/runs\/(run-turn-\d+)/);
    if (runMatch && url.includes("/events")) return emptyStreamResponse();
    if (runMatch) {
      const index = Number(runMatch[1].replace("run-turn-", ""));
      return jsonResponse({
        run_id: runMatch[1],
        project_id: 7,
        conversation_id: "agent-conv-shared",
        intent: index === 1 ? "第一轮目标" : "第二轮目标",
        status: "completed",
        current_iteration: index,
        current_step_index: 0,
        max_iterations: 3,
        auto_complete: false,
        runtime_snapshot_id: `snap-turn-${index}`,
        last_event_sequence: 1,
        migration_block_count: 0,
        events: [
          { event_seq: 1, event_type: "model.completed", payload_json: { content: `第${index}轮回复` } },
          { event_seq: 2, event_type: "run.completed", payload_json: { run_id: runMatch[1] } },
        ],
        tool_calls: [],
        approvals: [],
        migration_blocks: [],
        context_builds: [],
        loop_observations: [],
      });
    }
    return jsonResponse({});
  });
}

function mockBackendRekeyedConversationFetch() {
  let createCount = 0;
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.includes("/agents/dashboard")) return jsonResponse({ readiness: "pass", checks: [] });
    if (url.includes("/agents/metrics")) return jsonResponse({});
    if (url.includes("/agents/alerts")) return jsonResponse({ items: [] });
    if (url.includes("/agents/release-gates/promotion")) return jsonResponse({ gate_id: "promotion", status: "pass" });
    if (url.includes("/agents/release-gates")) return jsonResponse({ items: [] });
    if (url.endsWith("/agents/runs") && init?.method === "POST") {
      createCount += 1;
      return jsonResponse({
        run_id: `run-rekey-${createCount}`,
        conversation_id: `agent-conv-backend-${createCount}`,
        status: "queued",
        runtime_snapshot_id: `snap-rekey-${createCount}`,
      });
    }
    const runMatch = url.match(/\/agents\/runs\/(run-rekey-\d+)/);
    if (runMatch && url.includes("/events")) return emptyStreamResponse();
    if (runMatch) {
      const index = Number(runMatch[1].replace("run-rekey-", ""));
      return jsonResponse({
        run_id: runMatch[1],
        project_id: 7,
        conversation_id: `agent-conv-backend-${index}`,
        intent: index === 1 ? "第一个问题" : "第二个问题",
        status: "completed",
        current_iteration: index,
        current_step_index: 0,
        max_iterations: 3,
        auto_complete: false,
        runtime_snapshot_id: `snap-rekey-${index}`,
        last_event_sequence: 1,
        migration_block_count: 0,
        events: [{ event_seq: 1, event_type: "run.completed", payload_json: { run_id: runMatch[1] } }],
        tool_calls: [],
        approvals: [],
        migration_blocks: [],
        context_builds: [],
        loop_observations: [],
      });
    }
    return jsonResponse({});
  });
}

function mockMarkdownContentAgentFetch() {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.includes("/agents/dashboard")) return jsonResponse({ readiness: "pass", checks: [] });
    if (url.includes("/agents/metrics")) return jsonResponse({});
    if (url.includes("/agents/alerts")) return jsonResponse({ items: [] });
    if (url.includes("/agents/release-gates/promotion")) return jsonResponse({ gate_id: "promotion", status: "pass" });
    if (url.includes("/agents/release-gates")) return jsonResponse({ items: [] });
    if (url.endsWith("/agents/runs") && init?.method === "POST") {
      return jsonResponse({ run_id: "run-markdown", conversation_id: "agent-conv-markdown", status: "queued", runtime_snapshot_id: "snap-markdown" });
    }
    if (url.includes("/agents/runs/run-markdown/events")) return emptyStreamResponse();
    if (url.includes("/agents/runs/run-markdown")) {
      const content = [
        "Intro with **bold** and `inline_code`.",
        "",
        "---",
        "",
        "## Dataset plan",
        "",
        "| Step | Name | Path | Note |",
        "| ---- | ---- | ---- | ---- |",
        "| 1 | Get company | POST `/api/company/list` | extract `companyId` |",
        "| 2 | Follow | POST `/api/company/follow` | use `{{companyId}}` |",
        "",
        "- first bullet",
        "- second bullet",
        "",
        "```",
        "step 1",
        "  keep spacing",
        "```",
        "",
        "1. Extract array",
        "2. Bind dataset",
        "",
        "> Quote path",
      ].join("\n");
      return jsonResponse({
        run_id: "run-markdown",
        project_id: 7,
        conversation_id: "agent-conv-markdown",
        intent: "markdown content",
        status: "completed",
        current_iteration: 1,
        current_step_index: 0,
        max_iterations: 3,
        auto_complete: false,
        runtime_snapshot_id: "snap-markdown",
        last_event_sequence: 1,
        migration_block_count: 0,
        events: [
          { event_seq: 1, event_type: "model.completed", payload_json: { content } },
        ],
        tool_calls: [],
        approvals: [],
        migration_blocks: [],
        context_builds: [],
        loop_observations: [],
      });
    }
    return jsonResponse({});
  });
}

function mockForbiddenDashboardFetch() {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes("/agents/dashboard")) {
      return {
        ok: false,
        status: 403,
        json: async () => ({ detail: "Admin required for global Agent dashboard" }),
      } as Response;
    }
    if (url.includes("/agents/metrics")) return jsonResponse({});
    if (url.includes("/agents/alerts")) return jsonResponse({ items: [] });
    if (url.includes("/agents/release-gates/promotion")) return jsonResponse({ gate_id: "promotion", status: "pass" });
    if (url.includes("/agents/release-gates")) return jsonResponse({ items: [] });
    return jsonResponse({});
  });
}

describe("AgentsPage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("defaults the agent loop limit to 8 when creating a run", async () => {
    const fetchMock = mockAgentFetch();
    render(<AgentsPage projectId={7} />);

    expect(screen.getByLabelText("最大循环次数")).toHaveValue(8);

    fireEvent.change(screen.getByLabelText("Agent 目标描述"), { target: { value: "生成登录测试计划" } });
    fireEvent.click(screen.getByRole("button", { name: "发送 Agent Run" }));

    await waitFor(() => {
      const createCall = fetchMock.mock.calls.find((call) => String(call[0]).endsWith("/agents/runs") && call[1]?.method === "POST");
      expect(createCall).toBeTruthy();
      expect(JSON.parse(String(createCall?.[1]?.body))).toMatchObject({
        max_iterations: 8,
      });
    });
  });

  it("creates an Agent run, stores local history, and submits approval CAS", async () => {
    const fetchMock = mockAgentFetch();
    const { container } = render(<AgentsPage projectId={7} />);

    fireEvent.change(screen.getByLabelText("Agent 目标描述"), { target: { value: "生成登录测试计划" } });
    fireEvent.change(screen.getByLabelText("最大循环次数"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "发送 Agent Run" }));

    await screen.findByText("生成登录测试计划");
    expect(screen.getByText("Plan ready")).toBeInTheDocument();
    expect(screen.getByText("接口测试")).toBeInTheDocument();
    expect(screen.queryByText(/\*\*接口测试\*\*/)).not.toBeInTheDocument();
    expect(screen.queryByText("model.delta")).not.toBeInTheDocument();
    expect(screen.queryByText("run.queued")).not.toBeInTheDocument();
    expect(screen.queryByText("run.started")).not.toBeInTheDocument();
    expect(screen.queryByText("run.completed")).not.toBeInTheDocument();
    expect(screen.queryByText("模型调用开始")).not.toBeInTheDocument();
    expect(screen.queryByText("工具发送意图已记录")).not.toBeInTheDocument();
    expect(screen.queryByText("model.started")).not.toBeInTheDocument();
    expect(screen.queryByText("tool.send_intent_recorded")).not.toBeInTheDocument();
    expect(screen.queryByText("原始输出")).not.toBeInTheDocument();
    screen.getAllByText(/工具调用 \d+/).forEach((item) => {
      expect((item.closest("details") as HTMLDetailsElement).open).toBe(false);
    });
    expect(screen.getAllByText("Output Redacted").length).toBeGreaterThan(0);
    expect(localStorage.getItem("agent_conversation_history_7")).toContain("run-1");
    const rail = screen.getByLabelText("Agent 运行上下文");
    const historyItem = within(rail).getByText("生成登录测试计划").closest(".agent-history-item") as HTMLElement;
    expect(within(historyItem).queryByText(/agent-conv-local-test|run-1|snap-1/)).not.toBeInTheDocument();
    expect(within(rail).queryByText("Conversation")).not.toBeInTheDocument();
    expect(within(rail).queryByText("Runtime Snapshot")).not.toBeInTheDocument();
    expect(screen.queryByText("project_id: 7")).not.toBeInTheDocument();
    expect(screen.queryByText("conversation_id: agent-conv-local-test")).not.toBeInTheDocument();
    expect(screen.queryByText("Input Hash")).not.toBeInTheDocument();
    expect(screen.queryByText("Runtime Snapshot")).not.toBeInTheDocument();
    expect(screen.queryByText("approval_pending")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Agent Run 详情")).not.toBeInTheDocument();
    await waitFor(() => {
      const calledUrls = fetchMock.mock.calls.map((call) => String(call[0]));
      expect(calledUrls.some((url) => url.includes("/agents/dashboard?project_id=7"))).toBe(true);
      expect(calledUrls.some((url) => url.includes("/agents/metrics?project_id=7"))).toBe(true);
      expect(calledUrls.some((url) => url.includes("/agents/alerts?project_id=7"))).toBe(true);
      expect(calledUrls.some((url) => url.includes("/agents/release-gates/promotion?project_id=7&target_level=L3"))).toBe(true);
      expect(calledUrls.some((url) => url.endsWith("/agents/release-gates"))).toBe(false);
    });

    fireEvent.click(screen.getByRole("button", { name: "批准" }));

    fireEvent.click(screen.getByRole("button", { name: "展开右侧详情" }));
    const inspector = screen.getByLabelText("Agent Run 详情");
    expect(within(inspector).getByText("循环进度")).toBeInTheDocument();
    expect(within(inspector).queryByText("run_id")).not.toBeInTheDocument();
    expect(within(inspector).queryByText("conversation_id")).not.toBeInTheDocument();
    expect(within(inspector).queryByText("project_id")).not.toBeInTheDocument();
    expect(within(inspector).queryByText("runtime_snapshot_id")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Runbook" }));
    fireEvent.click(await screen.findByRole("button", { name: "恢复 Run" }));
    await waitFor(() => expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("/agents/runs/run-1/resume"))).toBe(true));

    await waitFor(() => {
      const approveCall = fetchMock.mock.calls.find((call) => String(call[0]).includes("/agents/tool-calls/tool-1/approve"));
      expect(approveCall).toBeTruthy();
      expect(JSON.parse(String(approveCall?.[1]?.body))).toEqual({
        input_hash: "input-hash",
        runtime_snapshot_id: "snap-1",
        resource_scope_hash: "scope-hash",
        approval_lineage_id: "lineage-1",
        approval_epoch: 3,
      });
    });
  });

  it("shows a bottom approval prompt and submits yes or no with the approval CAS payload", async () => {
    const fetchMock = mockAgentFetch();
    const { rerender } = render(<AgentsPage projectId={7} />);

    fireEvent.change(screen.getByLabelText("Agent 目标描述"), { target: { value: "生成登录测试计划" } });
    fireEvent.click(screen.getByRole("button", { name: "发送 Agent Run" }));

    const approvalPrompt = await screen.findByRole("group", { name: "工具调用审批" });
    expect(within(approvalPrompt).getByText("是否批准本次工具调用？")).toBeInTheDocument();
    expect(within(approvalPrompt).getByText(/scenario\.compose/)).toBeInTheDocument();
    expect(within(approvalPrompt).queryByText(/approval-1|tool-1|input-hash|scope-hash|lineage-1|snap-1/)).not.toBeInTheDocument();

    fireEvent.click(within(approvalPrompt).getByRole("button", { name: "是，批准工具调用" }));

    await waitFor(() => {
      const approveCall = fetchMock.mock.calls.find((call) => String(call[0]).includes("/agents/tool-calls/tool-1/approve"));
      expect(approveCall).toBeTruthy();
      expect(JSON.parse(String(approveCall?.[1]?.body))).toEqual({
        input_hash: "input-hash",
        runtime_snapshot_id: "snap-1",
        resource_scope_hash: "scope-hash",
        approval_lineage_id: "lineage-1",
        approval_epoch: 3,
      });
    });
    await waitFor(() => expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("/agents/runs/run-1/resume"))).toBe(true));

    fetchMock.mockClear();
    rerender(<AgentsPage projectId={7} />);
    fireEvent.change(screen.getByLabelText("Agent 目标描述"), { target: { value: "生成登录测试计划" } });
    fireEvent.click(screen.getByRole("button", { name: "发送 Agent Run" }));

    const nextApprovalPrompt = await screen.findByRole("group", { name: "工具调用审批" });
    fireEvent.click(within(nextApprovalPrompt).getByRole("button", { name: "否，拒绝工具调用" }));

    await waitFor(() => {
      const rejectCall = fetchMock.mock.calls.find((call) => String(call[0]).includes("/agents/tool-calls/tool-1/reject"));
      expect(rejectCall).toBeTruthy();
      expect(JSON.parse(String(rejectCall?.[1]?.body))).toEqual({
        input_hash: "input-hash",
        runtime_snapshot_id: "snap-1",
        resource_scope_hash: "scope-hash",
        approval_lineage_id: "lineage-1",
        approval_epoch: 3,
        reason: "user_rejected_from_agent_bottom_prompt",
      });
    });
  });

  it("keeps a pending bottom approval prompt when a later run snapshot omits approvals", async () => {
    let runFetchCount = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("/agents/dashboard")) return jsonResponse({ readiness: "attention", checks: [] });
      if (url.includes("/agents/metrics")) return jsonResponse({});
      if (url.includes("/agents/alerts")) return jsonResponse({ items: [] });
      if (url.includes("/agents/release-gates/promotion")) return jsonResponse({ gate_id: "promotion", status: "attention" });
      if (url.includes("/agents/release-gates")) return jsonResponse({ items: [] });
      if (url.endsWith("/agents/runs") && init?.method === "POST") {
        return jsonResponse({ run_id: "run-approval-flash", conversation_id: "agent-conv-approval-flash", status: "queued", runtime_snapshot_id: "snap-flash" });
      }
      if (url.includes("/agents/runs/run-approval-flash/events")) {
        return delayedSseStreamResponse([
          "id: 9\nevent: run.updated\ndata: {\"run_id\":\"run-approval-flash\"}\n\n",
        ]);
      }
      if (url.includes("/agents/runs/run-approval-flash")) {
        runFetchCount += 1;
        return jsonResponse({
          run_id: "run-approval-flash",
          project_id: 7,
          conversation_id: "agent-conv-approval-flash",
          intent: "保存测试用例",
          status: "needs_human",
          current_iteration: 1,
          current_step_index: 1,
          max_iterations: 5,
          auto_complete: false,
          runtime_snapshot_id: "snap-flash",
          last_event_sequence: 9,
          migration_block_count: 0,
          events: [{ event_seq: 8, event_type: "approval.requested", payload_json: { tool_call_id: "tool-flash" } }],
          tool_calls: [{
            tool_call_id: "tool-flash",
            tool_name: "testcase.batch_update_assertions",
            status: "planned",
            required_permissions_json: ["case:manage"],
            input_json_redacted: { items: [{ test_case_id: 7 }] },
          }],
          approvals: runFetchCount === 1 ? [{
            approval_id: "approval-flash",
            tool_call_id: "tool-flash",
            status: "pending",
            input_hash: "input-flash",
            runtime_snapshot_id: "snap-flash",
            resource_scope_hash: "scope-flash",
            approval_lineage_id: "lineage-flash",
            approval_epoch: 1,
          }] : [],
          migration_blocks: [],
          context_builds: [],
          loop_observations: [],
        });
      }
      return jsonResponse({});
    });

    const { container } = render(<AgentsPage projectId={7} />);

    fireEvent.change(screen.getByLabelText("Agent 目标描述"), { target: { value: "保存测试用例" } });
    fireEvent.click(screen.getByRole("button", { name: "发送 Agent Run" }));

    const approvalPrompt = await screen.findByRole("group", { name: "工具调用审批" });
    expect(within(approvalPrompt).getByText("是否批准本次工具调用？")).toBeInTheDocument();

    await waitFor(() => expect(runFetchCount).toBeGreaterThanOrEqual(2));
    expect(screen.getByRole("group", { name: "工具调用审批" })).toBeInTheDocument();
  });

  it("replaces stale pending approval cards when governance refresh returns an approved approval", async () => {
    let runFetchCount = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("/agents/dashboard")) return jsonResponse({ readiness: "attention", checks: [] });
      if (url.includes("/agents/metrics")) return jsonResponse({});
      if (url.includes("/agents/alerts")) return jsonResponse({ items: [] });
      if (url.includes("/agents/release-gates/promotion")) return jsonResponse({ gate_id: "promotion", status: "attention" });
      if (url.includes("/agents/release-gates")) return jsonResponse({ items: [] });
      if (url.endsWith("/agents/runs") && init?.method === "POST") {
        return jsonResponse({ run_id: "run-approved-refresh", conversation_id: "agent-conv-approved-refresh", status: "queued", runtime_snapshot_id: "snap-approved" });
      }
      if (url.includes("/agents/runs/run-approved-refresh/events")) {
        return delayedSseStreamResponse([
          "id: 10\nevent: approval.approved\ndata: {\"approval_id\":\"approval-approved\",\"tool_call_id\":\"tool-approved\"}\n\n",
        ]);
      }
      if (url.includes("/agents/runs/run-approved-refresh/approvals")) {
        return jsonResponse({
          items: [{
            approval_id: "approval-approved",
            tool_call_id: "tool-approved",
            status: "approved",
            input_hash: "input-approved",
            runtime_snapshot_id: "snap-approved",
            resource_scope_hash: "scope-approved",
            approval_lineage_id: "lineage-approved",
            approval_epoch: 1,
          }],
        });
      }
      if (url.includes("/agents/runs/run-approved-refresh")) {
        runFetchCount += 1;
        return jsonResponse({
          run_id: "run-approved-refresh",
          project_id: 7,
          conversation_id: "agent-conv-approved-refresh",
          intent: "保存测试用例断言",
          status: "needs_human",
          current_iteration: 1,
          current_step_index: 1,
          max_iterations: 5,
          auto_complete: false,
          runtime_snapshot_id: "snap-approved",
          last_event_sequence: 10,
          migration_block_count: 0,
          events: [{ event_seq: 8, event_type: "approval.created", payload_json: { tool_call_id: "tool-approved" } }],
          tool_calls: [{
            tool_call_id: "tool-approved",
            tool_name: "testcase.batch_update_assertions",
            status: "planned",
            required_permissions_json: ["case:manage"],
            input_json_redacted: { items: [{ test_case_id: 7 }] },
          }],
          approvals: runFetchCount === 1 ? [{
            approval_id: "approval-approved",
            tool_call_id: "tool-approved",
            status: "pending",
            input_hash: "input-approved",
            runtime_snapshot_id: "snap-approved",
            resource_scope_hash: "scope-approved",
            approval_lineage_id: "lineage-approved",
            approval_epoch: 1,
          }] : [],
          migration_blocks: [],
          context_builds: [],
          loop_observations: [],
        });
      }
      return jsonResponse({});
    });

    const { container } = render(<AgentsPage projectId={7} />);

    fireEvent.change(screen.getByLabelText("Agent 目标描述"), { target: { value: "保存测试用例断言" } });
    fireEvent.click(screen.getByRole("button", { name: "发送 Agent Run" }));

    expect(await screen.findByRole("group", { name: "工具调用审批" })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("group", { name: "工具调用审批" })).not.toBeInTheDocument());
  });

  it("removes the approval prompt after approve resume observes a failed tool result", async () => {
    let approved = false;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("/agents/dashboard")) return jsonResponse({ readiness: "attention", checks: [] });
      if (url.includes("/agents/metrics")) return jsonResponse({});
      if (url.includes("/agents/alerts")) return jsonResponse({ items: [] });
      if (url.includes("/agents/release-gates/promotion")) return jsonResponse({ gate_id: "promotion", status: "attention" });
      if (url.includes("/agents/release-gates")) return jsonResponse({ items: [] });
      if (url.endsWith("/agents/runs") && init?.method === "POST") {
        return jsonResponse({ run_id: "run-observed-failed", conversation_id: "agent-conv-observed-failed", status: "queued", runtime_snapshot_id: "snap-observed" });
      }
      if (url.includes("/agents/runs/run-observed-failed/events")) return emptyStreamResponse();
      if (url.includes("/agents/tool-calls/tool-observed-failed/approve") && init?.method === "POST") {
        approved = true;
        return jsonResponse({
          approval: {
            approval_id: "approval-observed-failed",
            tool_call_id: "tool-observed-failed",
            approval_status: "approved",
            approval_epoch: 1,
          },
          tool_call: {
            tool_call_id: "tool-observed-failed",
            tool_name: "testcase.batch_update_assertions",
            status: "planned",
          },
        });
      }
      if (url.includes("/agents/runs/run-observed-failed/resume") && init?.method === "POST") {
        return jsonResponse({
          run: {
            run_id: "run-observed-failed",
            project_id: 7,
            conversation_id: "agent-conv-observed-failed",
            intent: "淇濆瓨娴嬭瘯鐢ㄤ緥鏂█",
            status: "completed",
            current_iteration: 1,
            current_step_index: 1,
            max_iterations: 5,
            auto_complete: false,
            runtime_snapshot_id: "snap-observed",
            last_event_sequence: 12,
            migration_block_count: 0,
            blocking_tool_call_ids_json: [],
            events: [{ event_seq: 12, event_type: "tool.result_observed", payload_json: { tool_call_id: "tool-observed-failed", status: "failed" } }],
            tool_calls: [{
              tool_call_id: "tool-observed-failed",
              tool_name: "testcase.batch_update_assertions",
              status: "failed",
              error_code: "tool_execution_failed",
              error_message: "404: test case missing",
            }],
            approvals: [],
            migration_blocks: [],
            context_builds: [],
            loop_observations: [],
          },
          resumed: true,
          checkpoint_freshness: { result: "fresh", action: "continue_from_checkpoint" },
          scheduled_tool_call_ids: [],
          executed_tool_call_ids: [],
          observed_tool_call_ids: ["tool-observed-failed"],
        });
      }
      if (url.includes("/agents/runs/run-observed-failed/actions")) return jsonResponse({ actions: [], primary_action_ids: [], blocked_reasons: [], generated_at: "2026-07-02T00:00:00Z" });
      if (url.includes("/agents/runs/run-observed-failed/runbook")) return jsonResponse({ run_id: "run-observed-failed", recommendations: [] });
      if (url.includes("/agents/runs/run-observed-failed")) {
        return jsonResponse({
          run_id: "run-observed-failed",
          project_id: 7,
          conversation_id: "agent-conv-observed-failed",
          intent: "淇濆瓨娴嬭瘯鐢ㄤ緥鏂█",
          status: approved ? "completed" : "needs_human",
          current_iteration: 1,
          current_step_index: 1,
          max_iterations: 5,
          auto_complete: false,
          runtime_snapshot_id: "snap-observed",
          last_event_sequence: approved ? 12 : 8,
          migration_block_count: 0,
          blocking_tool_call_ids_json: approved ? [] : ["tool-observed-failed"],
          events: [],
          tool_calls: [{
            tool_call_id: "tool-observed-failed",
            tool_name: "testcase.batch_update_assertions",
            status: approved ? "failed" : "planned",
            error_code: approved ? "tool_execution_failed" : undefined,
            error_message: approved ? "404: test case missing" : undefined,
            required_permissions_json: ["case:manage"],
            input_json_redacted: { items: [{ test_case_id: 7 }] },
          }],
          approvals: approved ? [] : [{
            approval_id: "approval-observed-failed",
            tool_call_id: "tool-observed-failed",
            approval_status: "pending",
            input_hash: "input-observed",
            runtime_snapshot_id: "snap-observed",
            resource_scope_hash: "scope-observed",
            approval_lineage_id: "lineage-observed",
            approval_epoch: 1,
          }],
          migration_blocks: [],
          context_builds: [],
          loop_observations: [],
        });
      }
      return jsonResponse({});
    });

    const { container } = render(<AgentsPage projectId={7} />);

    fireEvent.change(screen.getByLabelText("Agent 目标描述"), { target: { value: "淇濆瓨娴嬭瘯鐢ㄤ緥鏂█" } });
    fireEvent.click(screen.getByRole("button", { name: "发送 Agent Run" }));

    const approvalPrompt = await screen.findByRole("group", { name: "工具调用审批" });
    const buttons = within(approvalPrompt).getAllByRole("button");
    fireEvent.click(buttons[1]);

    await waitFor(() => {
      expect(screen.queryByRole("group", { name: "工具调用审批" })).not.toBeInTheDocument();
    });
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("/agents/runs/run-observed-failed/resume"))).toBe(true);
    expect(container.querySelector(".agent-rail-section strong")).toHaveTextContent("已完成");
  });

  it("sends with Enter, clears the composer, and shows thinking while waiting", async () => {
    const fetchMock = mockPendingAgentFetch();
    render(<AgentsPage projectId={7} />);

    expect(screen.getByText("testagnet")).toBeInTheDocument();
    expect(screen.getByText("我们应该做什么")).toBeInTheDocument();

    const composer = screen.getByLabelText("Agent 目标描述") as HTMLTextAreaElement;
    fireEvent.change(composer, { target: { value: "等待回复目标" } });
    fireEvent.keyDown(composer, { key: "Enter", code: "Enter" });

    await screen.findByText("等待回复目标");
    expect(composer.value).toBe("");
    expect(screen.queryByText("我们应该做什么")).not.toBeInTheDocument();
    expect(await screen.findByText(/正在思考/)).toBeInTheDocument();
    expect(screen.getByText("0s")).toBeInTheDocument();
    expect(fetchMock.mock.calls.some((call) => String(call[0]).endsWith("/agents/runs") && call[1]?.method === "POST")).toBe(true);
  });

  it("shows the live run status for the active local history item", async () => {
    mockPendingAgentFetch();
    localStorage.setItem("agent_conversation_history_7", JSON.stringify([{
      runId: "run-pending",
      projectId: 7,
      conversationId: "agent-conv-local-pending",
      intent: "等待回复目标",
      status: "failed",
      updatedAt: "2026-06-29T00:00:00Z",
    }]));
    render(<AgentsPage projectId={7} />);

    const historyTitle = await screen.findByText("等待回复目标");
    const historyItem = historyTitle.closest("article") as HTMLElement;
    expect(within(historyItem).getByText("失败")).toBeInTheDocument();

    fireEvent.click(within(historyItem).getByRole("button", { name: /等待回复目标/ }));

    await waitFor(() => expect(within(historyItem).getByText("运行中")).toBeInTheDocument());
    expect(within(historyItem).queryByText("失败")).not.toBeInTheDocument();
  });

  it("keeps multiple runs in the same conversation as one local history item", async () => {
    const fetchMock = mockMultiTurnAgentFetch();
    render(<AgentsPage projectId={7} />);
    const composer = screen.getByLabelText("Agent 目标描述") as HTMLTextAreaElement;

    fireEvent.change(composer, { target: { value: "第一轮目标" } });
    fireEvent.keyDown(composer, { key: "Enter", code: "Enter" });
    await screen.findByText("第一轮目标");
    const firstCreateBody = JSON.parse(String(fetchMock.mock.calls.find((call) => String(call[0]).endsWith("/agents/runs") && call[1]?.method === "POST")?.[1]?.body));
    await waitFor(() => {
      const history = JSON.parse(localStorage.getItem("agent_conversation_history_7") ?? "[]");
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({ conversationId: firstCreateBody.conversation_id, runId: "run-turn-1" });
    });

    fireEvent.change(composer, { target: { value: "第二轮目标" } });
    fireEvent.keyDown(composer, { key: "Enter", code: "Enter" });

    await screen.findByText("第二轮目标");
    await waitFor(() => {
      const history = JSON.parse(localStorage.getItem("agent_conversation_history_7") ?? "[]");
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({ conversationId: firstCreateBody.conversation_id, runId: "run-turn-2", intent: "第二轮目标" });
    });
    const transcript = document.querySelector(".agent-thread-scroll") as HTMLElement;
    expect(within(transcript).getAllByText("第一轮目标").length).toBeGreaterThan(0);
    expect(within(transcript).getByText("第1轮回复")).toBeInTheDocument();
    expect(within(transcript).getAllByText("第二轮目标").length).toBeGreaterThan(0);
    expect(within(transcript).getByText("第2轮回复")).toBeInTheDocument();
    expect(document.querySelectorAll(".agent-history-item")).toHaveLength(1);
    const createBodies = fetchMock.mock.calls
      .filter((call) => String(call[0]).endsWith("/agents/runs") && call[1]?.method === "POST")
      .map((call) => JSON.parse(String(call[1]?.body)));
    expect(createBodies[1].conversation_id).toBe(firstCreateBody.conversation_id);
    await waitFor(() => {
      const transcriptUrls = fetchMock.mock.calls
        .map((call) => String(call[0]))
        .filter((url) => url.includes("/agents/conversations/") && url.includes("/transcript"));
      expect(transcriptUrls.some((url) => (
        url.includes(`/agents/conversations/${encodeURIComponent(firstCreateBody.conversation_id)}/transcript`)
          && url.includes("project_id=7")
      ))).toBe(true);
      expect(transcriptUrls.every((url) => url.includes("project_id=7"))).toBe(true);
    });
  });

  it("keeps follow-up prompts in the current local conversation when backend returns a new conversation id", async () => {
    const fetchMock = mockBackendRekeyedConversationFetch();
    render(<AgentsPage projectId={7} />);
    const composer = screen.getByLabelText("Agent 目标描述") as HTMLTextAreaElement;

    fireEvent.change(composer, { target: { value: "第一个问题" } });
    fireEvent.keyDown(composer, { key: "Enter", code: "Enter" });
    await screen.findByText("第一个问题");

    const firstBody = JSON.parse(String(fetchMock.mock.calls.find((call) => String(call[0]).endsWith("/agents/runs") && call[1]?.method === "POST")?.[1]?.body));

    fireEvent.change(composer, { target: { value: "第二个问题" } });
    fireEvent.keyDown(composer, { key: "Enter", code: "Enter" });
    await screen.findByText("第二个问题");

    const createBodies = fetchMock.mock.calls
      .filter((call) => String(call[0]).endsWith("/agents/runs") && call[1]?.method === "POST")
      .map((call) => JSON.parse(String(call[1]?.body)));
    expect(createBodies[1].conversation_id).toBe(firstBody.conversation_id);
    expect(createBodies[1].conversation_id).not.toBe("agent-conv-backend-1");
    expect(document.querySelectorAll(".agent-history-item")).toHaveLength(1);
    await waitFor(() => {
      const history = JSON.parse(localStorage.getItem("agent_conversation_history_7") ?? "[]");
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({
        conversationId: firstBody.conversation_id,
        runId: "run-rekey-2",
        intent: "第二个问题",
      });
    });
  });

  it("deduplicates persisted conversation history before delete actions", async () => {
    mockForbiddenDashboardFetch();
    localStorage.setItem("agent_conversation_history_7", JSON.stringify([
      {
        runId: "run-new",
        projectId: 7,
        conversationId: "agent-conv-duplicate",
        intent: "最新问题",
        status: "running",
        updatedAt: "2026-06-29T00:02:00Z",
      },
      {
        runId: "run-old",
        projectId: 7,
        conversationId: "agent-conv-duplicate",
        intent: "旧问题",
        status: "failed",
        updatedAt: "2026-06-29T00:01:00Z",
      },
    ]));

    render(<AgentsPage projectId={7} />);

    const historyTitle = await screen.findByText("最新问题");
    expect(screen.queryByText("旧问题")).not.toBeInTheDocument();
    expect(document.querySelectorAll(".agent-history-item")).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem("agent_conversation_history_7") ?? "[]")).toHaveLength(1);

    fireEvent.click(within(historyTitle.closest("article") as HTMLElement).getByLabelText("删除本地历史"));

    expect(document.querySelectorAll(".agent-history-item")).toHaveLength(0);
    expect(JSON.parse(localStorage.getItem("agent_conversation_history_7") ?? "[]")).toHaveLength(0);
  });

  it("batches dense model deltas into one assistant message", async () => {
    mockStreamingAgentFetch();
    render(<AgentsPage projectId={7} />);

    const composer = screen.getByLabelText("Agent 目标描述") as HTMLTextAreaElement;
    fireEvent.change(composer, { target: { value: "输出较长内容" } });
    fireEvent.keyDown(composer, { key: "Enter", code: "Enter" });

    expect(await screen.findByText("01234567891011")).toBeInTheDocument();
    expect(screen.queryByText("model.delta")).not.toBeInTheDocument();
  });

  it("deduplicates normalized and completed model final content", async () => {
    mockFinalContentAgentFetch();
    render(<AgentsPage projectId={7} />);

    const composer = screen.getByLabelText("Agent 目标描述") as HTMLTextAreaElement;
    fireEvent.change(composer, { target: { value: "final content" } });
    fireEvent.keyDown(composer, { key: "Enter", code: "Enter" });

    expect(await screen.findByText("Plan ready")).toBeInTheDocument();
    expect(screen.getAllByText("API test")).toHaveLength(1);
    expect(screen.queryByText("model.delta")).not.toBeInTheDocument();
    expect(screen.queryByText("model.markdown_normalized")).not.toBeInTheDocument();
    expect(screen.queryByText("model.completed")).not.toBeInTheDocument();
  });

  it("replaces the active assistant bubble for normalized markdown content", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("/agents/dashboard")) return jsonResponse({ readiness: "pass", checks: [] });
      if (url.includes("/agents/metrics")) return jsonResponse({});
      if (url.includes("/agents/alerts")) return jsonResponse({ items: [] });
      if (url.includes("/agents/release-gates/promotion")) return jsonResponse({ gate_id: "promotion", status: "pass" });
      if (url.includes("/agents/release-gates")) return jsonResponse({ items: [] });
      if (url.endsWith("/agents/runs") && init?.method === "POST") {
        return jsonResponse({ run_id: "run-normalized", conversation_id: "agent-conv-normalized", status: "queued" });
      }
      if (url.includes("/agents/runs/run-normalized/events")) return emptyStreamResponse();
      if (url.includes("/agents/runs/run-normalized/summary")) {
        return jsonResponse({ run_id: "run-normalized", status: "completed", assistant_message: "Final table\n\n| A | B |\n| --- | --- |\n| 1 | 2 |", assistant_visible: true });
      }
      if (url.includes("/agents/runs/run-normalized")) {
        return jsonResponse({
          run_id: "run-normalized",
          project_id: 7,
          conversation_id: "agent-conv-normalized",
          intent: "normalize markdown",
          status: "completed",
          current_iteration: 1,
          current_step_index: 0,
          max_iterations: 3,
          migration_block_count: 0,
          events: [
            { event_seq: 1, event_type: "model.delta", payload_json: { content: "Draft table | A | B |" } },
            { event_seq: 2, event_type: "model.markdown_normalized", payload_json: { content: "Final table\n\n| A | B |\n| --- | --- |\n| 1 | 2 |", replace_content: true } },
          ],
          tool_calls: [],
          approvals: [],
          migration_blocks: [],
          context_builds: [],
          loop_observations: [{
            observation_id: "loop-audit-hidden",
            root_cause: "循环观察",
            stop_reason: "repair_prompt_required",
            mitigation: "不要在主线程展示",
            causal_chain_json: ["model_output_invalid", "tool_request_schema_violation", "repair_prompt_required"],
          }],
        });
      }
      return jsonResponse({});
    });

    render(<AgentsPage projectId={7} />);
    const composer = screen.getByLabelText("Agent 目标描述") as HTMLTextAreaElement;
    fireEvent.change(composer, { target: { value: "normalize markdown" } });
    fireEvent.keyDown(composer, { key: "Enter", code: "Enter" });

    expect(await screen.findByText("Final table")).toBeInTheDocument();
    expect(screen.queryByText(/Draft table/)).not.toBeInTheDocument();
    expect(screen.queryByText("model.markdown_normalized")).not.toBeInTheDocument();
  });

  it("stops thinking and shows an interrupted retry state for stale worker loss", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("/agents/dashboard")) return jsonResponse({ readiness: "pass", checks: [] });
      if (url.includes("/agents/metrics")) return jsonResponse({});
      if (url.includes("/agents/alerts")) return jsonResponse({ items: [] });
      if (url.includes("/agents/release-gates/promotion")) return jsonResponse({ gate_id: "promotion", status: "pass" });
      if (url.includes("/agents/release-gates")) return jsonResponse({ items: [] });
      if (url.endsWith("/agents/runs") && init?.method === "POST") {
        return jsonResponse({ run_id: "run-stale", conversation_id: "agent-conv-stale", status: "queued" });
      }
      if (url.includes("/agents/runs/run-stale/events")) return emptyStreamResponse();
      if (url.includes("/agents/runs/run-stale/summary")) return jsonResponse({ run_id: "run-stale", status: "failed", assistant_visible: false });
      if (url.includes("/agents/runs/run-stale")) {
        return jsonResponse({
          run_id: "run-stale",
          project_id: 7,
          conversation_id: "agent-conv-stale",
          intent: "stale worker",
          status: "failed",
          error_code: "agent_run_stale_worker_lost",
          error_message: "worker lost",
          current_iteration: 1,
          current_step_index: 0,
          max_iterations: 3,
          migration_block_count: 0,
          events: [
            { event_seq: 1, event_type: "run.failed", payload_json: { error_code: "agent_run_stale_worker_lost", error_message: "worker lost" } },
          ],
          tool_calls: [],
          approvals: [],
          migration_blocks: [],
          context_builds: [],
          loop_observations: [],
        });
      }
      return jsonResponse({});
    });

    render(<AgentsPage projectId={7} />);
    const composer = screen.getByLabelText("Agent 目标描述") as HTMLTextAreaElement;
    fireEvent.change(composer, { target: { value: "stale worker" } });
    fireEvent.keyDown(composer, { key: "Enter", code: "Enter" });

    expect(await screen.findByText(/后端执行进程中断/)).toBeInTheDocument();
    expect(screen.queryByText(/正在思考/)).not.toBeInTheDocument();
  });

  it("keeps waiting after tool result is observed by the model context", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("/agents/dashboard")) return jsonResponse({ readiness: "pass", checks: [] });
      if (url.includes("/agents/metrics")) return jsonResponse({});
      if (url.includes("/agents/alerts")) return jsonResponse({ items: [] });
      if (url.includes("/agents/release-gates/promotion")) return jsonResponse({ gate_id: "promotion", status: "pass" });
      if (url.includes("/agents/release-gates")) return jsonResponse({ items: [] });
      if (url.endsWith("/agents/runs") && init?.method === "POST") {
        return jsonResponse({ run_id: "run-observed", conversation_id: "agent-conv-observed", status: "queued" });
      }
      if (url.includes("/agents/runs/run-observed/events")) return emptyStreamResponse();
      if (url.includes("/agents/tool-calls/tool-observed")) {
        return jsonResponse({ tool_call_id: "tool-observed", tool_name: "scenario.compose_draft", status: "succeeded", output_json_redacted: { draft: true } });
      }
      if (url.includes("/agents/runs/run-observed")) {
        return jsonResponse({
          run_id: "run-observed",
          project_id: 7,
          conversation_id: "agent-conv-observed",
          intent: "tool observed",
          status: "running",
          current_iteration: 1,
          current_step_index: 0,
          max_iterations: 3,
          migration_block_count: 0,
          events: [{ event_seq: 2, event_type: "tool.result_observed", payload_json: { tool_call_id: "tool-observed" } }],
          tool_calls: [{ tool_call_id: "tool-observed", tool_name: "scenario.compose_draft", status: "succeeded", output_json_redacted: { draft: true } }],
          approvals: [],
          migration_blocks: [],
          context_builds: [],
          loop_observations: [],
        });
      }
      return jsonResponse({});
    });

    render(<AgentsPage projectId={7} />);
    const composer = screen.getByLabelText("Agent 目标描述") as HTMLTextAreaElement;
    fireEvent.change(composer, { target: { value: "tool observed" } });
    fireEvent.keyDown(composer, { key: "Enter", code: "Enter" });

    expect(await screen.findByText(/已完成工具调用/)).toBeInTheDocument();
    expect(await screen.findByText(/正在思考/)).toBeInTheDocument();
  });

  it("treats query-first required tool repair and retry tool calls as a normal loop", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("/agents/dashboard")) return jsonResponse({ readiness: "pass", checks: [] });
      if (url.includes("/agents/metrics")) return jsonResponse({});
      if (url.includes("/agents/alerts")) return jsonResponse({ items: [] });
      if (url.includes("/agents/release-gates/promotion")) return jsonResponse({ gate_id: "promotion", status: "pass" });
      if (url.includes("/agents/release-gates")) return jsonResponse({ items: [] });
      if (url.endsWith("/agents/runs") && init?.method === "POST") {
        return jsonResponse({ run_id: "run-required-repair", conversation_id: "agent-conv-required-repair", status: "queued" });
      }
      if (url.includes("/agents/runs/run-required-repair/events")) return emptyStreamResponse();
      if (url.includes("/agents/runs/run-required-repair")) {
        return jsonResponse({
          run_id: "run-required-repair",
          project_id: 7,
          conversation_id: "agent-conv-required-repair",
          intent: "query first scenario repair",
          status: "completed",
          current_iteration: 2,
          current_step_index: 0,
          max_iterations: 3,
          migration_block_count: 0,
          events: [
            { event_seq: 1, event_type: "model.required_tool_missing", payload_json: { loop_step: "required_tool_repair", decision_reason: "query-first required before compose" } },
            { event_seq: 2, event_type: "model.required_tool_repaired", payload_json: { loop_step: "required_tool_repair", tool_call_id: "tool-repair-1" } },
            { event_seq: 3, event_type: "tool.completed", payload_json: { tool_call_id: "tool-repair-1" } },
            { event_seq: 4, event_type: "tool.completed", payload_json: { tool_call_id: "tool-repair-2" } },
            { event_seq: 5, event_type: "model.completed", payload_json: { content: "已完成 query-first 场景组合草稿。" } },
          ],
          tool_calls: [
            {
              tool_call_id: "tool-repair-1",
              tool_name: "scenario.compose_draft",
              status: "failed_retryable",
              input_json_redacted: { input: { requirement: "先查询企业，再生成关注场景" } },
              output_json_redacted: { warning: "missing query result" },
            },
            {
              tool_call_id: "tool-repair-2",
              tool_name: "scenario.compose_draft",
              status: "succeeded",
              input_json_redacted: { input: { requirement: "先查询企业，再生成关注场景" } },
              output_json_redacted: { draft: true },
            },
          ],
          approvals: [],
          migration_blocks: [],
          context_builds: [],
          loop_observations: [],
        });
      }
      return jsonResponse({});
    });

    render(<AgentsPage projectId={7} />);
    const composer = screen.getByLabelText("Agent 目标描述") as HTMLTextAreaElement;
    fireEvent.change(composer, { target: { value: "query first scenario repair" } });
    fireEvent.keyDown(composer, { key: "Enter", code: "Enter" });

    expect(await screen.findByText("已完成 query-first 场景组合草稿。")).toBeInTheDocument();
    expect(screen.getAllByText(/场景组合/).length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText("model.required_tool_missing")).not.toBeInTheDocument();
    expect(screen.queryByText("model.required_tool_repaired")).not.toBeInTheDocument();
    expect(screen.queryByText(/重复提交/)).not.toBeInTheDocument();
  });

  it("does not carry Last-Event-ID from one run into the next run", async () => {
    let createCount = 0;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("/agents/dashboard")) return jsonResponse({ readiness: "pass", checks: [] });
      if (url.includes("/agents/metrics")) return jsonResponse({});
      if (url.includes("/agents/alerts")) return jsonResponse({ items: [] });
      if (url.includes("/agents/release-gates/promotion")) return jsonResponse({ gate_id: "promotion", status: "pass" });
      if (url.includes("/agents/release-gates")) return jsonResponse({ items: [] });
      if (url.endsWith("/agents/runs") && init?.method === "POST") {
        createCount += 1;
        return jsonResponse({ run_id: `run-cursor-${createCount}`, conversation_id: "agent-conv-cursor", status: "queued" });
      }
      if (url.includes("/agents/runs/run-cursor-1/events")) {
        return sseStreamResponse(['id: 5\nevent: model.delta\ndata: {"content":"first"}\n\n']);
      }
      if (url.includes("/agents/runs/run-cursor-2/events")) {
        return sseStreamResponse(['id: 1\nevent: model.delta\ndata: {"content":"second"}\n\n']);
      }
      const runMatch = url.match(/\/agents\/runs\/(run-cursor-\d+)/);
      if (runMatch) {
        const index = runMatch[1].endsWith("1") ? 1 : 2;
        return jsonResponse({
          run_id: runMatch[1],
          project_id: 7,
          conversation_id: "agent-conv-cursor",
          intent: index === 1 ? "cursor one" : "cursor two",
          status: "running",
          current_iteration: index,
          current_step_index: 0,
          max_iterations: 3,
          migration_block_count: 0,
          events: [],
          tool_calls: [],
          approvals: [],
          migration_blocks: [],
          context_builds: [],
          loop_observations: [],
        });
      }
      return jsonResponse({});
    });

    render(<AgentsPage projectId={7} />);
    const composer = screen.getByLabelText("Agent 目标描述") as HTMLTextAreaElement;
    fireEvent.change(composer, { target: { value: "cursor one" } });
    fireEvent.keyDown(composer, { key: "Enter", code: "Enter" });
    expect(await screen.findByText("first")).toBeInTheDocument();

    fireEvent.change(composer, { target: { value: "cursor two" } });
    fireEvent.keyDown(composer, { key: "Enter", code: "Enter" });
    expect(await screen.findByText("second")).toBeInTheDocument();

    const eventCalls = fetchMock.mock.calls.filter((call) => String(call[0]).includes("/events") && !String(call[0]).includes("snapshot"));
    expect((eventCalls[0][1]?.headers as Headers).get("Last-Event-ID")).toBeNull();
    expect((eventCalls[1][1]?.headers as Headers).get("Last-Event-ID")).toBeNull();
  });

  it("renders assistant markdown code fences ordered lists quotes and separators", async () => {
    mockMarkdownContentAgentFetch();
    const { container } = render(<AgentsPage projectId={7} />);

    const composer = screen.getByLabelText("Agent 目标描述") as HTMLTextAreaElement;
    fireEvent.change(composer, { target: { value: "markdown content" } });
    fireEvent.keyDown(composer, { key: "Enter", code: "Enter" });

    expect(await screen.findByRole("heading", { name: "Dataset plan" })).toBeInTheDocument();
    expect(container.querySelector(".agent-markdown hr")).toBeInTheDocument();
    const table = container.querySelector(".agent-markdown table") as HTMLTableElement;
    expect(table).toBeInTheDocument();
    expect(Array.from(table.querySelectorAll("th")).map((item) => item.textContent)).toEqual(["Step", "Name", "Path", "Note"]);
    expect(Array.from(table.querySelectorAll("tbody tr")).map((row) => Array.from(row.querySelectorAll("td")).map((cell) => cell.textContent))).toEqual([
      ["1", "Get company", "POST /api/company/list", "extract companyId"],
      ["2", "Follow", "POST /api/company/follow", "use {{companyId}}"],
    ]);
    expect(container.querySelector(".agent-markdown pre code")?.textContent).toBe("step 1\n  keep spacing");
    expect(Array.from(container.querySelectorAll(".agent-markdown ul li")).map((item) => item.textContent)).toEqual([
      "first bullet",
      "second bullet",
    ]);
    expect(Array.from(container.querySelectorAll(".agent-markdown ol li")).map((item) => item.textContent)).toEqual([
      "Extract array",
      "Bind dataset",
    ]);
    expect(container.querySelector(".agent-markdown blockquote")).toHaveTextContent("Quote path");
    expect(screen.queryByText(/``` step 1/)).not.toBeInTheDocument();
  });

  it("hides internal tool request markdown blocks and low-level tool stream events", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("/agents/dashboard")) return jsonResponse({ readiness: "pass", checks: [] });
      if (url.includes("/agents/metrics")) return jsonResponse({});
      if (url.includes("/agents/alerts")) return jsonResponse({ items: [] });
      if (url.includes("/agents/release-gates/promotion")) return jsonResponse({ gate_id: "promotion", status: "pass" });
      if (url.includes("/agents/release-gates")) return jsonResponse({ items: [] });
      if (url.endsWith("/agents/runs") && init?.method === "POST") {
        return jsonResponse({ run_id: "run-tool-stream", conversation_id: "agent-conv-tool-stream", status: "queued", runtime_snapshot_id: "snap-tool-stream" });
      }
      if (url.includes("/agents/runs/run-tool-stream/events")) return emptyStreamResponse();
      if (url.includes("/agents/runs/run-tool-stream")) {
        return jsonResponse({
          run_id: "run-tool-stream",
          project_id: 7,
          conversation_id: "agent-conv-tool-stream",
          intent: "tool stream",
          status: "completed",
          current_iteration: 1,
          current_step_index: 0,
          max_iterations: 3,
          auto_complete: false,
          runtime_snapshot_id: "snap-tool-stream",
          last_event_sequence: 6,
          migration_block_count: 0,
          events: [
            { event_seq: 1, event_type: "model.delta", payload_json: { content: "我将为你创建一个企业信息查询与关注流程场景，现在调用组合工具：\n```json\n{\"tool_name\":\"scenario.compose_draft\",\"input\":{\"input\":{\"requirement\":\"创建企业场景\"}}}\n```" } },
            { event_seq: 2, event_type: "model.delta", payload_json: { content: "\n我将为你创建一个企业信息查询与关注流程场景，现在调用组合工具：```{\"tool_name\":\"scenario.compose_draft\",\"input\":{\"input\":{\"requirement\":\"创建企业场景\"}}}```" } },
            { event_seq: 3, event_type: "model.tool_request_detected", payload_json: { tool_name: "scenario.compose_draft" } },
            { event_seq: 4, event_type: "tool.planned", payload_json: { tool_call_id: "tool-stream" } },
            { event_seq: 5, event_type: "tool.running", payload_json: { tool_call_id: "tool-stream" } },
            { event_seq: 6, event_type: "model.tool_request_stream_suppressed", payload_json: { content: "{\"tool_name\":\"scenario.compose_draft\"}" } },
            { event_seq: 7, event_type: "context.history_compacted", payload_json: { strategy: "summarize_older_keep_recent", compacted_turns: 3 } },
            { event_seq: 8, event_type: "model.completed", payload_json: { content: "Final answer" } },
          ],
          tool_calls: [{
            tool_call_id: "tool-stream",
            tool_name: "scenario.compose_draft",
            status: "succeeded",
            input_json_redacted: { input: { requirement: "创建企业场景" } },
          }],
          approvals: [],
          migration_blocks: [],
          context_builds: [],
          loop_observations: [],
        });
      }
      return jsonResponse({});
    });

    const { container } = render(<AgentsPage projectId={7} />);
    const composer = screen.getByLabelText("Agent 目标描述") as HTMLTextAreaElement;
    fireEvent.change(composer, { target: { value: "tool stream" } });
    fireEvent.keyDown(composer, { key: "Enter", code: "Enter" });

    expect(await screen.findByText("Final answer")).toBeInTheDocument();
    expect(container.querySelector(".agent-tool-activity-copy strong")).toHaveTextContent(
      "已完成工具调用 · 场景组合"
    );
    expect(container.querySelector(".agent-tool-activity-copy small:last-child")).toHaveTextContent("需求：创建企业场景");
    expect(screen.queryByText(/agent_tool_request/)).not.toBeInTheDocument();
    expect(screen.queryByText(/"tool_name"/)).not.toBeInTheDocument();
    expect(screen.queryByText(/现在调用组合工具/)).not.toBeInTheDocument();
    expect(screen.queryByText("model.tool_request_detected")).not.toBeInTheDocument();
    expect(screen.queryByText("model.tool_request_stream_suppressed")).not.toBeInTheDocument();
    expect(screen.queryByText("上下文历史已压缩")).not.toBeInTheDocument();
    expect(screen.queryByText("context.history_compacted")).not.toBeInTheDocument();
    expect(screen.queryByText("tool.planned")).not.toBeInTheDocument();
    expect(screen.queryByText("tool.running")).not.toBeInTheDocument();
  });

  it("does not render approval-followup tool request JSON as an Agent reply", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("/agents/dashboard")) return jsonResponse({ readiness: "pass", checks: [] });
      if (url.includes("/agents/metrics")) return jsonResponse({});
      if (url.includes("/agents/alerts")) return jsonResponse({ alerts: [], summary: {} });
      if (url.includes("/agents/release-gates/promotion")) return jsonResponse({ target_level: "L3", decision: "pass" });
      if (url.includes("/agents/release-gates")) return jsonResponse({ current_level: "L2", status: "pass", checks: [] });
      if (url.endsWith("/agents/runs") && init?.method === "POST") {
        return jsonResponse({ run_id: "run-tool-json-hidden", conversation_id: "agent-conv-tool-json-hidden", status: "queued", runtime_snapshot_id: "snap-tool-json-hidden" });
      }
      if (url.includes("/agents/runs/run-tool-json-hidden/events")) return emptyStreamResponse();
      if (url.includes("/agents/runs/run-tool-json-hidden")) {
        return jsonResponse({
          run_id: "run-tool-json-hidden",
          project_id: 7,
          conversation_id: "agent-conv-tool-json-hidden",
          intent: "按查询结果更新断言",
          status: "running",
          current_iteration: 3,
          current_step_index: 0,
          max_iterations: 8,
          auto_complete: false,
          runtime_snapshot_id: "snap-tool-json-hidden",
          last_event_sequence: 5,
          migration_block_count: 0,
          events: [
            { event_seq: 1, event_type: "model.completed", payload_json: { content: "{\"tool_name\":\"testcase.batch_update_assertions\",\"input\":{\"project_id\":7,\"items\":[{\"test_case_id\":999,\"assertions\":[]}]}}", requested_tool: true } },
            { event_seq: 2, event_type: "tool.running", payload_json: { tool_call_id: "tool-assertions", tool_name: "testcase.batch_update_assertions" } },
            { event_seq: 3, event_type: "tool.result_observed", payload_json: { tool_call_id: "tool-assertions", tool_name: "testcase.batch_update_assertions" } },
            { event_seq: 4, event_type: "model.delta", payload_json: { content: "{\"tool_name\":\"testcase.query_project_cases\",\"input\":{\"project_id\":7},\"reason\":\"need returned ids\"}" } },
            { event_seq: 5, event_type: "model.tool_request_detected", payload_json: { tool_name: "testcase.query_project_cases" } },
          ],
          tool_calls: [{
            tool_call_id: "tool-assertions",
            tool_name: "testcase.batch_update_assertions",
            status: "succeeded",
            input_json_redacted: { project_id: 7, items: [{ test_case_id: 204, assertions: [] }] },
          }],
          approvals: [],
          migration_blocks: [],
          context_builds: [],
          loop_observations: [],
        });
      }
      return jsonResponse({});
    });

    const { container } = render(<AgentsPage projectId={7} />);
    const composer = screen.getByLabelText("Agent 目标描述") as HTMLTextAreaElement;
    fireEvent.change(composer, { target: { value: "按查询结果更新断言" } });
    fireEvent.keyDown(composer, { key: "Enter", code: "Enter" });

    expect(await screen.findByText("工具调用 1")).toBeInTheDocument();
    expect(container.querySelector(".agent-tool-activity-copy strong")).toHaveTextContent(
      "已完成工具调用 · testcase.batch_update_assertions",
    );
    expect(screen.queryByText(/"tool_name"/)).not.toBeInTheDocument();
    expect(screen.queryByText(/testcase\.query_project_cases/)).not.toBeInTheDocument();
    expect(screen.queryByText(/999/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Agent 回复/)).not.toBeInTheDocument();
  });

  it("keeps loop audit events and backend identifiers out of the user thread", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("/agents/dashboard")) return jsonResponse({ readiness: "pass", checks: [] });
      if (url.includes("/agents/metrics")) return jsonResponse({});
      if (url.includes("/agents/alerts")) return jsonResponse({ items: [] });
      if (url.includes("/agents/release-gates/promotion")) return jsonResponse({ gate_id: "promotion", status: "pass" });
      if (url.includes("/agents/release-gates")) return jsonResponse({ items: [] });
      if (url.endsWith("/agents/runs") && init?.method === "POST") {
        return jsonResponse({ run_id: "run-audit-hidden", conversation_id: "agent-conv-audit-hidden", status: "queued", runtime_snapshot_id: "snap-audit-hidden" });
      }
      if (url.includes("/agents/runs/run-audit-hidden/events")) return emptyStreamResponse();
      if (url.includes("/agents/runs/run-audit-hidden")) {
        return jsonResponse({
          run_id: "run-audit-hidden",
          project_id: 7,
          conversation_id: "agent-conv-audit-hidden",
          intent: "查询测试用例",
          status: "completed",
          current_iteration: 1,
          current_step_index: 0,
          max_iterations: 3,
          auto_complete: false,
          runtime_snapshot_id: "snap-audit-hidden",
          last_event_sequence: 7,
          migration_block_count: 0,
          events: [
            { event_seq: 1, event_type: "model.delta", payload_json: { content: "已找到 3 条测试用例。" } },
            { event_seq: 2, event_type: "tool.effect_committed", payload_json: { tool_call_id: "tool-audit", project_id: 7, item_id: "agent-event://run-audit-hidden/2" } },
            { event_seq: 3, event_type: "tool.result_observed", payload_json: { tool_call_id: "tool-audit", context_build_id: "ctx-secret" } },
            { event_seq: 4, event_type: "context.decision_context_bound", payload_json: { event_seq: 4, project_id: 7, context_build_id: "ctx-secret", item_id: "agent-event://run-audit-hidden/4" } },
            { event_seq: 5, event_type: "loop.observed", payload_json: { loop_step: "tool_execution", item_id: "agent-loop://hidden" } },
            { event_seq: 6, event_type: "memory.usage_recorded", payload_json: { project_id: 7, item_id: "agent-memory://hidden" } },
            { event_seq: 7, event_type: "model.completed", payload_json: { content: "已找到 3 条测试用例。" } },
          ],
          tool_calls: [{
            tool_call_id: "tool-audit",
            tool_name: "testcase.query_project_cases",
            status: "succeeded",
            output_json_redacted: { total: 3 },
          }],
          approvals: [],
          migration_blocks: [],
          context_builds: [],
          loop_observations: [],
        });
      }
      return jsonResponse({});
    });

    const { container } = render(<AgentsPage projectId={7} />);
    const composer = screen.getByLabelText("Agent 目标描述") as HTMLTextAreaElement;
    fireEvent.change(composer, { target: { value: "查询测试用例" } });
    fireEvent.keyDown(composer, { key: "Enter", code: "Enter" });

    expect(await screen.findByText("已找到 3 条测试用例。")).toBeInTheDocument();
    expect(container.querySelector(".agent-tool-activity-copy strong")).toHaveTextContent("已完成工具调用");
    expect(screen.queryByText("工具效果已提交")).not.toBeInTheDocument();
    expect(screen.queryByText("工具结果已进入上下文")).not.toBeInTheDocument();
    expect(screen.queryByText(/上下文事件/)).not.toBeInTheDocument();
    expect(screen.queryByText("loop.observed")).not.toBeInTheDocument();
    expect(screen.queryByText("memory.usage_recorded")).not.toBeInTheDocument();
    expect(screen.queryByText("循环观察")).not.toBeInTheDocument();
    expect(screen.queryByText("causal_chain")).not.toBeInTheDocument();
    expect(screen.queryByText("repair_prompt_required")).not.toBeInTheDocument();
    expect(screen.queryByText("project_id")).not.toBeInTheDocument();
    expect(screen.queryByText("context_build_id")).not.toBeInTheDocument();
    expect(screen.queryByText("agent-event://run-audit-hidden/4")).not.toBeInTheDocument();
    expect(screen.queryByText("agent-loop://hidden")).not.toBeInTheDocument();
    expect(screen.queryByText("原始输出")).not.toBeInTheDocument();
  });

  it("shows a user-facing tool call placeholder before tool details are hydrated", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("/agents/dashboard")) return jsonResponse({ readiness: "pass", checks: [] });
      if (url.includes("/agents/metrics")) return jsonResponse({});
      if (url.includes("/agents/alerts")) return jsonResponse({ items: [] });
      if (url.includes("/agents/release-gates/promotion")) return jsonResponse({ gate_id: "promotion", status: "pass" });
      if (url.includes("/agents/release-gates")) return jsonResponse({ items: [] });
      if (url.endsWith("/agents/runs") && init?.method === "POST") {
        return jsonResponse({ run_id: "run-tool-placeholder", conversation_id: "agent-conv-tool-placeholder", status: "queued", runtime_snapshot_id: "snap-tool-placeholder" });
      }
      if (url.includes("/agents/runs/run-tool-placeholder/events")) return emptyStreamResponse();
      if (url.includes("/agents/runs/run-tool-placeholder")) {
        return jsonResponse({
          run_id: "run-tool-placeholder",
          project_id: 7,
          conversation_id: "agent-conv-tool-placeholder",
          intent: "先查询用例",
          status: "running",
          current_iteration: 1,
          current_step_index: 0,
          max_iterations: 3,
          auto_complete: false,
          runtime_snapshot_id: "snap-tool-placeholder",
          last_event_sequence: 3,
          migration_block_count: 0,
          events: [
            { event_seq: 1, event_type: "model.delta", payload_json: { content: "我会先查询项目中的测试用例。" } },
            { event_seq: 2, event_type: "tool.running", payload_json: { tool_call_id: "tool-pending-detail", tool_name: "testcase.query_project_cases", project_id: 7, item_id: "agent-event://hidden-tool" } },
            { event_seq: 3, event_type: "context.decision_context_bound", payload_json: { context_build_id: "ctx-hidden", project_id: 7 } },
          ],
          tool_calls: [],
          approvals: [],
          migration_blocks: [],
          context_builds: [],
          loop_observations: [],
        });
      }
      return jsonResponse({});
    });

    const { container } = render(<AgentsPage projectId={7} />);
    const composer = screen.getByLabelText("Agent 目标描述") as HTMLTextAreaElement;
    fireEvent.change(composer, { target: { value: "先查询用例" } });
    fireEvent.keyDown(composer, { key: "Enter", code: "Enter" });

    expect(await screen.findByText("我会先查询项目中的测试用例。")).toBeInTheDocument();
    expect(screen.getByText("工具调用 1")).toBeInTheDocument();
    expect(container.querySelector(".agent-tool-activity-copy strong")).toHaveTextContent("正在运行工具");
    expect(container.querySelector(".agent-tool-activity-copy strong")).toHaveTextContent("testcase.query_project_cases");
    expect(screen.queryByText("tool.running")).not.toBeInTheDocument();
    expect(screen.queryByText("context.decision_context_bound")).not.toBeInTheDocument();
    expect(screen.queryByText("project_id")).not.toBeInTheDocument();
    expect(screen.queryByText("agent-event://hidden-tool")).not.toBeInTheDocument();
    expect(screen.queryByText("原始输出")).not.toBeInTheDocument();
  });

  it("keeps static system and dashboard permission messages out of the thread", async () => {
    const fetchMock = mockForbiddenDashboardFetch();
    render(<AgentsPage projectId={7} />);

    await screen.findByText("我们应该做什么");
    await waitFor(() => expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("/agents/dashboard?project_id=7"))).toBe(true));

    expect(screen.queryByText("我会围绕当前项目创建一个可审计 Agent Run")).not.toBeInTheDocument();
    expect(screen.queryByText("Admin required for global Agent dashboard")).not.toBeInTheDocument();
    expect(screen.queryByText("状态更新")).not.toBeInTheDocument();
  });

  it("supports local history search pin rename delete and dashboard inspector", async () => {
    mockAgentFetch();
    vi.spyOn(window, "prompt").mockReturnValue("登录计划");
    localStorage.setItem("agent_conversation_history_7", JSON.stringify([{
      runId: "run-1",
      projectId: 7,
      conversationId: "agent-conv-local-test",
      intent: "生成登录测试计划",
      status: "needs_human",
      updatedAt: "2026-06-27T00:00:00Z",
    }]));

    render(<AgentsPage projectId={7} />);

    fireEvent.change(screen.getByLabelText("搜索本地 Agent 历史"), { target: { value: "登录" } });
    const historyItem = await screen.findByText("生成登录测试计划");
    expect(historyItem).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("置顶"));
    expect(localStorage.getItem("agent_conversation_history_7")).toContain('"pinned":true');

    fireEvent.click(screen.getByLabelText("重命名"));
    expect(await screen.findByText("登录计划")).toBeInTheDocument();

    expect(screen.queryByLabelText("Agent Run 详情")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "展开右侧详情" }));
    fireEvent.click(screen.getByRole("button", { name: "Dashboard" }));
    const inspector = screen.getByLabelText("Agent Run 详情");
    expect(within(inspector).getByText("alerts")).toBeInTheDocument();
    expect(within(inspector).getByText("release_gate")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("删除本地历史"));
    expect(screen.getByText(/暂无匹配的本地历史/)).toBeInTheDocument();
  });

  it("disables create when project context is missing", async () => {
    const fetchMock = mockAgentFetch();
    render(<AgentsPage />);

    await waitFor(() => expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("/agents/dashboard"))).toBe(false));
    expect(screen.getByText(/请先在顶部选择项目/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "发送 Agent Run" })).toBeDisabled();
  });
});
