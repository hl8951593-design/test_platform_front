import {
  approveAgentToolCall,
  createAgentRun,
  getAgentAlerts,
  getAgentCapabilities,
  getAgentApprovals,
  getAgentContextBuilds,
  getAgentConversationExport,
  getAgentDashboard,
  getAgentLoopObservations,
  getAgentMemoryUsageEvents,
  getAgentMetrics,
  getAgentMigrationBlocks,
  getAgentReleaseGatePromotion,
  getAgentReleaseGates,
  getAgentConversationTranscript,
  getAgentRun,
  getAgentRunActions,
  getAgentRunbook,
  getAgentRunSummary,
  getAgentSkills,
  getAgentToolCall,
  listAgentRuns,
  rejectAgentToolCall,
  reconcileAgentRun,
  resolveAgentMigrationBlock,
  resumeAgentRun,
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
      item_id: "agent-run://agent-run-1",
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
      events: [{ item_id: "agent-event://agent-run-1/1", event_seq: 1, event_type: "run.started", payload_json: {}, created_at: "2026-06-26T00:00:00Z" }],
      tool_calls: [{
        item_id: "agent-tool-call://agent-run-1/tool-1",
        tool_call_id: "tool-1",
        tool_name: "scenario.compose_draft",
        status: "needs_migration",
        effect_submission_state: "unknown",
        backend_operation: "create_draft_scenario",
        backend_effect_capability: "idempotency_index_only",
      }],
      approvals: [{ item_id: "agent-approval://agent-run-1/approval-1", tool_call_item_id: "agent-tool-call://agent-run-1/tool-1", approval_id: "approval-1", tool_call_id: "tool-1", approval_status: "approved", approval_epoch: 3 }],
      migration_blocks: [{ item_id: "agent-migration-block://agent-run-1/block-1", tool_call_item_id: "agent-tool-call://agent-run-1/tool-1", block_id: "block-1", tool_call_id: "tool-1", status: "open", reason: "unsupported_schema_version" }],
    }));

    const snapshot = await getAgentRun("agent-run-1");

    expect(snapshot.status).toBe("migration_blocked");
    expect(snapshot.itemId).toBe("agent-run://agent-run-1");
    expect(snapshot.events[0].itemId).toBe("agent-event://agent-run-1/1");
    expect(snapshot.toolCalls[0]).toEqual(expect.objectContaining({
      itemId: "agent-tool-call://agent-run-1/tool-1",
      toolCallId: "tool-1",
      backendOperation: "create_draft_scenario",
    }));
    expect(snapshot.approvals[0]).toEqual(expect.objectContaining({
      itemId: "agent-approval://agent-run-1/approval-1",
      toolCallItemId: "agent-tool-call://agent-run-1/tool-1",
      approvalEpoch: 3,
      status: "approved",
    }));
    expect(snapshot.migrationBlocks[0]).toEqual(expect.objectContaining({
      itemId: "agent-migration-block://agent-run-1/block-1",
      toolCallItemId: "agent-tool-call://agent-run-1/tool-1",
      reason: "unsupported_schema_version",
    }));
  });

  it("maps agent item identities across summary actions resume transcript and export", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("/agents/capabilities")) {
        return jsonResponse({ tools: [{ item_id: "agent-tool-spec://scenario.compose/v1", name: "scenario.compose", version: "v1", summary: "Compose" }] });
      }
      if (url.includes("/agents/runs/run-identity/summary")) {
        return jsonResponse({
          run: { item_id: "agent-run://run-identity", run_id: "run-identity", project_id: 7, status: "completed" },
          assistant_message: "Final reply",
          assistant_visible: true,
          terminal: true,
          can_cancel: false,
          can_resume: false,
          pending_approval_count: 1,
          open_migration_block_count: 0,
          blocking_tool_call_ids: ["tool-1"],
        });
      }
      if (url.includes("/agents/runs/run-identity/actions")) {
        return jsonResponse({
          run_summary: { run: { item_id: "agent-run://run-identity", run_id: "run-identity", project_id: 7, status: "needs_human" } },
          actions: [{
            action_id: "review_approvals",
            label: "Review approvals",
            method: "GET",
            path: "/agents/runs/run-identity/approvals",
            enabled: true,
            resource_ids: ["approval-1"],
            resource_item_ids: ["agent-tool-call://run-identity/tool-1"],
            details: { pending_approval_tool_call_ids: ["tool-1"] },
          }],
          primary_action_ids: ["review_approvals"],
          blocked_reasons: [],
          generated_at: "2026-07-02T00:00:00Z",
        });
      }
      if (url.includes("/agents/runs/run-identity/resume") && init?.method === "POST") {
        return jsonResponse({
          run: { item_id: "agent-run://run-identity", run_id: "run-identity", project_id: 7, status: "running" },
          resumed: false,
          checkpoint_freshness: { result: "too_old", action: "replan_from_latest_safe_state" },
          scheduled_tool_call_ids: [],
          executed_tool_call_ids: ["tool-1"],
          observed_tool_call_ids: ["tool-1", "tool-failed"],
        });
      }
      if (url.includes("/agents/conversations/conv-identity/transcript")) {
        return jsonResponse({
          conversation: { item_id: "agent-conversation://conv-identity", conversation_id: "conv-identity", project_id: 7 },
          turns: [{
            run: { item_id: "agent-run://run-identity", run_id: "run-identity", project_id: 7, conversation_id: "conv-identity", intent: "Prompt", status: "completed" },
            assistant_message: "Final reply",
            assistant_visible: true,
          }],
          context_compactions: [{ item_id: "agent-context-compaction://run-identity/3", run_id: "run-identity", event_seq: 3, event_type: "context.history_compacted" }],
          generated_at: "2026-07-02T00:00:00Z",
        });
      }
      if (url.includes("/agents/conversations/conv-identity/export")) {
        return jsonResponse({
          conversation: { item_id: "agent-conversation://conv-identity", conversation_id: "conv-identity", project_id: 7 },
          turns: [],
          context_compactions: [{ item_id: "agent-context-compaction://run-identity/3", run_id: "run-identity", event_seq: 3 }],
          events_by_run_id: { "run-identity": [{ item_id: "agent-event://run-identity/1", event_seq: 1, event_type: "run.started" }] },
          tool_calls_by_run_id: { "run-identity": [{ item_id: "agent-tool-call://run-identity/tool-1", tool_call_id: "tool-1", tool_name: "scenario.compose", status: "succeeded" }] },
          approvals_by_run_id: { "run-identity": [{ item_id: "agent-approval://run-identity/approval-1", tool_call_item_id: "agent-tool-call://run-identity/tool-1", approval_id: "approval-1" }] },
          migration_blocks_by_run_id: { "run-identity": [{ item_id: "agent-migration-block://run-identity/block-1", tool_call_item_id: "agent-tool-call://run-identity/tool-1", block_id: "block-1" }] },
          export_format: "agent_conversation_export_v1",
          generated_at: "2026-07-02T00:00:00Z",
          derived_from: { source: "backend" },
        });
      }
      return jsonResponse({});
    });

    await expect(getAgentCapabilities()).resolves.toEqual(expect.objectContaining({
      tools: [expect.objectContaining({ itemId: "agent-tool-spec://scenario.compose/v1", name: "scenario.compose" })],
    }));
    await expect(getAgentRunSummary("run-identity")).resolves.toEqual(expect.objectContaining({
      run: expect.objectContaining({ itemId: "agent-run://run-identity" }),
      assistantMessage: "Final reply",
      terminal: true,
      canCancel: false,
      canResume: false,
      pendingApprovalCount: 1,
      blockingToolCallIds: ["tool-1"],
    }));
    await expect(getAgentRunActions("run-identity")).resolves.toEqual(expect.objectContaining({
      primaryActionIds: ["review_approvals"],
      actions: [expect.objectContaining({
        actionId: "review_approvals",
        resourceIds: ["approval-1"],
        resourceItemIds: ["agent-tool-call://run-identity/tool-1"],
      })],
    }));
    await expect(resumeAgentRun("run-identity")).resolves.toEqual(expect.objectContaining({
      run: expect.objectContaining({ itemId: "agent-run://run-identity" }),
      resumed: false,
      checkpointFreshness: { result: "too_old", action: "replan_from_latest_safe_state" },
      scheduledToolCallIds: [],
      executedToolCallIds: ["tool-1"],
      observedToolCallIds: ["tool-1", "tool-failed"],
    }));
    await expect(getAgentConversationTranscript(7, "conv-identity")).resolves.toEqual(expect.objectContaining({
      conversation: expect.objectContaining({ itemId: "agent-conversation://conv-identity" }),
      contextCompactions: [expect.objectContaining({ itemId: "agent-context-compaction://run-identity/3" })],
      runs: [expect.objectContaining({ itemId: "agent-run://run-identity" })],
    }));
    await expect(getAgentConversationExport(7, "conv-identity")).resolves.toEqual(expect.objectContaining({
      exportFormat: "agent_conversation_export_v1",
      eventsByRunId: {
        "run-identity": [expect.objectContaining({ itemId: "agent-event://run-identity/1" })],
      },
      toolCallsByRunId: {
        "run-identity": [expect.objectContaining({ itemId: "agent-tool-call://run-identity/tool-1" })],
      },
      approvalsByRunId: {
        "run-identity": [expect.objectContaining({ itemId: "agent-approval://run-identity/approval-1", toolCallItemId: "agent-tool-call://run-identity/tool-1" })],
      },
      migrationBlocksByRunId: {
        "run-identity": [expect.objectContaining({ itemId: "agent-migration-block://run-identity/block-1", toolCallItemId: "agent-tool-call://run-identity/tool-1" })],
      },
    }));
    expect(fetchMock.mock.calls.map((call) => String(call[0])).join("\n")).toContain(
      "/agents/conversations/conv-identity/export?project_id=7",
    );
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
    expect(String(fetchMock.mock.calls[0][0])).toContain("/agents/runs/agent-run-1/events");
    expect((init?.headers as Headers).get("Authorization")).toBe("Bearer token");
    expect((init?.headers as Headers).get("Accept")).toBe("text/event-stream");
    expect((init?.headers as Headers).get("Last-Event-ID")).toBe("1");
  });

  it("approves tool calls through the dedicated contract endpoint", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({
      approval: {
        approval_id: "approval-1",
        tool_call_id: "tool-1",
        approval_status: "approved",
      },
      lineage: { approval_lineage_id: "lineage-1" },
      tool_call: { tool_call_id: "tool-1", status: "planned" },
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
    expect(approval.approvalId).toBe("approval-1");
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

  it("loads conversation transcript within the selected project scope", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({
      conversation: { conversation_id: "agent-conv-local-1" },
      turns: [{
        run: {
          run_id: "agent-run-1",
          project_id: 7,
          conversation_id: "agent-conv-local-1",
          intent: "第一轮目标",
          status: "completed",
          current_iteration: 1,
          current_step_index: 0,
          max_iterations: 3,
          runtime_snapshot_id: "snap-1",
          last_event_sequence: 4,
          migration_block_count: 0,
          created_at: "2026-06-30T00:00:00Z",
          updated_at: "2026-06-30T00:00:01Z",
        },
        assistant_message: "第一轮回复",
        latest_event_sequence: 4,
        updated_at: "2026-06-30T00:00:01Z",
      }],
    }));

    const transcript = await getAgentConversationTranscript(7, "agent-conv-local-1");

    expect(String(fetchMock.mock.calls[0][0])).toContain(
      "/agents/conversations/agent-conv-local-1/transcript?project_id=7",
    );
    expect(transcript.conversationId).toBe("agent-conv-local-1");
    expect(transcript.runs[0]).toEqual(expect.objectContaining({
      runId: "agent-run-1",
      intent: "第一轮目标",
      status: "completed",
    }));
    expect(transcript.runs[0].events[0]).toEqual(expect.objectContaining({
      event: "model.completed",
      payload: { content: "第一轮回复" },
      sequence: 4,
    }));
  });

  it("lists agent skill metadata without loading skill bodies", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse([
      { name: "general-testing-answer", description: "direct testing Q&A", body: "hidden" },
      { name: "scenario-composition", description: "scenario draft workflow" },
    ]));

    const skills = await getAgentSkills();

    expect(String(fetchMock.mock.calls[0][0])).toContain("/agents/skills");
    expect(skills).toEqual([
      { name: "general-testing-answer", description: "direct testing Q&A" },
      { name: "scenario-composition", description: "scenario draft workflow" },
    ]);
    expect(Object.keys(skills[0])).toEqual(["name", "description"]);
  });

  it("wraps detail and governance endpoints used by the Agent page", async () => {
    const requestBodies: Record<string, unknown> = {};
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("/runs/run-1/reconcile")) {
        return jsonResponse({
          run_id: "run-1",
          processed: 2,
          skipped_backoff: 1,
          reconciled: 1,
          still_uncertain: 0,
          needs_migration: 0,
          manual_intervention: 0,
          tool_call_ids: ["tool-1"],
          skipped_backoff_tool_calls: [{ tool_call_id: "tool-2", next_available_at: "2026-07-02T00:00:00Z" }],
        });
      }
      if (url.includes("/migration-blocks/block-1/resolve")) {
        requestBodies.resolve = init?.body ? JSON.parse(String(init.body)) : undefined;
        return jsonResponse({
          block: { block_id: "block-1", status: "resolved", reason: "schema" },
          checkpoint_freshness: { result: "fresh" },
        });
      }
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
      if (url.includes("/memory-usage-events") && url.includes("/feedback")) {
        requestBodies.memoryFeedback = init?.body ? JSON.parse(String(init.body)) : undefined;
        return jsonResponse({
          attempted: 1,
          processed: 1,
          skipped: 0,
          contradictions_recorded: 0,
          validations_recorded: 1,
          results: [{ usage_event_id: "mem-1", outcome: "useful", processed: true }],
        });
      }
      if (url.includes("/memory-usage-events")) return jsonResponse({ items: [{ usage_event_id: "mem-1", memory_key: "project-standard" }] });
      if (url.includes("/runbook")) {
        return jsonResponse({
          run_id: "run-1",
          run_status: "needs_human",
          recommendations: [{ runbook_id: "resume_after_approval", action: "resume", reason: "after checkpoint", severity: "P2" }],
          runbooks: [{
            runbook_id: "resume_after_approval",
            title: "Resume approved run",
            trigger: "approval_approved",
            severity: "P2",
            safe_api_actions: ["resume"],
          }],
        });
      }
      if (url.includes("/metrics")) return jsonResponse({ tool_success_rate: 0.98 });
      if (url.includes("/alerts")) return jsonResponse({ alerts: [{ alert_id: "alert-1", severity: "P1", summary: "attention", action: "inspect" }], summary: { highest_severity: "P1" } });
      if (url.includes("/release-gates/promotion")) return jsonResponse({ project_id: 7, target_level: "L3", can_promote: false, blockers: [{ name: "readiness", status: "blocked", summary: "attention" }], decision: "blocked" });
      if (url.includes("/release-gates")) return jsonResponse({ project_id: 7, current_level: "L2", status: "attention", checks: [{ name: "monitoring_alerts_clear", status: "attention", summary: "attention" }] });
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
    await expect(sendAgentMemoryFeedback("mem-1", "useful")).resolves.toEqual(expect.objectContaining({ processed: 1, validationsRecorded: 1 }));
    await expect(getAgentRunbook("run-1")).resolves.toEqual(expect.objectContaining({
      runStatus: "needs_human",
      recommendations: [expect.objectContaining({ key: "resume_after_approval", action: "resume", reason: "after checkpoint" })],
      safeActions: [expect.objectContaining({ action: "resume", reason: "Resume approved run" })],
    }));
    await expect(getAgentMetrics(7)).resolves.toEqual({ metrics: { tool_success_rate: 0.98 } });
    await expect(getAgentAlerts(7)).resolves.toEqual([expect.objectContaining({ alertId: "alert-1", message: "attention" })]);
    await expect(getAgentReleaseGates()).resolves.toEqual([expect.objectContaining({ gateId: "L2", checks: [expect.objectContaining({ key: "monitoring_alerts_clear" })] })]);
    await expect(getAgentReleaseGatePromotion(7)).resolves.toEqual(expect.objectContaining({ gateId: "L3", status: "blocked" }));
    await expect(reconcileAgentRun("run-1")).resolves.toEqual(expect.objectContaining({
      runId: "run-1",
      processed: 2,
      skippedBackoff: 1,
      toolCallIds: ["tool-1"],
    }));
    await expect(resolveAgentMigrationBlock("run-1", "block-1")).resolves.toEqual(expect.objectContaining({ blockId: "block-1", status: "resolved" }));
    expect(requestBodies.memoryFeedback).toEqual({ outcome: "useful" });
    expect(requestBodies.resolve).toEqual({});

    const calledUrls = fetchMock.mock.calls.map((call) => String(call[0])).join("\n");
    expect(calledUrls).toContain("/agents/tool-calls/tool-1");
    expect(calledUrls).toContain("/agents/runs/run-1/context-builds");
    expect(calledUrls).toContain("/agents/runs/run-1/reconcile");
    expect(calledUrls).toContain("/agents/runs/run-1/migration-blocks/block-1/resolve");
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
