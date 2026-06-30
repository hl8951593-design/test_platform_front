import { requestWithAuth } from "./client";
export { getAgentRunEventSnapshot, subscribeAgentRunEvents } from "./agentStream";
export type {
  AgentConversationTranscript,
  AgentEventPayload,
  AgentEventType,
  AgentAlert,
  AgentApproval,
  AgentApprovalDecisionPayload,
  AgentBackendEffectCapability,
  AgentConnectionState,
  AgentContextBuild,
  AgentDashboardCheck,
  AgentDashboardSnapshot,
  AgentEffectSubmissionState,
  AgentLoopObservation,
  AgentMemoryUsageEvent,
  AgentMigrationBlock,
  AgentMetricsSnapshot,
  AgentReleaseGate,
  AgentRunCreatePayload,
  AgentRunEvent,
  AgentRunEventSnapshot,
  AgentRunFinalSummary,
  AgentRunbook,
  AgentRunQueued,
  AgentRunSnapshot,
  AgentRunStatus,
  AgentRunSummary,
  AgentSkill,
  AgentToolCall,
  AgentToolCallStatus,
} from "../types/agents";
import type {
  AgentAlert,
  AgentApproval,
  AgentApprovalDecisionPayload,
  AgentBackendEffectCapability,
  AgentConversationTranscript,
  AgentContextBuild,
  AgentDashboardCheck,
  AgentDashboardSnapshot,
  AgentEffectSubmissionState,
  AgentLoopObservation,
  AgentMemoryUsageEvent,
  AgentMigrationBlock,
  AgentMetricsSnapshot,
  AgentReleaseGate,
  AgentRunCreatePayload,
  AgentRunEvent,
  AgentRunFinalSummary,
  AgentRunbook,
  AgentRunQueued,
  AgentRunSnapshot,
  AgentRunStatus,
  AgentRunSummary,
  AgentSkill,
  AgentToolCall,
  AgentToolCallStatus,
} from "../types/agents";

type BackendRecord = Record<string, unknown>;

function asRecord(value: unknown): BackendRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as BackendRecord : {};
}

function asArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

function optionalString(value: unknown) {
  return value === undefined || value === null || value === "" ? undefined : String(value);
}

function optionalNumber(value: unknown) {
  const next = Number(value);
  return Number.isFinite(next) ? next : undefined;
}

function maybeBody(value: Record<string, unknown>) {
  const body = Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
  return Object.keys(body).length ? JSON.stringify(body) : undefined;
}

function queryString(params: Record<string, string | number | boolean | undefined>) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== "") search.set(key, String(value));
  });
  const query = search.toString();
  return query ? `?${query}` : "";
}

function toCreateRequest(payload: AgentRunCreatePayload) {
  return {
    project_id: payload.projectId,
    conversation_id: payload.conversationId,
    intent: payload.intent,
    max_iterations: payload.maxIterations,
    auto_complete: payload.autoComplete,
  };
}

function toApprovalDecisionRequest(payload?: AgentApprovalDecisionPayload) {
  if (!payload) return undefined;
  return maybeBody({
    input_hash: payload.inputHash,
    runtime_snapshot_id: payload.runtimeSnapshotId,
    resource_scope_hash: payload.resourceScopeHash,
    approval_lineage_id: payload.approvalLineageId,
    approval_epoch: payload.approvalEpoch,
    reason: payload.reason,
  });
}

function mapQueued(value: unknown): AgentRunQueued {
  const source = asRecord(value);
  return {
    runId: String(source.run_id ?? source.runId ?? ""),
    status: String(source.status ?? "queued") as AgentRunStatus,
    runtimeSnapshotId: optionalString(source.runtime_snapshot_id ?? source.runtimeSnapshotId),
    conversationId: optionalString(source.conversation_id ?? source.conversationId),
  };
}

function mapSummary(value: unknown): AgentRunSummary {
  const source = asRecord(value);
  return {
    runId: String(source.run_id ?? source.runId ?? ""),
    projectId: Number(source.project_id ?? source.projectId ?? 0),
    conversationId: optionalString(source.conversation_id ?? source.conversationId),
    title: optionalString(source.title),
    intent: String(source.intent ?? ""),
    status: String(source.status ?? "queued") as AgentRunStatus,
    runtimeSnapshotId: optionalString(source.runtime_snapshot_id ?? source.runtimeSnapshotId),
    pinned: Boolean(source.pinned ?? false),
    localOnly: Boolean(source.local_only ?? source.localOnly ?? false),
    unavailable: Boolean(source.unavailable ?? false),
    updatedAt: optionalString(source.updated_at ?? source.updatedAt),
    createdAt: optionalString(source.created_at ?? source.createdAt),
  };
}

function mapEvent(value: unknown): AgentRunEvent {
  const source = asRecord(value);
  return {
    id: optionalString(source.id),
    sequence: optionalNumber(source.event_seq ?? source.sequence),
    runId: optionalString(source.run_id ?? source.runId),
    event: String(source.event_type ?? source.event ?? source.type ?? "message"),
    payload: asRecord(source.payload_json ?? source.payload ?? source.data),
    createdAt: optionalString(source.created_at ?? source.createdAt),
  };
}

function mapApproval(value: unknown): AgentApproval {
  const source = asRecord(value);
  return {
    approvalId: String(source.approval_id ?? source.approvalId ?? source.id ?? ""),
    toolCallId: optionalString(source.tool_call_id ?? source.toolCallId),
    status: String(source.status ?? "pending") as AgentApproval["status"],
    inputHash: optionalString(source.input_hash ?? source.inputHash),
    runtimeSnapshotId: optionalString(source.runtime_snapshot_id ?? source.runtimeSnapshotId),
    resourceScopeHash: optionalString(source.resource_scope_hash ?? source.resourceScopeHash),
    approvalLineageId: optionalString(source.approval_lineage_id ?? source.approvalLineageId),
    approvalEpoch: optionalNumber(source.approval_epoch ?? source.approvalEpoch),
    riskReason: optionalString(source.risk_reason ?? source.riskReason),
    permissionScope: optionalString(source.permission_scope ?? source.permissionScope),
    expiresAt: optionalString(source.expires_at ?? source.expiresAt),
    supersededByToolCallId: optionalString(source.superseded_by_tool_call_id ?? source.supersededByToolCallId),
  };
}

function mapToolCall(value: unknown): AgentToolCall {
  const source = asRecord(value);
  return {
    toolCallId: String(source.tool_call_id ?? source.toolCallId ?? source.id ?? ""),
    runId: optionalString(source.run_id ?? source.runId),
    stepIndex: optionalNumber(source.step_index ?? source.stepIndex),
    attemptIndex: optionalNumber(source.attempt_index ?? source.attemptIndex),
    toolName: String(source.tool_name ?? source.toolName ?? ""),
    toolVersion: optionalString(source.tool_version ?? source.toolVersion),
    status: String(source.status ?? "planned") as AgentToolCallStatus,
    executionPhase: optionalString(source.execution_phase ?? source.executionPhase),
    effectSubmissionState: String(source.effect_submission_state ?? source.effectSubmissionState ?? "none") as AgentEffectSubmissionState,
    idempotencyKey: optionalString(source.idempotency_key ?? source.idempotencyKey),
    resolvedSideEffectClass: optionalString(source.resolved_side_effect_class ?? source.resolvedSideEffectClass),
    resolvedReplayPolicy: optionalString(source.resolved_replay_policy ?? source.resolvedReplayPolicy),
    backendName: optionalString(source.backend_name ?? source.backendName),
    backendOperation: optionalString(source.backend_operation ?? source.backendOperation),
    backendContractVersion: optionalString(source.backend_contract_version ?? source.backendContractVersion),
    backendEffectCapability: optionalString(source.backend_effect_capability ?? source.backendEffectCapability) as AgentBackendEffectCapability | undefined,
    inputJsonRedacted: source.input_json_redacted ?? source.inputJsonRedacted,
    outputJsonRedacted: source.output_json_redacted ?? source.outputJsonRedacted,
    requiredPermissionsJson: source.required_permissions_json ?? source.requiredPermissionsJson,
    currentApproval: source.current_approval ? mapApproval(source.current_approval) : undefined,
    recentReconcileAttempts: asArray(source.recent_reconcile_attempts ?? source.recentReconcileAttempts),
    evidenceRefs: asArray(source.evidence_refs_json ?? source.evidenceRefs),
    approvalRequired: Boolean(source.approval_required ?? source.approvalRequired ?? false),
    outputSummary: source.output_summary ?? source.outputSummary,
    recoveryDecision: optionalString(source.recovery_decision ?? source.recoveryDecision),
    errorCode: optionalString(source.error_code ?? source.errorCode),
    errorMessage: optionalString(source.error_message ?? source.errorMessage),
    updatedAt: optionalString(source.updated_at ?? source.updatedAt),
  };
}

function mapMigrationBlock(value: unknown): AgentMigrationBlock {
  const source = asRecord(value);
  return {
    blockId: String(source.block_id ?? source.blockId ?? source.id ?? ""),
    runId: optionalString(source.run_id ?? source.runId),
    toolCallId: optionalString(source.tool_call_id ?? source.toolCallId),
    status: String(source.status ?? "open") as AgentMigrationBlock["status"],
    blockType: optionalString(source.block_type ?? source.blockType),
    reason: String(source.reason ?? source.message ?? ""),
    backendContractVersion: optionalString(source.backend_contract_version ?? source.backendContractVersion),
    unsupportedSchema: optionalString(source.unsupported_schema ?? source.unsupportedSchema),
    freshnessGateResult: optionalString(source.freshness_gate_result ?? source.freshnessGateResult),
    createdAt: optionalString(source.created_at ?? source.createdAt),
    resolvedAt: optionalString(source.resolved_at ?? source.resolvedAt),
  };
}

function mapContextBuild(value: unknown): AgentContextBuild {
  const source = asRecord(value);
  return {
    contextBuildId: String(source.context_build_id ?? source.contextBuildId ?? source.id ?? ""),
    runId: optionalString(source.run_id ?? source.runId),
    status: optionalString(source.status),
    degradationReason: optionalString(source.degradation_reason ?? source.degradationReason),
    requiredEvidence: asArray(source.required_evidence_json ?? source.requiredEvidence),
    snapshotSummary: source.snapshot_summary ?? source.snapshotSummary,
    createdAt: optionalString(source.created_at ?? source.createdAt),
  };
}

function mapLoopObservation(value: unknown): AgentLoopObservation {
  const source = asRecord(value);
  return {
    observationId: String(source.observation_id ?? source.observationId ?? source.id ?? ""),
    runId: optionalString(source.run_id ?? source.runId),
    rootCause: optionalString(source.root_cause ?? source.rootCause),
    stopReason: optionalString(source.stop_reason ?? source.stopReason),
    mitigation: optionalString(source.mitigation),
    causalChain: asArray(source.causal_chain_json ?? source.causalChain),
    createdAt: optionalString(source.created_at ?? source.createdAt),
  };
}

function mapMemoryUsage(value: unknown): AgentMemoryUsageEvent {
  const source = asRecord(value);
  return {
    usageEventId: String(source.usage_event_id ?? source.usageEventId ?? source.id ?? ""),
    runId: optionalString(source.run_id ?? source.runId),
    memoryKey: optionalString(source.memory_key ?? source.memoryKey),
    source: optionalString(source.source),
    usageType: optionalString(source.usage_type ?? source.usageType),
    riskLevel: optionalString(source.risk_level ?? source.riskLevel),
    evidence: source.evidence_json ?? source.evidence,
    feedback: optionalString(source.feedback) as AgentMemoryUsageEvent["feedback"],
    createdAt: optionalString(source.created_at ?? source.createdAt),
  };
}

function mapSnapshot(value: unknown): AgentRunSnapshot {
  const source = asRecord(value);
  return {
    runId: String(source.run_id ?? source.runId ?? ""),
    projectId: Number(source.project_id ?? source.projectId ?? 0),
    userId: optionalNumber(source.user_id ?? source.userId),
    conversationId: optionalString(source.conversation_id ?? source.conversationId),
    intent: String(source.intent ?? ""),
    status: String(source.status ?? "queued") as AgentRunStatus,
    currentIteration: Number(source.current_iteration ?? source.currentIteration ?? 0),
    currentStepIndex: Number(source.current_step_index ?? source.currentStepIndex ?? 0),
    maxIterations: Number(source.max_iterations ?? source.maxIterations ?? 0),
    autoComplete: Boolean(source.auto_complete ?? source.autoComplete ?? false),
    runtimeSnapshotId: optionalString(source.runtime_snapshot_id ?? source.runtimeSnapshotId),
    lastCheckpointId: optionalNumber(source.last_checkpoint_id ?? source.lastCheckpointId),
    lastEventSequence: optionalNumber(source.last_event_sequence ?? source.lastEventSequence),
    migrationBlockCount: Number(source.migration_block_count ?? source.migrationBlockCount ?? 0),
    blockingToolCallIds: asStringArray(source.blocking_tool_call_ids_json ?? source.blockingToolCallIds),
    migrationReasonPrimary: optionalString(source.migration_reason_primary ?? source.migrationReasonPrimary),
    errorCode: optionalString(source.error_code ?? source.errorCode),
    errorMessage: optionalString(source.error_message ?? source.errorMessage),
    events: asArray(source.events).map(mapEvent),
    toolCalls: asArray(source.tool_calls ?? source.toolCalls).map(mapToolCall),
    approvals: asArray(source.approvals).map(mapApproval),
    migrationBlocks: asArray(source.migration_blocks ?? source.migrationBlocks).map(mapMigrationBlock),
    contextBuilds: asArray(source.context_builds ?? source.contextBuilds).map(mapContextBuild),
    loopObservations: asArray(source.loop_observations ?? source.loopObservations).map(mapLoopObservation),
    result: source.result,
    createdAt: optionalString(source.created_at ?? source.createdAt),
    updatedAt: optionalString(source.updated_at ?? source.updatedAt),
    startedAt: optionalString(source.started_at ?? source.startedAt),
    completedAt: optionalString(source.completed_at ?? source.completedAt),
  };
}

function mapRunFinalSummary(value: unknown): AgentRunFinalSummary {
  const source = asRecord(value);
  return {
    runId: optionalString(source.run_id ?? source.runId),
    status: optionalString(source.status) as AgentRunStatus | undefined,
    assistantMessage: optionalString(source.assistant_message ?? source.assistantMessage ?? asRecord(source.result).message),
    assistantVisible: source.assistant_visible === undefined && source.assistantVisible === undefined
      ? undefined
      : Boolean(source.assistant_visible ?? source.assistantVisible),
    modelInvoked: source.model_invoked === undefined && source.modelInvoked === undefined
      ? undefined
      : Boolean(source.model_invoked ?? source.modelInvoked),
    counts: asRecord(source.counts ?? source.event_counts ?? source.eventCounts),
    result: source.result,
    actions: asArray(source.actions),
  };
}

function mapAgentSkill(value: unknown): AgentSkill {
  const source = asRecord(value);
  return {
    name: String(source.name ?? ""),
    description: String(source.description ?? ""),
  };
}

function mapConversationTranscript(value: unknown): AgentConversationTranscript {
  const source = asRecord(value);
  const conversation = asRecord(source.conversation);
  return {
    conversationId: String(source.conversation_id ?? source.conversationId ?? conversation.conversation_id ?? conversation.conversationId ?? ""),
    runs: asArray(source.runs ?? source.turns ?? source.items).map((item) => {
      const record = asRecord(item);
      const snapshot = mapSnapshot(record.run ?? record.snapshot ?? item);
      const assistantMessage = optionalString(record.assistant_message ?? record.assistantMessage);
      if (!snapshot.events.length && assistantMessage) {
        return {
          ...snapshot,
          events: [{
            id: `transcript-summary-${snapshot.runId}`,
            sequence: optionalNumber(record.latest_event_sequence ?? record.latestEventSequence),
            runId: snapshot.runId,
            event: "model.completed",
            payload: { content: assistantMessage },
            createdAt: optionalString(record.updated_at ?? record.updatedAt ?? snapshot.updatedAt),
          }],
        };
      }
      return snapshot;
    }),
  };
}

function mapDashboard(value: unknown): AgentDashboardSnapshot {
  const source = asRecord(value);
  const checks = asArray(source.checks).map((item) => {
    const check = asRecord(item);
    return {
      key: String(check.key ?? ""),
      status: String(check.status ?? "attention") as AgentDashboardCheck["status"],
      severity: optionalString(check.severity) as AgentDashboardCheck["severity"],
      message: optionalString(check.message),
    };
  });
  return {
    readiness: String(source.readiness ?? "attention") as AgentDashboardSnapshot["readiness"],
    checks,
    alertSummary: asRecord(source.alert_summary ?? source.alertSummary),
    metrics: asRecord(source.metrics),
    releaseGate: asRecord(source.release_gate ?? source.releaseGate),
  };
}

function mapRunbook(value: unknown): AgentRunbook {
  const source = asRecord(value);
  return {
    runId: optionalString(source.run_id ?? source.runId),
    diagnosis: optionalString(source.diagnosis),
    recommendations: asArray(source.recommendations).map((item) => {
      const recommendation = asRecord(item);
      return {
        key: optionalString(recommendation.key),
        label: optionalString(recommendation.label),
        action: optionalString(recommendation.action),
        severity: optionalString(recommendation.severity),
        reason: optionalString(recommendation.reason),
      };
    }),
    safeActions: asArray(source.safe_actions ?? source.safeActions).map((item) => {
      const action = asRecord(item);
      return {
        key: optionalString(action.key),
        label: optionalString(action.label),
        action: optionalString(action.action),
        targetId: optionalString(action.target_id ?? action.targetId),
        reason: optionalString(action.reason),
      };
    }),
    raw: source,
  };
}

function mapReleaseGate(value: unknown): AgentReleaseGate {
  const source = asRecord(value);
  return {
    gateId: optionalString(source.gate_id ?? source.gateId),
    status: optionalString(source.status),
    checks: asArray(source.checks).map((item) => {
      const check = asRecord(item);
      return {
        key: String(check.key ?? ""),
        status: String(check.status ?? "attention") as AgentDashboardCheck["status"],
        severity: optionalString(check.severity) as AgentDashboardCheck["severity"],
        message: optionalString(check.message),
      };
    }),
    summary: asRecord(source.summary),
  };
}

export async function createAgentRun(payload: AgentRunCreatePayload) {
  const result = await requestWithAuth<BackendRecord>("/agents/runs", {
    method: "POST",
    body: JSON.stringify(toCreateRequest(payload)),
  });
  return mapQueued(result);
}

export async function listAgentRuns(projectId?: number) {
  const query = projectId ? `?project_id=${projectId}` : "";
  const result = await requestWithAuth<unknown>(`/agents/runs${query}`);
  if (Array.isArray(result)) return result.map(mapSummary);
  const source = asRecord(result);
  if (Array.isArray(source.items)) return source.items.map(mapSummary);
  if (Array.isArray(source.runs)) return source.runs.map(mapSummary);
  return [];
}

export async function getAgentRun(runId: string) {
  const result = await requestWithAuth<BackendRecord>(`/agents/runs/${runId}`);
  return mapSnapshot(result);
}

export async function getAgentRunSummary(runId: string) {
  const result = await requestWithAuth<BackendRecord>(`/agents/runs/${runId}/summary`);
  return mapRunFinalSummary(result);
}

export async function getAgentConversationTranscript(projectId: number, conversationId: string) {
  const result = await requestWithAuth<BackendRecord>(
    `/agents/conversations/${encodeURIComponent(conversationId)}/transcript${queryString({ project_id: projectId })}`,
  );
  return mapConversationTranscript(result);
}

export async function getAgentSkills() {
  const result = await requestWithAuth<unknown>("/agents/skills");
  return asArray(asRecord(result).items ?? result).map(mapAgentSkill);
}

export async function cancelAgentRun(runId: string) {
  const result = await requestWithAuth<BackendRecord>(`/agents/runs/${runId}/cancel`, { method: "POST" });
  return mapSnapshot(result);
}

export async function resumeAgentRun(runId: string) {
  const result = await requestWithAuth<BackendRecord>(`/agents/runs/${runId}/resume`, { method: "POST" });
  return mapSnapshot(result);
}

export async function reconcileAgentRun(runId: string) {
  const result = await requestWithAuth<BackendRecord>(`/agents/runs/${runId}/reconcile`, { method: "POST" });
  return mapSnapshot(result);
}

export async function getAgentToolCall(toolCallId: string) {
  const result = await requestWithAuth<BackendRecord>(`/agents/tool-calls/${toolCallId}`);
  return mapToolCall(result);
}

export async function getAgentApprovals(runId: string) {
  const result = await requestWithAuth<unknown>(`/agents/runs/${runId}/approvals`);
  return asArray(asRecord(result).items ?? result).map(mapApproval);
}

export async function approveAgentToolCall(toolCallId: string, payload?: AgentApprovalDecisionPayload) {
  const result = await requestWithAuth<BackendRecord>(`/agents/tool-calls/${toolCallId}/approve`, {
    method: "POST",
    body: toApprovalDecisionRequest(payload),
  });
  return mapApproval(result);
}

export async function rejectAgentToolCall(toolCallId: string, payload?: AgentApprovalDecisionPayload) {
  const result = await requestWithAuth<BackendRecord>(`/agents/tool-calls/${toolCallId}/reject`, {
    method: "POST",
    body: toApprovalDecisionRequest(payload),
  });
  return mapApproval(result);
}

export async function getAgentMigrationBlocks(runId: string) {
  const result = await requestWithAuth<unknown>(`/agents/runs/${runId}/migration-blocks`);
  return asArray(asRecord(result).items ?? result).map(mapMigrationBlock);
}

export async function resolveAgentMigrationBlock(runId: string, blockId: string) {
  const result = await requestWithAuth<BackendRecord>(`/agents/runs/${runId}/migration-blocks/${blockId}/resolve`, { method: "POST" });
  return mapMigrationBlock(result);
}

export async function getAgentContextBuilds(runId: string) {
  const result = await requestWithAuth<unknown>(`/agents/runs/${runId}/context-builds`);
  return asArray(asRecord(result).items ?? result).map(mapContextBuild);
}

export async function getAgentLoopObservations(runId: string) {
  const result = await requestWithAuth<unknown>(`/agents/runs/${runId}/loop-observations`);
  return asArray(asRecord(result).items ?? result).map(mapLoopObservation);
}

export async function getAgentMemoryUsageEvents(runId: string) {
  const result = await requestWithAuth<unknown>(`/agents/memory-usage-events?run_id=${encodeURIComponent(runId)}`);
  return asArray(asRecord(result).items ?? result).map(mapMemoryUsage);
}

export async function sendAgentMemoryFeedback(usageEventId: string, feedback: AgentMemoryUsageEvent["feedback"]) {
  const result = await requestWithAuth<BackendRecord>(`/agents/memory-usage-events/${usageEventId}/feedback`, {
    method: "POST",
    body: JSON.stringify({ feedback }),
  });
  return mapMemoryUsage(result);
}

export async function getAgentRunbook(runId: string) {
  const result = await requestWithAuth<BackendRecord>(`/agents/runs/${runId}/runbook`);
  return mapRunbook(result);
}

export async function getAgentDashboard(projectId: number) {
  const result = await requestWithAuth<BackendRecord>(`/agents/dashboard${queryString({ project_id: projectId })}`);
  return mapDashboard(result);
}

export async function getAgentMetrics(projectId: number): Promise<AgentMetricsSnapshot> {
  const result = await requestWithAuth<BackendRecord>(`/agents/metrics${queryString({ project_id: projectId })}`);
  return { metrics: asRecord(result.metrics ?? result) };
}

export async function getAgentAlerts(projectId: number) {
  const result = await requestWithAuth<unknown>(`/agents/alerts${queryString({ project_id: projectId })}`);
  return asArray(asRecord(result).items ?? result).map((item) => {
    const source = asRecord(item);
    return {
      alertId: optionalString(source.alert_id ?? source.alertId ?? source.id),
      severity: optionalString(source.severity) as AgentAlert["severity"],
      status: optionalString(source.status),
      message: optionalString(source.message),
      createdAt: optionalString(source.created_at ?? source.createdAt),
    };
  });
}

export async function getAgentReleaseGates() {
  const result = await requestWithAuth<unknown>("/agents/release-gates");
  return asArray(asRecord(result).items ?? result).map(mapReleaseGate);
}

export async function getAgentReleaseGatePromotion(projectId: number, targetLevel = "L3") {
  const result = await requestWithAuth<BackendRecord>(`/agents/release-gates/promotion${queryString({ project_id: projectId, target_level: targetLevel })}`);
  return mapReleaseGate(result);
}
