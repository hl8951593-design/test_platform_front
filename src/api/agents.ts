import { requestWithAuth } from "./client";
export { getAgentRunEventSnapshot, subscribeAgentRunEvents } from "./agentStream";
export type {
  AgentConversationTranscript,
  AgentCapabilities,
  AgentConversationExport,
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
  AgentMemoryFeedbackResult,
  AgentMemoryUsageEvent,
  AgentMigrationBlock,
  AgentMetricsSnapshot,
  AgentReleaseGate,
  AgentRunCreatePayload,
  AgentRunEvent,
  AgentRunEventSnapshot,
  AgentRunAction,
  AgentRunActionState,
  AgentRunFinalSummary,
  AgentRunReconcileResult,
  AgentRunResumeResult,
  AgentRunbook,
  AgentRunQueued,
  AgentRunSnapshot,
  AgentRunStatus,
  AgentRunSummary,
  AgentSkill,
  AgentToolSpec,
  AgentToolCall,
  AgentToolCallStatus,
} from "../types/agents";
import type {
  AgentAlert,
  AgentApproval,
  AgentApprovalDecisionPayload,
  AgentBackendEffectCapability,
  AgentCapabilities,
  AgentContextCompaction,
  AgentConversationExport,
  AgentConversationRead,
  AgentConversationTranscript,
  AgentContextBuild,
  AgentDashboardCheck,
  AgentDashboardSnapshot,
  AgentEffectSubmissionState,
  AgentLoopObservation,
  AgentMemoryFeedbackResult,
  AgentMemoryUsageEvent,
  AgentMigrationBlock,
  AgentMetricsSnapshot,
  AgentReleaseGate,
  AgentRunCreatePayload,
  AgentRunEvent,
  AgentRunFinalSummary,
  AgentRunReconcileResult,
  AgentRunAction,
  AgentRunActionState,
  AgentRunResumeResult,
  AgentRunbook,
  AgentRunQueued,
  AgentRunSnapshot,
  AgentRunStatus,
  AgentRunSummary,
  AgentSkill,
  AgentToolSpec,
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

function asItemRecordMap<T>(value: unknown, mapper: (item: unknown) => T): Record<string, T[]> {
  const source = asRecord(value);
  return Object.fromEntries(Object.entries(source).map(([key, items]) => [key, asArray(items).map(mapper)]));
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
    itemId: optionalString(source.item_id ?? source.itemId),
    runId: String(source.run_id ?? source.runId ?? ""),
    status: String(source.status ?? "queued") as AgentRunStatus,
    runtimeSnapshotId: optionalString(source.runtime_snapshot_id ?? source.runtimeSnapshotId),
    conversationId: optionalString(source.conversation_id ?? source.conversationId),
  };
}

function mapSummary(value: unknown): AgentRunSummary {
  const source = asRecord(value);
  return {
    itemId: optionalString(source.item_id ?? source.itemId),
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
  const payload = asRecord(source.payload_json ?? source.payload ?? source.data);
  return {
    id: optionalString(source.id),
    itemId: optionalString(source.item_id ?? source.itemId),
    schemaVersion: optionalString(source.schema_version ?? source.schemaVersion),
    sequence: optionalNumber(source.event_seq ?? source.sequence),
    runId: optionalString(source.run_id ?? source.runId),
    projectId: optionalNumber(source.project_id ?? source.projectId),
    event: String(source.event_type ?? source.event ?? source.type ?? "message"),
    payload,
    modelResponseItemId: optionalString(source.model_response_item_id ?? source.modelResponseItemId ?? payload.model_response_item_id ?? payload.modelResponseItemId),
    occurredAt: optionalString(source.occurred_at ?? source.occurredAt),
    createdAt: optionalString(source.created_at ?? source.createdAt),
  };
}

function mapContextCompaction(value: unknown): AgentContextCompaction {
  const source = asRecord(value);
  return {
    itemId: optionalString(source.item_id ?? source.itemId),
    runId: optionalString(source.run_id ?? source.runId),
    sequence: optionalNumber(source.event_seq ?? source.sequence),
    eventType: optionalString(source.event_type ?? source.eventType ?? source.event),
    payload: asRecord(source.payload_json ?? source.payload),
    createdAt: optionalString(source.created_at ?? source.createdAt),
  };
}

function mapApproval(value: unknown): AgentApproval {
  const source = asRecord(value);
  return {
    itemId: optionalString(source.item_id ?? source.itemId),
    approvalId: String(source.approval_id ?? source.approvalId ?? source.id ?? ""),
    toolCallId: optionalString(source.tool_call_id ?? source.toolCallId),
    toolCallItemId: optionalString(source.tool_call_item_id ?? source.toolCallItemId),
    status: String(source.approval_status ?? source.status ?? "pending") as AgentApproval["status"],
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
    itemId: optionalString(source.item_id ?? source.itemId),
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
    recentReconcileAttempts: asArray(source.recent_reconcile_attempts ?? source.recentReconcileAttempts).map((attempt) => {
      const record = asRecord(attempt);
      return { ...record, itemId: optionalString(record.item_id ?? record.itemId) };
    }),
    skippedBackoff: source.skipped_backoff_summary || source.skippedBackoff
      ? {
        ...asRecord(source.skipped_backoff_summary ?? source.skippedBackoff),
        itemId: optionalString(asRecord(source.skipped_backoff_summary ?? source.skippedBackoff).item_id ?? asRecord(source.skipped_backoff_summary ?? source.skippedBackoff).itemId),
      }
      : undefined,
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
    itemId: optionalString(source.item_id ?? source.itemId),
    blockId: String(source.block_id ?? source.blockId ?? source.id ?? ""),
    runId: optionalString(source.run_id ?? source.runId),
    toolCallId: optionalString(source.tool_call_id ?? source.toolCallId),
    toolCallItemId: optionalString(source.tool_call_item_id ?? source.toolCallItemId),
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
    itemId: optionalString(source.item_id ?? source.itemId),
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
    itemId: optionalString(source.item_id ?? source.itemId),
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
    itemId: optionalString(source.item_id ?? source.itemId),
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

function mapMemoryFeedbackResult(value: unknown): AgentMemoryFeedbackResult {
  const source = asRecord(value);
  return {
    attempted: Number(source.attempted ?? 0),
    processed: Number(source.processed ?? 0),
    skipped: Number(source.skipped ?? 0),
    contradictionsRecorded: Number(source.contradictions_recorded ?? source.contradictionsRecorded ?? 0),
    validationsRecorded: Number(source.validations_recorded ?? source.validationsRecorded ?? 0),
    results: asArray(source.results),
    raw: source,
  };
}

function mapSnapshot(value: unknown): AgentRunSnapshot {
  const source = asRecord(value);
  return {
    itemId: optionalString(source.item_id ?? source.itemId),
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
    result: source.result_json ?? source.result,
    createdAt: optionalString(source.created_at ?? source.createdAt),
    updatedAt: optionalString(source.updated_at ?? source.updatedAt),
    startedAt: optionalString(source.started_at ?? source.startedAt),
    completedAt: optionalString(source.completed_at ?? source.completedAt),
  };
}

function mapRunFinalSummary(value: unknown): AgentRunFinalSummary {
  const source = asRecord(value);
  const run = source.run ? mapSnapshot(source.run) : undefined;
  return {
    runId: optionalString(source.run_id ?? source.runId ?? run?.runId),
    run,
    status: optionalString(source.status ?? run?.status) as AgentRunStatus | undefined,
    assistantMessage: optionalString(source.assistant_message ?? source.assistantMessage ?? asRecord(source.result).message),
    assistantVisible: source.assistant_visible === undefined && source.assistantVisible === undefined
      ? undefined
      : Boolean(source.assistant_visible ?? source.assistantVisible),
    modelInvoked: source.model_invoked === undefined && source.modelInvoked === undefined
      ? undefined
      : Boolean(source.model_invoked ?? source.modelInvoked),
    terminal: source.terminal === undefined && source.terminal === undefined ? undefined : Boolean(source.terminal),
    canCancel: source.can_cancel === undefined && source.canCancel === undefined ? undefined : Boolean(source.can_cancel ?? source.canCancel),
    canResume: source.can_resume === undefined && source.canResume === undefined ? undefined : Boolean(source.can_resume ?? source.canResume),
    pendingApprovalCount: optionalNumber(source.pending_approval_count ?? source.pendingApprovalCount),
    openMigrationBlockCount: optionalNumber(source.open_migration_block_count ?? source.openMigrationBlockCount),
    blockingToolCallIds: asStringArray(source.blocking_tool_call_ids ?? source.blockingToolCallIds),
    counts: asRecord(source.counts ?? source.event_counts ?? source.eventCounts),
    result: source.result,
    actions: asArray(source.actions),
  };
}

function mapRunAction(value: unknown): AgentRunAction {
  const source = asRecord(value);
  return {
    actionId: String(source.action_id ?? source.actionId ?? ""),
    label: String(source.label ?? source.action_id ?? source.actionId ?? ""),
    method: optionalString(source.method),
    path: optionalString(source.path),
    enabled: Boolean(source.enabled ?? false),
    reason: optionalString(source.reason),
    severity: optionalString(source.severity),
    resourceIds: asStringArray(source.resource_ids ?? source.resourceIds),
    resourceItemIds: asStringArray(source.resource_item_ids ?? source.resourceItemIds),
    details: asRecord(source.details),
  };
}

function mapRunActionState(value: unknown): AgentRunActionState {
  const source = asRecord(value);
  return {
    runSummary: source.run_summary || source.runSummary ? mapRunFinalSummary(source.run_summary ?? source.runSummary) : undefined,
    actions: asArray(source.actions).map(mapRunAction),
    primaryActionIds: asStringArray(source.primary_action_ids ?? source.primaryActionIds),
    blockedReasons: asStringArray(source.blocked_reasons ?? source.blockedReasons),
    generatedAt: optionalString(source.generated_at ?? source.generatedAt),
  };
}

function mapReconcileResult(value: unknown): AgentRunReconcileResult {
  const source = asRecord(value);
  return {
    runId: String(source.run_id ?? source.runId ?? ""),
    processed: Number(source.processed ?? 0),
    skippedBackoff: Number(source.skipped_backoff ?? source.skippedBackoff ?? 0),
    reconciled: Number(source.reconciled ?? 0),
    stillUncertain: Number(source.still_uncertain ?? source.stillUncertain ?? 0),
    needsMigration: Number(source.needs_migration ?? source.needsMigration ?? 0),
    manualIntervention: Number(source.manual_intervention ?? source.manualIntervention ?? 0),
    toolCallIds: asStringArray(source.tool_call_ids ?? source.toolCallIds),
    skippedBackoffToolCalls: asArray(source.skipped_backoff_tool_calls ?? source.skippedBackoffToolCalls),
    raw: source,
  };
}

function mapAgentSkill(value: unknown): AgentSkill {
  const source = asRecord(value);
  const itemId = optionalString(source.item_id ?? source.itemId);
  return {
    ...(itemId ? { itemId } : {}),
    name: String(source.name ?? ""),
    description: String(source.description ?? ""),
  };
}

function mapToolSpec(value: unknown): AgentToolSpec {
  const source = asRecord(value);
  return {
    itemId: optionalString(source.item_id ?? source.itemId),
    name: String(source.name ?? ""),
    version: optionalString(source.version),
    summary: optionalString(source.summary ?? source.description),
    sideEffectClass: optionalString(source.side_effect_class ?? source.sideEffectClass),
    replayPolicy: optionalString(source.replay_policy ?? source.replayPolicy),
    requiredPermissions: source.required_permissions ?? source.requiredPermissions,
    inputSchema: source.input_schema ?? source.inputSchema,
    outputSchema: source.output_schema ?? source.outputSchema,
    backendContract: source.backend_contract ?? source.backendContract,
    schemaHash: optionalString(source.schema_hash ?? source.schemaHash),
    manifestHash: optionalString(source.manifest_hash ?? source.manifestHash),
  };
}

function mapCapabilities(value: unknown): AgentCapabilities {
  const source = asRecord(value);
  return {
    tools: asArray(source.tools ?? source.items ?? value).map(mapToolSpec),
    raw: source,
  };
}

function mapConversation(value: unknown): AgentConversationRead | undefined {
  const source = asRecord(value);
  const conversationId = optionalString(source.conversation_id ?? source.conversationId);
  if (!conversationId) return undefined;
  return {
    itemId: optionalString(source.item_id ?? source.itemId),
    conversationId,
    projectId: optionalNumber(source.project_id ?? source.projectId),
    title: optionalString(source.title),
    createdAt: optionalString(source.created_at ?? source.createdAt),
    updatedAt: optionalString(source.updated_at ?? source.updatedAt),
  };
}

function mapConversationTranscript(value: unknown): AgentConversationTranscript {
  const source = asRecord(value);
  const conversation = mapConversation(source.conversation);
  return {
    conversationId: String(source.conversation_id ?? source.conversationId ?? conversation?.conversationId ?? ""),
    conversation,
    contextCompactions: asArray(source.context_compactions ?? source.contextCompactions).map(mapContextCompaction),
    generatedAt: optionalString(source.generated_at ?? source.generatedAt),
    runs: asArray(source.runs ?? source.turns ?? source.items).map((item) => {
      const record = asRecord(item);
      const snapshot = mapSnapshot(record.run ?? record.snapshot ?? item);
      const assistantMessage = optionalString(record.assistant_message ?? record.assistantMessage);
      const assistantVisible = record.assistant_visible ?? record.assistantVisible;
      if (!snapshot.events.length && assistantMessage && assistantVisible !== false) {
        return {
          ...snapshot,
          events: [{
            id: optionalString(record.item_id ?? record.itemId) ?? `transcript-summary-${snapshot.runId}`,
            itemId: optionalString(record.item_id ?? record.itemId),
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

function mapConversationExport(value: unknown): AgentConversationExport {
  const source = asRecord(value);
  return {
    conversation: mapConversation(source.conversation),
    turns: asArray(source.turns).map(mapRunFinalSummary),
    contextCompactions: asArray(source.context_compactions ?? source.contextCompactions).map(mapContextCompaction),
    eventsByRunId: asItemRecordMap(source.events_by_run_id ?? source.eventsByRunId, mapEvent),
    toolCallsByRunId: asItemRecordMap(source.tool_calls_by_run_id ?? source.toolCallsByRunId, mapToolCall),
    approvalsByRunId: asItemRecordMap(source.approvals_by_run_id ?? source.approvalsByRunId, mapApproval),
    migrationBlocksByRunId: asItemRecordMap(source.migration_blocks_by_run_id ?? source.migrationBlocksByRunId, mapMigrationBlock),
    exportFormat: optionalString(source.export_format ?? source.exportFormat),
    generatedAt: optionalString(source.generated_at ?? source.generatedAt),
    derivedFrom: source.derived_from ?? source.derivedFrom,
  };
}

function mapDashboard(value: unknown): AgentDashboardSnapshot {
  const source = asRecord(value);
  const checks = asArray(source.checks).map((item) => {
    const check = asRecord(item);
    return {
      itemId: optionalString(check.item_id ?? check.itemId),
      key: String(check.key ?? check.name ?? ""),
      status: String(check.status ?? "attention") as AgentDashboardCheck["status"],
      severity: optionalString(check.severity) as AgentDashboardCheck["severity"],
      message: optionalString(check.message ?? check.summary),
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
  const runbooks = asArray(source.runbooks).map((item) => {
    const runbook = asRecord(item);
    return {
      itemId: optionalString(runbook.item_id ?? runbook.itemId),
      runbookId: optionalString(runbook.runbook_id ?? runbook.runbookId ?? runbook.id),
      title: optionalString(runbook.title),
      trigger: optionalString(runbook.trigger),
      severity: optionalString(runbook.severity),
      steps: asStringArray(runbook.steps),
      safeApiActions: asStringArray(runbook.safe_api_actions ?? runbook.safeApiActions),
    };
  });
  const safeActions = asArray(source.safe_actions ?? source.safeActions).map((item) => {
    const action = asRecord(item);
    return {
      itemId: optionalString(action.item_id ?? action.itemId),
      key: optionalString(action.key),
      label: optionalString(action.label),
      action: optionalString(action.action),
      targetId: optionalString(action.target_id ?? action.targetId),
      reason: optionalString(action.reason),
    };
  });
  const runbookSafeActions = runbooks.flatMap((runbook) => (runbook.safeApiActions ?? []).map((action) => ({
    key: `${runbook.runbookId ?? runbook.title ?? "runbook"}:${action}`,
    label: action,
    action,
    reason: runbook.title,
  })));
  return {
    itemId: optionalString(source.item_id ?? source.itemId),
    runId: optionalString(source.run_id ?? source.runId),
    runStatus: optionalString(source.run_status ?? source.runStatus),
    diagnosis: optionalString(source.diagnosis ?? source.run_status ?? source.runStatus),
    recommendations: asArray(source.recommendations).map((item) => {
      const recommendation = asRecord(item);
      return {
        itemId: optionalString(recommendation.item_id ?? recommendation.itemId),
        key: optionalString(recommendation.key ?? recommendation.runbook_id ?? recommendation.runbookId),
        label: optionalString(recommendation.label ?? recommendation.title ?? recommendation.action),
        action: optionalString(recommendation.action),
        severity: optionalString(recommendation.severity),
        reason: optionalString(recommendation.reason),
      };
    }),
    safeActions: safeActions.length ? safeActions : runbookSafeActions,
    runbooks,
    raw: source,
  };
}

function mapReleaseGate(value: unknown): AgentReleaseGate {
  const source = asRecord(value);
  const statusValue = source.status ?? source.decision ?? (
    source.can_promote === false || source.canPromote === false ? "blocked" : undefined
  );
  const gateId = source.gate_id
    ?? source.gateId
    ?? source.target_level
    ?? source.targetLevel
    ?? source.current_level
    ?? source.currentLevel;
  const checks = asArray(source.checks ?? source.blockers).map((item) => {
    const check = asRecord(item);
    return {
      itemId: optionalString(check.item_id ?? check.itemId),
      key: String(check.key ?? check.name ?? check.gate_id ?? check.gateId ?? ""),
      status: String(check.status ?? "attention") as AgentDashboardCheck["status"],
      severity: optionalString(check.severity) as AgentDashboardCheck["severity"],
      message: optionalString(check.message ?? check.summary ?? check.reason),
    };
  });
  const summary = source.summary !== undefined
    ? asRecord(source.summary)
    : {
      projectId: source.project_id ?? source.projectId,
      currentLevel: source.current_level ?? source.currentLevel,
      targetLevel: source.target_level ?? source.targetLevel,
      canPromote: source.can_promote ?? source.canPromote,
      decision: source.decision,
    };
  return {
    itemId: optionalString(source.item_id ?? source.itemId),
    gateId: optionalString(gateId),
    status: optionalString(statusValue),
    checks,
    summary,
    raw: source,
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

export async function getAgentRunActions(runId: string) {
  const result = await requestWithAuth<BackendRecord>(`/agents/runs/${runId}/actions`);
  return mapRunActionState(result);
}

export async function getAgentConversationTranscript(projectId: number, conversationId: string) {
  const result = await requestWithAuth<BackendRecord>(
    `/agents/conversations/${encodeURIComponent(conversationId)}/transcript${queryString({ project_id: projectId })}`,
  );
  return mapConversationTranscript(result);
}

export async function getAgentConversationExport(projectId: number, conversationId: string) {
  const result = await requestWithAuth<BackendRecord>(
    `/agents/conversations/${encodeURIComponent(conversationId)}/export${queryString({ project_id: projectId })}`,
  );
  return mapConversationExport(result);
}

export async function getAgentCapabilities() {
  const result = await requestWithAuth<unknown>("/agents/capabilities");
  return mapCapabilities(result);
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
  const source = asRecord(result);
  if (source.run || source.resumed !== undefined || source.checkpoint_freshness !== undefined || source.checkpointFreshness !== undefined) {
    return {
      run: mapSnapshot(source.run),
      resumed: Boolean(source.resumed ?? false),
      checkpointFreshness: asRecord(source.checkpoint_freshness ?? source.checkpointFreshness),
      scheduledToolCallIds: asStringArray(source.scheduled_tool_call_ids ?? source.scheduledToolCallIds),
      executedToolCallIds: asStringArray(source.executed_tool_call_ids ?? source.executedToolCallIds),
      observedToolCallIds: asStringArray(source.observed_tool_call_ids ?? source.observedToolCallIds),
    } satisfies AgentRunResumeResult;
  }
  return {
    run: mapSnapshot(result),
    resumed: true,
    checkpointFreshness: {},
    scheduledToolCallIds: [],
    executedToolCallIds: [],
    observedToolCallIds: [],
  } satisfies AgentRunResumeResult;
}

export async function reconcileAgentRun(runId: string) {
  const result = await requestWithAuth<BackendRecord>(`/agents/runs/${runId}/reconcile`, { method: "POST" });
  return mapReconcileResult(result);
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
  return mapApproval(asRecord(result).approval ?? result);
}

export async function rejectAgentToolCall(toolCallId: string, payload?: AgentApprovalDecisionPayload) {
  const result = await requestWithAuth<BackendRecord>(`/agents/tool-calls/${toolCallId}/reject`, {
    method: "POST",
    body: toApprovalDecisionRequest(payload),
  });
  return mapApproval(asRecord(result).approval ?? result);
}

export async function getAgentMigrationBlocks(runId: string) {
  const result = await requestWithAuth<unknown>(`/agents/runs/${runId}/migration-blocks`);
  return asArray(asRecord(result).items ?? result).map(mapMigrationBlock);
}

export async function resolveAgentMigrationBlock(runId: string, blockId: string) {
  const result = await requestWithAuth<BackendRecord>(`/agents/runs/${runId}/migration-blocks/${blockId}/resolve`, {
    method: "POST",
    body: JSON.stringify({}),
  });
  return mapMigrationBlock(asRecord(result).block ?? result);
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
    body: JSON.stringify({ outcome: feedback }),
  });
  return mapMemoryFeedbackResult(result);
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
  const source = asRecord(result);
  return asArray(source.alerts ?? source.items ?? result).map((item) => {
    const source = asRecord(item);
    return {
      itemId: optionalString(source.item_id ?? source.itemId),
      alertId: optionalString(source.alert_id ?? source.alertId ?? source.id),
      severity: optionalString(source.severity) as AgentAlert["severity"],
      status: optionalString(source.status),
      message: optionalString(source.message ?? source.summary ?? source.action),
      action: optionalString(source.action),
      details: asRecord(source.details),
      createdAt: optionalString(source.created_at ?? source.createdAt),
    };
  });
}

export async function getAgentReleaseGates() {
  const result = await requestWithAuth<unknown>("/agents/release-gates");
  const source = asRecord(result);
  if (Array.isArray(source.items)) return source.items.map(mapReleaseGate);
  if (Array.isArray(result)) return result.map(mapReleaseGate);
  return Object.keys(source).length ? [mapReleaseGate(result)] : [];
}

export async function getAgentReleaseGatePromotion(projectId: number, targetLevel = "L3") {
  const result = await requestWithAuth<BackendRecord>(`/agents/release-gates/promotion${queryString({ project_id: projectId, target_level: targetLevel })}`);
  return mapReleaseGate(result);
}
