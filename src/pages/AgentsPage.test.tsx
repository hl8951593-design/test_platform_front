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
        last_event_sequence: 7,
        migration_block_count: 0,
        events: [
          { event_seq: 1, event_type: "run.queued", payload_json: { run_id: "run-1" } },
          { event_seq: 2, event_type: "run.started", payload_json: { run_id: "run-1", provider: "deepseek" } },
          { event_seq: 3, event_type: "model.started", payload_json: { provider: "deepseek" } },
          { event_seq: 4, event_type: "assistant.delta", payload_json: { delta: "Plan ready\n\n" } },
          { event_seq: 5, event_type: "assistant.delta", payload_json: { delta: "- **接口测试**：生成草稿" } },
          { event_seq: 6, event_type: "tool.completed", payload_json: { tool_call_id: "tool-1" } },
          { event_seq: 7, event_type: "run.completed", payload_json: { run_id: "run-1" } },
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

  it("creates an Agent run, stores local history, and submits approval CAS", async () => {
    const fetchMock = mockAgentFetch();
    render(<AgentsPage projectId={7} />);

    fireEvent.change(screen.getByLabelText("Agent 目标描述"), { target: { value: "生成登录测试计划" } });
    fireEvent.change(screen.getByLabelText("最大循环次数"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "发送 Agent Run" }));

    await screen.findByText("生成登录测试计划");
    expect(screen.getByText("Plan ready")).toBeInTheDocument();
    expect(screen.getByText("接口测试")).toBeInTheDocument();
    expect(screen.queryByText(/\*\*接口测试\*\*/)).not.toBeInTheDocument();
    expect(screen.queryByText("assistant.delta")).not.toBeInTheDocument();
    expect(screen.queryByText("run.queued")).not.toBeInTheDocument();
    expect(screen.queryByText("run.started")).not.toBeInTheDocument();
    expect(screen.queryByText("run.completed")).not.toBeInTheDocument();
    expect(screen.getByText("model.started")).toBeInTheDocument();
    const rawOutputToggles = screen.getAllByText("原始输出").map((item) => item.closest("details") as HTMLDetailsElement);
    expect(rawOutputToggles.length).toBeGreaterThan(0);
    rawOutputToggles.forEach((details) => expect(details.open).toBe(false));
    screen.getAllByText(/ToolCall \d+/).forEach((item) => {
      expect((item.closest("details") as HTMLDetailsElement).open).toBe(false);
    });
    expect(screen.getAllByText("Output Redacted").length).toBeGreaterThan(0);
    expect(localStorage.getItem("agent_conversation_history_7")).toContain("run-1");
    expect(screen.queryByText("approval_pending")).not.toBeInTheDocument();
    await waitFor(() => {
      const calledUrls = fetchMock.mock.calls.map((call) => String(call[0]));
      expect(calledUrls.some((url) => url.includes("/agents/dashboard?project_id=7"))).toBe(true);
      expect(calledUrls.some((url) => url.includes("/agents/metrics?project_id=7"))).toBe(true);
      expect(calledUrls.some((url) => url.includes("/agents/alerts?project_id=7"))).toBe(true);
      expect(calledUrls.some((url) => url.includes("/agents/release-gates/promotion?project_id=7&target_level=L3"))).toBe(true);
      expect(calledUrls.some((url) => url.endsWith("/agents/release-gates"))).toBe(false);
    });

    fireEvent.click(screen.getByRole("button", { name: "批准" }));

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

  it("batches dense model deltas into one assistant message", async () => {
    mockStreamingAgentFetch();
    render(<AgentsPage projectId={7} />);

    const composer = screen.getByLabelText("Agent 目标描述") as HTMLTextAreaElement;
    fireEvent.change(composer, { target: { value: "输出较长内容" } });
    fireEvent.keyDown(composer, { key: "Enter", code: "Enter" });

    expect(await screen.findByText("01234567891011")).toBeInTheDocument();
    expect(screen.queryByText("model.delta")).not.toBeInTheDocument();
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
