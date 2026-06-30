export type AgentRunStatus =
  | "queued"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled"
  | "migration_blocked"
  | "needs_human";

export type AgentConnectionState = "idle" | "connecting" | "streaming" | "reconnecting" | "closed" | "error";

export interface AgentSkill {
  name: string;
  description: string;
}

export type AgentLoopStep =
  | "assistant_response"
  | "tool_planning"
  | "tool_request_repair"
  | "required_tool_repair"
  | "final_summary"
  | "intent_capability_guard"
  | "tool_execution";

export type AgentEventType =
  | "context.history_compacted"
  | "model.started"
  | "model.delta"
  | "model.markdown_normalized"
  | "model.stream_interrupted"
  | "model.completed"
  | "model.tool_request_detected"
  | "model.tool_request_invalid"
  | "model.tool_request_repaired"
  | "model.tool_request_repair_failed"
  | "model.tool_request_stream_suppressed"
  | "model.required_tool_missing"
  | "model.required_tool_repaired"
  | "model.required_tool_repair_failed"
  | "tool.planned"
  | "tool.running"
  | "tool.completed"
  | "tool.result_observed"
  | "run.queued"
  | "run.started"
  | "run.completed"
  | "run.failed";

export interface AgentEventPayload extends Record<string, unknown> {
  iteration_id?: string | number;
  model_call_id?: string;
  modelCallId?: string;
  loop_step?: AgentLoopStep | string;
  loopStep?: AgentLoopStep | string;
  tool_call_id?: string;
  toolCallId?: string;
  decision_reason?: string;
  decisionReason?: string;
  content?: string;
  replace_content?: boolean;
  replaceContent?: boolean;
  error_code?: string;
  errorCode?: string;
}

export type AgentToolCallStatus =
  | "planned"
  | "leased"
  | "running_pre_effect"
  | "effect_sent"
  | "uncertain"
  | "reconciling"
  | "succeeded"
  | "failed"
  | "failed_retryable"
  | "obsolete"
  | "needs_migration"
  | "manual_intervention";

export type AgentEffectSubmissionState =
  | "none"
  | "send_intent_recorded"
  | "transport_sent_observed"
  | "backend_accepted"
  | "effect_committed"
  | "unknown";

export type AgentApprovalStatus = "pending" | "approved" | "rejected" | "expired" | "revoked" | "superseded";
export type AgentMigrationBlockStatus = "open" | "resolved" | "cancelled";
export type AgentBackendEffectCapability =
  | "receipt_first"
  | "idempotency_index_only"
  | "legacy_reconcile_only"
  | "legacy_no_receipt";

export interface AgentRunCreatePayload {
  projectId: number;
  conversationId: string;
  intent: string;
  maxIterations: number;
  autoComplete: boolean;
}

export interface AgentRunQueued {
  runId: string;
  status: AgentRunStatus;
  runtimeSnapshotId?: string;
  conversationId?: string;
}

export interface AgentRunSummary {
  runId: string;
  projectId: number;
  conversationId?: string;
  title?: string;
  intent: string;
  status: AgentRunStatus;
  runtimeSnapshotId?: string;
  pinned?: boolean;
  localOnly?: boolean;
  unavailable?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface AgentRunEvent {
  id?: string;
  sequence?: number;
  runId?: string;
  event: AgentEventType | (string & {});
  payload: AgentEventPayload;
  createdAt?: string;
}

export interface AgentRunEventSnapshot {
  events: AgentRunEvent[];
  nextAfterSequence?: number;
  terminal: boolean;
}

export interface AgentToolCall {
  toolCallId: string;
  runId?: string;
  stepIndex?: number;
  attemptIndex?: number;
  toolName: string;
  toolVersion?: string;
  status: AgentToolCallStatus;
  executionPhase?: string;
  effectSubmissionState: AgentEffectSubmissionState;
  idempotencyKey?: string;
  resolvedSideEffectClass?: string;
  resolvedReplayPolicy?: string;
  backendName?: string;
  backendOperation?: string;
  backendContractVersion?: string;
  backendEffectCapability?: AgentBackendEffectCapability;
  inputJsonRedacted?: unknown;
  outputJsonRedacted?: unknown;
  requiredPermissionsJson?: unknown;
  currentApproval?: AgentApproval;
  recentReconcileAttempts?: unknown[];
  evidenceRefs?: unknown[];
  approvalRequired?: boolean;
  outputSummary?: unknown;
  recoveryDecision?: string;
  errorCode?: string;
  errorMessage?: string;
  updatedAt?: string;
}

export interface AgentApproval {
  approvalId: string;
  toolCallId?: string;
  status: AgentApprovalStatus;
  inputHash?: string;
  runtimeSnapshotId?: string;
  resourceScopeHash?: string;
  approvalLineageId?: string;
  approvalEpoch?: number;
  riskReason?: string;
  permissionScope?: string;
  expiresAt?: string;
  supersededByToolCallId?: string;
}

export interface AgentApprovalDecisionPayload {
  inputHash?: string;
  runtimeSnapshotId?: string;
  resourceScopeHash?: string;
  approvalLineageId?: string;
  approvalEpoch?: number;
  reason?: string;
}

export interface AgentMigrationBlock {
  blockId: string;
  runId?: string;
  toolCallId?: string;
  status: AgentMigrationBlockStatus;
  blockType?: string;
  reason: string;
  backendContractVersion?: string;
  unsupportedSchema?: string;
  freshnessGateResult?: string;
  createdAt?: string;
  resolvedAt?: string;
}

export interface AgentContextBuild {
  contextBuildId: string;
  runId?: string;
  status?: string;
  degradationReason?: string;
  requiredEvidence?: unknown[];
  snapshotSummary?: unknown;
  createdAt?: string;
}

export interface AgentLoopObservation {
  observationId: string;
  runId?: string;
  rootCause?: string;
  stopReason?: string;
  mitigation?: string;
  causalChain?: unknown[];
  createdAt?: string;
}

export interface AgentMemoryUsageEvent {
  usageEventId: string;
  runId?: string;
  memoryKey?: string;
  source?: string;
  usageType?: string;
  riskLevel?: string;
  evidence?: unknown;
  feedback?: "useful" | "misleading" | "stale";
  createdAt?: string;
}

export interface AgentRunbook {
  runId?: string;
  diagnosis?: string;
  recommendations?: Array<{
    key?: string;
    label?: string;
    action?: string;
    severity?: string;
    reason?: string;
  }>;
  safeActions?: Array<{
    key?: string;
    label?: string;
    action?: string;
    targetId?: string;
    reason?: string;
  }>;
  raw?: Record<string, unknown>;
}

export interface AgentRunSnapshot {
  runId: string;
  projectId: number;
  userId?: number;
  conversationId?: string;
  intent: string;
  status: AgentRunStatus;
  currentIteration: number;
  currentStepIndex: number;
  maxIterations: number;
  autoComplete?: boolean;
  runtimeSnapshotId?: string;
  lastCheckpointId?: number;
  lastEventSequence?: number;
  migrationBlockCount: number;
  blockingToolCallIds: string[];
  migrationReasonPrimary?: string;
  errorCode?: string;
  errorMessage?: string;
  events: AgentRunEvent[];
  toolCalls: AgentToolCall[];
  approvals: AgentApproval[];
  migrationBlocks: AgentMigrationBlock[];
  contextBuilds: AgentContextBuild[];
  loopObservations: AgentLoopObservation[];
  result?: unknown;
  createdAt?: string;
  updatedAt?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface AgentRunFinalSummary {
  runId?: string;
  status?: AgentRunStatus;
  assistantMessage?: string;
  assistantVisible?: boolean;
  modelInvoked?: boolean;
  counts?: Record<string, unknown>;
  result?: unknown;
  actions?: unknown[];
}

export interface AgentConversationTranscript {
  conversationId: string;
  runs: AgentRunSnapshot[];
}

export interface AgentDashboardCheck {
  key: string;
  status: "pass" | "attention" | "blocked";
  severity?: "P0" | "P1" | "P2";
  message?: string;
}

export interface AgentDashboardSnapshot {
  readiness: "pass" | "attention" | "blocked";
  checks: AgentDashboardCheck[];
  alertSummary?: Record<string, unknown>;
  metrics?: Record<string, unknown>;
  releaseGate?: Record<string, unknown>;
}

export interface AgentMetricsSnapshot {
  metrics: Record<string, unknown>;
}

export interface AgentAlert {
  alertId?: string;
  severity?: "P0" | "P1" | "P2";
  status?: string;
  message?: string;
  createdAt?: string;
}

export interface AgentReleaseGate {
  gateId?: string;
  status?: string;
  checks?: AgentDashboardCheck[];
  summary?: Record<string, unknown>;
}
