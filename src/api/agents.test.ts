import {
  approveAgentToolCall,
  createAgentRun,
  getAgentAlerts,
  getAgentApprovals,
  getAgentContextBuilds,
  getAgentDashboard,
  getAgentLoopObservations,
  getAgentMemoryUsageEvents,
  getAgentMetrics,
  getAgentMigrationBlocks,
  getAgentReleaseGatePromotion,
  getAgentReleaseGates,
  getAgentRun,
  getAgentRunbook,
  getAgentToolCall,
  listAgentRuns,
  rejectAgentToolCall,
  sendAgentMemoryFeedback,
  subscribeAgentRunEvents,
} from "./agents";

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

describe("Agent API", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("creates an agent run with project context", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({
      run_id: "agent-run-1",
      status: "queued",
      runtime_snapshot_id: "snap-1",
    }));

    const result = await createAgentRun({
      projectId: 7,
      conversationId: "agent-conv-local-1",
      intent: "根据登录流程生成场景草稿",
      maxIterations: 3,
      autoComplete: false,
    });

    expect(String(fetchMock.mock.calls[0][0])).toContain("/agents/runs");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      project_id: 7,
      conversation_id: "agent-conv-local-1",
      intent: "根据登录流程生成场景草稿",
      max_iterations: 3,
      auto_complete: false,
    });
    expect(result).toEqual({
      runId: "agent-run-1",
      status: "queued",
      runtimeSnapshotId: "snap-1",
    });
  });

  it("maps run snapshots with tool calls approvals and migration blocks", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({
      run_id: "agent-run-1",
      project_id: 7,
      intent: "compose_scenario",
      status: "migration_blocked",
      current_iteration: 2,
      current_step_index: 4,
      max_iterations: 3,
      runtime_snapshot_id: "snap-1",
      migration_block_count: 1,
      blocking_tool_call_ids_json: ["tool-1"],
      events: [{ event_seq: 1, event_type: "run.started", payload_json: {}, created_at: "2026-06-26T00:00:00Z" }],
      tool_calls: [{
        tool_call_id: "tool-1",
        tool_name: "scenario.compose_draft",
        status: "needs_migration",
        effect_submission_state: "unknown",
        backend_operation: "create_draft_scenario",
        backend_effect_capability: "idempotency_index_only",
      }],
      approvals: [{ approval_id: "approval-1", tool_call_id: "tool-1", status: "pending", approval_epoch: 3 }],
      migration_blocks: [{ block_id: "block-1", tool_call_id: "tool-1", status: "open", reason: "unsupported_schema_version" }],
    }));

    const snapshot = await getAgentRun("agent-run-1");

    expect(snapshot.status).toBe("migration_blocked");
    expect(snapshot.toolCalls[0]).toEqual(expect.objectContaining({
      toolCallId: "tool-1",
      backendOperation: "create_draft_scenario",
    }));
    expect(snapshot.approvals[0].approvalEpoch).toBe(3);
    expect(snapshot.migrationBlocks[0].reason).toBe("unsupported_schema_version");
  });

  it("subscribes to authenticated agent run SSE events with Last-Event-ID", async () => {
    localStorage.setItem("access_token", "token");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(streamResponse([
      'id: 2\nevent: model.delta\ndata: {"content":"plan"}\n\n',
      'id: 3\ndata: {"event_type":"tool.uncertain","payload_json":{"tool_call_id":"tool-1"}}\n\n',
    ]));
    const events: string[] = [];

    await subscribeAgentRunEvents("agent-run-1", (event) => events.push(`${event.sequence}:${event.event}`), { lastEventId: 1 });

    expect(events).toEqual(["2:model.delta", "3:tool.uncertain"]);
    const [, init] = fetchMock.mock.calls[0];
    expect(String(fetchMock.mock.calls[0][0])).toBe("http://127.0.0.1:8000/api/v1/agents/runs/agent-run-1/events");
    expect((init?.headers as Headers).get("Authorization")).toBe("Bearer token");
    expect((init?.headers as Headers).get("Accept")).toBe("text/event-stream");
    expect((init?.headers as Headers).get("Last-Event-ID")).toBe("1");
  });

  it("approves tool calls through the dedicated contract endpoint", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({
      approval_id: "approval-1",
      tool_call_id: "tool-1",
      status: "approved",
    }));

    const approval = await approveAgentToolCall("tool-1", {
      inputHash: "input-hash",
      runtimeSnapshotId: "snap-1",
      resourceScopeHash: "scope-hash",
      approvalLineageId: "lineage-1",
      approvalEpoch: 3,
    });

    expect(String(fetchMock.mock.calls[0][0])).toContain("/agents/tool-calls/tool-1/approve");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      input_hash: "input-hash",
      runtime_snapshot_id: "snap-1",
      resource_scope_hash: "scope-hash",
      approval_lineage_id: "lineage-1",
      approval_epoch: 3,
    });
    expect(approval.status).toBe("approved");
  });

  it("maps readiness dashboard checks", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({
      readiness: "attention",
      checks: [{ key: "live_recovery_attention", status: "attention", severity: "P1", message: "存在未收敛恢复项" }],
      alert_summary: { P1: 1 },
    }));

    const dashboard = await getAgentDashboard(7);

    expect(String(fetchMock.mock.calls[0][0])).toContain("/agents/dashboard?project_id=7");
    expect(dashboard.readiness).toBe("attention");
    expect(dashboard.checks[0].key).toBe("live_recovery_attention");
    expect(dashboard.alertSummary).toEqual({ P1: 1 });
  });

  it("lists historical agent conversations by project", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({
      items: [{
        run_id: "agent-run-1",
        project_id: 7,
        conversation_id: "agent-conv-local-1",
        intent: "生成登录场景",
        status: "completed",
        updated_at: "2026-06-26T01:00:00Z",
      }],
    }));

    const runs = await listAgentRuns(7);

    expect(String(fetchMock.mock.calls[0][0])).toContain("/agents/runs?project_id=7");
    expect(runs[0]).toEqual(expect.objectContaining({
      runId: "agent-run-1",
      conversationId: "agent-conv-local-1",
      intent: "生成登录场景",
      status: "completed",
    }));
  });

  it("wraps detail and governance endpoints used by the Agent page", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/tool-calls/tool-1")) {
        return jsonResponse({
          tool_call_id: "tool-1",
          tool_name: "scenario.compose",
          status: "succeeded",
          effect_submission_state: "effect_committed",
          input_json_redacted: { prompt: "***" },
          output_json_redacted: { scenario_id: 1 },
          required_permissions_json: ["scenario:create"],
          recent_reconcile_attempts: [{ status: "none" }],
        });
      }
      if (url.includes("/approvals")) return jsonResponse({ items: [{ approval_id: "approval-1", tool_call_id: "tool-1", status: "pending" }] });
      if (url.includes("/migration-blocks")) return jsonResponse({ items: [{ block_id: "block-1", status: "open", reason: "schema" }] });
      if (url.includes("/context-builds")) return jsonResponse({ items: [{ context_build_id: "ctx-1", degradation_reason: "missing evidence" }] });
      if (url.includes("/loop-observations")) return jsonResponse({ items: [{ observation_id: "loop-1", root_cause: "retry loop" }] });
      if (url.includes("/memory-usage-events") && url.includes("/feedback")) return jsonResponse({ usage_event_id: "mem-1", feedback: "useful" });
      if (url.includes("/memory-usage-events")) return jsonResponse({ items: [{ usage_event_id: "mem-1", memory_key: "project-standard" }] });
      if (url.includes("/runbook")) return jsonResponse({ diagnosis: "resume is safe", safe_actions: [{ action: "resume", reason: "after checkpoint" }] });
      if (url.includes("/metrics")) return jsonResponse({ tool_success_rate: 0.98 });
      if (url.includes("/alerts")) return jsonResponse({ items: [{ alert_id: "alert-1", severity: "P1", message: "attention" }] });
      if (url.includes("/release-gates/promotion")) return jsonResponse({ gate_id: "promotion", status: "pass" });
      if (url.includes("/release-gates")) return jsonResponse({ items: [{ gate_id: "gate-1", status: "attention" }] });
      return jsonResponse({});
    });

    await expect(getAgentToolCall("tool-1")).resolves.toEqual(expect.objectContaining({
      toolCallId: "tool-1",
      inputJsonRedacted: { prompt: "***" },
      outputJsonRedacted: { scenario_id: 1 },
    }));
    await expect(getAgentApprovals("run-1")).resolves.toHaveLength(1);
    await expect(getAgentMigrationBlocks("run-1")).resolves.toHaveLength(1);
    await expect(getAgentContextBuilds("run-1")).resolves.toHaveLength(1);
    await expect(getAgentLoopObservations("run-1")).resolves.toHaveLength(1);
    await expect(getAgentMemoryUsageEvents("run-1")).resolves.toHaveLength(1);
    await expect(sendAgentMemoryFeedback("mem-1", "useful")).resolves.toEqual(expect.objectContaining({ feedback: "useful" }));
    await expect(getAgentRunbook("run-1")).resolves.toEqual(expect.objectContaining({ diagnosis: "resume is safe", safeActions: [expect.objectContaining({ action: "resume", reason: "after checkpoint" })] }));
    await expect(getAgentMetrics(7)).resolves.toEqual({ metrics: { tool_success_rate: 0.98 } });
    await expect(getAgentAlerts(7)).resolves.toHaveLength(1);
    await expect(getAgentReleaseGates()).resolves.toHaveLength(1);
    await expect(getAgentReleaseGatePromotion(7)).resolves.toEqual(expect.objectContaining({ gateId: "promotion" }));

    const calledUrls = fetchMock.mock.calls.map((call) => String(call[0])).join("\n");
    expect(calledUrls).toContain("/agents/tool-calls/tool-1");
    expect(calledUrls).toContain("/agents/runs/run-1/context-builds");
    expect(calledUrls).toContain("/agents/memory-usage-events?run_id=run-1");
    expect(calledUrls).toContain("/agents/metrics?project_id=7");
    expect(calledUrls).toContain("/agents/alerts?project_id=7");
    expect(calledUrls).toContain("/agents/release-gates\n");
    expect(calledUrls).toContain("/agents/release-gates/promotion?project_id=7&target_level=L3");
  });

  it("rejects tool calls with the same CAS payload shape", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({
      approval_id: "approval-1",
      tool_call_id: "tool-1",
      status: "rejected",
    }));

    await rejectAgentToolCall("tool-1", {
      inputHash: "input-hash",
      runtimeSnapshotId: "snap-1",
      resourceScopeHash: "scope-hash",
      approvalLineageId: "lineage-1",
      approvalEpoch: 3,
      reason: "too risky",
    });

    expect(String(fetchMock.mock.calls[0][0])).toContain("/agents/tool-calls/tool-1/reject");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      input_hash: "input-hash",
      runtime_snapshot_id: "snap-1",
      resource_scope_hash: "scope-hash",
      approval_lineage_id: "lineage-1",
      approval_epoch: 3,
      reason: "too risky",
    });
  });
});
