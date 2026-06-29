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
  event: string;
  payload: Record<string, unknown>;
  createdAt?: string;
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
