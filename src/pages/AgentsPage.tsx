import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  approveAgentToolCall,
  cancelAgentRun,
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
  reconcileAgentRun,
  rejectAgentToolCall,
  resolveAgentMigrationBlock,
  resumeAgentRun,
  sendAgentMemoryFeedback,
  subscribeAgentRunEvents,
  type AgentApproval,
  type AgentAlert,
  type AgentConnectionState,
  type AgentContextBuild,
  type AgentDashboardSnapshot,
  type AgentLoopObservation,
  type AgentMemoryUsageEvent,
  type AgentMigrationBlock,
  type AgentMetricsSnapshot,
  type AgentReleaseGate,
  type AgentRunEvent,
  type AgentRunbook,
  type AgentRunSummary,
  type AgentRunSnapshot,
  type AgentRunStatus,
  type AgentToolCall,
} from "../api/agents";
import { Icon } from "../components/Icon";

const terminalRunStatuses: AgentRunStatus[] = ["completed", "failed", "cancelled"];
const AGENT_HISTORY_LIMIT = 24;
const agentHistoryStoragePrefix = "agent_conversation_history";

type InspectorTab = "run" | "tool" | "approval" | "memory" | "runbook" | "dashboard";
type AgentRunbookSafeAction = NonNullable<AgentRunbook["safeActions"]>[number];
type MarkdownBlock =
  | { type: "paragraph"; content: string }
  | { type: "list"; items: string[] };
type AgentTranscriptItem =
  | { type: "assistant"; key: string; content: string; meta: string }
  | { type: "event"; key: string; event: AgentRunEvent }
  | { type: "tool"; key: string; toolCall: AgentToolCall; index: number };

function createLocalConversationId() {
  if (crypto.randomUUID) return `agent-conv-local-${crypto.randomUUID()}`;
  return `agent-conv-local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

const statusLabels: Record<string, string> = {
  queued: "排队中",
  running: "运行中",
  paused: "已暂停",
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消",
  migration_blocked: "迁移阻断",
  needs_human: "等待人工",
  planned: "已计划",
  leased: "已领取",
  running_pre_effect: "执行前",
  effect_sent: "已发送",
  uncertain: "待恢复",
  reconciling: "恢复中",
  succeeded: "成功",
  failed_retryable: "可重试失败",
  obsolete: "已废弃",
  needs_migration: "需迁移",
  manual_intervention: "人工介入",
  pending: "待审批",
  approved: "已批准",
  rejected: "已拒绝",
  expired: "已过期",
  revoked: "已撤销",
  superseded: "已替换",
  open: "未处理",
  resolved: "已处理",
  pass: "通过",
  attention: "关注",
  blocked: "阻断",
};

function statusLabel(status?: string) {
  return status ? statusLabels[status] ?? status : "未知";
}

function statusTone(status?: string) {
  if (!status) return "neutral";
  if (["completed", "succeeded", "approved", "resolved", "pass"].includes(status)) return "success";
  if (["failed", "rejected", "blocked", "manual_intervention"].includes(status)) return "danger";
  if (["migration_blocked", "needs_migration", "uncertain", "expired", "attention"].includes(status)) return "warning";
  if (["running", "queued", "leased", "running_pre_effect", "effect_sent", "reconciling", "pending"].includes(status)) return "info";
  return "neutral";
}

function stringifyValue(value: unknown) {
  if (value === undefined || value === null || value === "") return "-";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value, null, 2);
}

function parseMarkdownBlocks(markdown: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  let paragraph: string[] = [];
  let listItems: string[] = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push({ type: "paragraph", content: paragraph.join(" ") });
    paragraph = [];
  };
  const flushList = () => {
    if (!listItems.length) return;
    blocks.push({ type: "list", items: listItems });
    listItems = [];
  };

  markdown.replace(/\r\n/g, "\n").split("\n").forEach((line) => {
    const listMatch = line.match(/^\s*[-*]\s+(.+)$/);
    if (!line.trim()) {
      flushParagraph();
      flushList();
      return;
    }
    if (listMatch) {
      flushParagraph();
      listItems.push(listMatch[1]);
      return;
    }
    flushList();
    paragraph.push(line.trim());
  });

  flushParagraph();
  flushList();
  return blocks;
}

function renderInlineMarkdown(text: string, keyPrefix: string) {
  const nodes: ReactNode[] = [];
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text))) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    const token = match[0];
    const key = `${keyPrefix}-${match.index}`;
    if (token.startsWith("`")) {
      nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    } else {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    }
    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

function MarkdownContent({ content }: { content: string }) {
  const blocks = parseMarkdownBlocks(content);
  if (!blocks.length) return <p>-</p>;

  return (
    <div className="agent-markdown">
      {blocks.map((block, blockIndex) => {
        if (block.type === "list") {
          return (
            <ul key={`list-${blockIndex}`}>
              {block.items.map((item, itemIndex) => (
                <li key={`${blockIndex}-${itemIndex}`}>{renderInlineMarkdown(item, `${blockIndex}-${itemIndex}`)}</li>
              ))}
            </ul>
          );
        }
        return <p key={`paragraph-${blockIndex}`}>{renderInlineMarkdown(block.content, `p-${blockIndex}`)}</p>;
      })}
    </div>
  );
}

function eventKey(event: AgentRunEvent, index: number) {
  return `${event.sequence ?? event.id ?? index}-${event.event}`;
}

function eventIdentity(event: AgentRunEvent) {
  const identity = event.sequence ?? event.id;
  return identity === undefined ? undefined : `${identity}-${event.event}`;
}

function eventText(event: AgentRunEvent) {
  const content = event.payload.content ?? event.payload.delta ?? event.payload.message ?? event.payload.text;
  return content === undefined || content === null ? "" : String(content);
}

function isAssistantDelta(event: AgentRunEvent) {
  return ["assistant.delta", "assistant.message", "model.delta", "model.message"].includes(event.event);
}

function mergeAssistantEvent(previous: AgentRunEvent, next: AgentRunEvent): AgentRunEvent {
  return {
    ...previous,
    payload: {
      ...previous.payload,
      content: undefined,
      message: undefined,
      text: undefined,
      delta: `${eventText(previous)}${eventText(next)}`,
    },
  };
}

function appendCompactedEvents(current: AgentRunEvent[], incoming: AgentRunEvent[]) {
  if (!incoming.length) return current;
  const nextEvents = [...current];
  incoming.forEach((event) => {
    const previous = nextEvents[nextEvents.length - 1];
    if (previous && isAssistantDelta(previous) && isAssistantDelta(event)) {
      nextEvents[nextEvents.length - 1] = mergeAssistantEvent(previous, event);
      return;
    }
    nextEvents.push(event);
  });
  return nextEvents;
}

function isRunLifecycleEvent(event: AgentRunEvent) {
  return event.event.startsWith("run.");
}

function eventToolCallId(event: AgentRunEvent) {
  const id = event.payload.tool_call_id ?? event.payload.toolCallId ?? event.payload.id;
  return typeof id === "string" ? id : undefined;
}

function buildAgentTranscriptItems(events: AgentRunEvent[], toolCalls: AgentToolCall[]) {
  const toolCallsById = new Map(toolCalls.map((toolCall) => [toolCall.toolCallId, toolCall]));
  const renderedToolCallIds = new Set<string>();
  const items: AgentTranscriptItem[] = [];
  let assistantBuffer = "";
  let assistantStartKey = "";
  let assistantMeta = "";

  const flushAssistant = () => {
    if (!assistantBuffer) return;
    items.push({
      type: "assistant",
      key: assistantStartKey || `assistant-${items.length}`,
      content: assistantBuffer,
      meta: assistantMeta || "assistant",
    });
    assistantBuffer = "";
    assistantStartKey = "";
    assistantMeta = "";
  };

  events.forEach((event, index) => {
    if (isRunLifecycleEvent(event)) return;

    if (isAssistantDelta(event)) {
      if (!assistantBuffer) {
        assistantStartKey = eventKey(event, index);
        assistantMeta = event.sequence ? `#${event.sequence} 起 · Agent 回复` : "Agent 回复";
      }
      assistantBuffer += eventText(event);
      return;
    }

    flushAssistant();
    if (event.event.startsWith("tool.")) {
      const toolCallId = eventToolCallId(event);
      const toolCall = toolCallId ? toolCallsById.get(toolCallId) : undefined;
      if (toolCall && !renderedToolCallIds.has(toolCall.toolCallId)) {
        renderedToolCallIds.add(toolCall.toolCallId);
        items.push({ type: "tool", key: `tool-${toolCall.toolCallId}`, toolCall, index: renderedToolCallIds.size });
        return;
      }
    }
    items.push({ type: "event", key: eventKey(event, index), event });
  });
  flushAssistant();

  toolCalls.forEach((toolCall) => {
    if (renderedToolCallIds.has(toolCall.toolCallId)) return;
    renderedToolCallIds.add(toolCall.toolCallId);
    items.push({ type: "tool", key: `tool-${toolCall.toolCallId}`, toolCall, index: renderedToolCallIds.size });
  });

  return items;
}

function toolCallActivityLabel(status: AgentToolCall["status"]) {
  if (status === "succeeded") return "已完成工具调用";
  if (status === "failed" || status === "failed_retryable") return "工具调用失败";
  if (status === "uncertain") return "工具结果待确认";
  if (status === "needs_migration") return "工具需要迁移";
  if (status === "manual_intervention") return "需要人工处理工具调用";
  if (["leased", "running_pre_effect", "effect_sent", "reconciling"].includes(status)) return "正在运行工具";
  return "工具调用";
}

function formatThinkingElapsed(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function getCurrentUserIsAdmin() {
  const rawUser = localStorage.getItem("auth_user");
  if (!rawUser) return false;
  try {
    const user = JSON.parse(rawUser) as Record<string, unknown>;
    return user.is_admin === true || user.isAdmin === true;
  } catch {
    return false;
  }
}

export function AgentsPage({ projectId }: { projectId?: number }) {
  const [conversationId, setConversationId] = useState(() => createLocalConversationId());
  const [prompt, setPrompt] = useState("");
  const [maxIterations, setMaxIterations] = useState(3);
  const [autoComplete, setAutoComplete] = useState(false);
  const [activeRunId, setActiveRunId] = useState("");
  const [run, setRun] = useState<AgentRunSnapshot | null>(null);
  const [runHistory, setRunHistory] = useState<AgentRunSummary[]>([]);
  const [dashboard, setDashboard] = useState<AgentDashboardSnapshot | null>(null);
  const [metrics, setMetrics] = useState<AgentMetricsSnapshot | null>(null);
  const [alerts, setAlerts] = useState<AgentAlert[]>([]);
  const [releaseGates, setReleaseGates] = useState<AgentReleaseGate[]>([]);
  const [promotionGate, setPromotionGate] = useState<AgentReleaseGate | null>(null);
  const [runbook, setRunbook] = useState<AgentRunbook | null>(null);
  const [memoryUsage, setMemoryUsage] = useState<AgentMemoryUsageEvent[]>([]);
  const [events, setEvents] = useState<AgentRunEvent[]>([]);
  const [selectedToolCallId, setSelectedToolCallId] = useState("");
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("run");
  const [historySearch, setHistorySearch] = useState("");
  const [historyStatus, setHistoryStatus] = useState<"all" | AgentRunStatus>("all");
  const [isCreating, setIsCreating] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [isLoadingRun, setIsLoadingRun] = useState(false);
  const [isActing, setIsActing] = useState(false);
  const [streamState, setStreamState] = useState<AgentConnectionState>("idle");
  const [, setMessage] = useState("");
  const [error, setError] = useState("");
  const [thinkingStartedAt, setThinkingStartedAt] = useState<number | null>(null);
  const [thinkingElapsedMs, setThinkingElapsedMs] = useState(0);
  const lastEventIdRef = useRef<number | undefined>(undefined);
  const abortRef = useRef<AbortController | null>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const historySearchRef = useRef<HTMLInputElement>(null);
  const eventKeysRef = useRef<Set<string>>(new Set());
  const pendingEventsRef = useRef<AgentRunEvent[]>([]);
  const eventFlushFrameRef = useRef<number | null>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const streamStateRef = useRef<AgentConnectionState>("idle");

  const pendingApprovals = useMemo(() => run?.approvals.filter((approval) => approval.status === "pending") ?? [], [run]);
  const openMigrationBlocks = useMemo(() => run?.migrationBlocks.filter((block) => block.status === "open") ?? [], [run]);
  const canCreate = Boolean(projectId && prompt.trim() && !isCreating);
  const canCancel = Boolean(run && !terminalRunStatuses.includes(run.status));
  const canResume = Boolean(run && ["paused", "needs_human", "migration_blocked"].includes(run.status));
  const activeToolCall = useMemo(() => {
    if (!run?.toolCalls.length) return null;
    return run.toolCalls.find((toolCall) => toolCall.toolCallId === selectedToolCallId) ?? run.toolCalls[0];
  }, [run?.toolCalls, selectedToolCallId]);
  const filteredHistory = useMemo(() => {
    const query = historySearch.trim().toLowerCase();
    return [...runHistory].sort((left, right) => {
      if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
      return String(right.updatedAt ?? right.createdAt ?? "").localeCompare(String(left.updatedAt ?? left.createdAt ?? ""));
    }).filter((item) => {
      const matchesQuery = !query || `${item.title ?? ""} ${item.intent} ${item.runId} ${item.conversationId ?? ""}`.toLowerCase().includes(query);
      const matchesStatus = historyStatus === "all" || item.status === historyStatus;
      return matchesQuery && matchesStatus;
    });
  }, [historySearch, historyStatus, runHistory]);
  const transcriptItems = useMemo(() => buildAgentTranscriptItems(events, run?.toolCalls ?? []), [events, run?.toolCalls]);
  const hasAgentResponse = useMemo(() => transcriptItems.some((item) => item.type === "assistant" || item.type === "tool"), [transcriptItems]);
  const isWaitingForAgentResponse = Boolean(
    thinkingStartedAt &&
    run &&
    !error &&
    !hasAgentResponse &&
    !terminalRunStatuses.includes(run.status),
  );

  const historyStorageKey = `${agentHistoryStoragePrefix}_${projectId ?? "global"}`;

  const clearPendingEventBatch = useCallback(() => {
    pendingEventsRef.current = [];
    if (eventFlushFrameRef.current !== null) {
      window.cancelAnimationFrame(eventFlushFrameRef.current);
      eventFlushFrameRef.current = null;
    }
  }, []);

  const replaceEvents = useCallback((nextEvents: AgentRunEvent[]) => {
    clearPendingEventBatch();
    eventKeysRef.current = new Set(nextEvents.map(eventIdentity).filter((key): key is string => Boolean(key)));
    setEvents(appendCompactedEvents([], nextEvents));
  }, [clearPendingEventBatch]);

  const updateStreamState = useCallback((nextState: AgentConnectionState) => {
    if (streamStateRef.current === nextState) return;
    streamStateRef.current = nextState;
    setStreamState(nextState);
  }, []);

  const resetConversation = useCallback(() => {
    setConversationId(createLocalConversationId());
    setActiveRunId("");
    setRun(null);
    replaceEvents([]);
    setPrompt("");
    setRunbook(null);
    setMemoryUsage([]);
    setSelectedToolCallId("");
    setMessage("");
    setError("");
    setThinkingStartedAt(null);
    setThinkingElapsedMs(0);
    lastEventIdRef.current = undefined;
    window.setTimeout(() => promptRef.current?.focus(), 0);
  }, [replaceEvents]);

  const appendEvent = useCallback((event: AgentRunEvent) => {
    if (event.sequence !== undefined) lastEventIdRef.current = event.sequence;
    const identity = eventIdentity(event);
    if (identity && eventKeysRef.current.has(identity)) return;
    if (identity) eventKeysRef.current.add(identity);
    pendingEventsRef.current.push(event);
    if (eventFlushFrameRef.current !== null) return;
    eventFlushFrameRef.current = window.requestAnimationFrame(() => {
      eventFlushFrameRef.current = null;
      const nextEvents = pendingEventsRef.current;
      pendingEventsRef.current = [];
      setEvents((current) => appendCompactedEvents(current, nextEvents));
    });
  }, []);

  const loadRun = useCallback(async (runId: string) => {
    if (!runId) return;
    setIsLoadingRun(true);
    setError("");
    try {
      const snapshot = await getAgentRun(runId);
      setRun(snapshot);
      replaceEvents(snapshot.events);
      if (snapshot.conversationId) setConversationId(snapshot.conversationId);
      if (snapshot.toolCalls[0]) setSelectedToolCallId((current) => current || snapshot.toolCalls[0].toolCallId);
      lastEventIdRef.current = snapshot.events.reduce<number | undefined>((last, event) => {
        if (event.sequence === undefined) return last;
        return last === undefined ? event.sequence : Math.max(last, event.sequence);
      }, undefined);
      void getAgentRunbook(runId).then(setRunbook).catch(() => setRunbook(null));
      void getAgentMemoryUsageEvents(runId).then(setMemoryUsage).catch(() => setMemoryUsage([]));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Agent Run 加载失败");
      setRunHistory((current) => current.map((item) => item.runId === runId ? { ...item, unavailable: true } : item));
    } finally {
      setIsLoadingRun(false);
    }
  }, [replaceEvents]);

  const rememberRun = useCallback((summary: AgentRunSummary) => {
    setRunHistory((current) => {
      const previous = current.find((item) => item.runId === summary.runId);
      const next = [
        { ...previous, ...summary, title: previous?.title ?? summary.title, pinned: previous?.pinned ?? summary.pinned },
        ...current.filter((item) => item.runId !== summary.runId),
      ].slice(0, AGENT_HISTORY_LIMIT);
      localStorage.setItem(historyStorageKey, JSON.stringify(next));
      return next;
    });
  }, [historyStorageKey]);

  const updateHistory = useCallback((updater: (current: AgentRunSummary[]) => AgentRunSummary[]) => {
    setRunHistory((current) => {
      const next = updater(current).slice(0, AGENT_HISTORY_LIMIT);
      localStorage.setItem(historyStorageKey, JSON.stringify(next));
      return next;
    });
  }, [historyStorageKey]);

  useEffect(() => {
    setHistoryLoading(true);
    const raw = localStorage.getItem(historyStorageKey);
    if (raw) {
      try {
        setRunHistory(JSON.parse(raw) as AgentRunSummary[]);
      } catch {
        setRunHistory([]);
      }
    } else {
      setRunHistory([]);
    }
    setHistoryLoading(false);
  }, [historyStorageKey, projectId]);

  useEffect(() => {
    let ignore = false;
    if (!projectId) {
      setDashboard(null);
      setMetrics(null);
      setAlerts([]);
      setReleaseGates([]);
      setPromotionGate(null);
      return () => {
        ignore = true;
      };
    }
    const canLoadGlobalReleaseGates = getCurrentUserIsAdmin();
    void Promise.allSettled([
      getAgentDashboard(projectId),
      getAgentMetrics(projectId),
      getAgentAlerts(projectId),
      canLoadGlobalReleaseGates ? getAgentReleaseGates() : Promise.resolve([]),
      getAgentReleaseGatePromotion(projectId),
    ])
      .then(([dashboardResult, metricsResult, alertsResult, releaseGatesResult, promotionResult]) => {
        if (ignore) return;
        if (dashboardResult.status === "fulfilled") setDashboard(dashboardResult.value);
        if (metricsResult.status === "fulfilled") setMetrics(metricsResult.value);
        if (alertsResult.status === "fulfilled") setAlerts(alertsResult.value);
        if (releaseGatesResult.status === "fulfilled") setReleaseGates(releaseGatesResult.value);
        if (promotionResult.status === "fulfilled") setPromotionGate(promotionResult.value);
      })
    return () => {
      ignore = true;
    };
  }, [projectId]);

  useEffect(() => {
    abortRef.current?.abort();
    updateStreamState("idle");
    if (!activeRunId || run?.status && terminalRunStatuses.includes(run.status)) return;

    const controller = new AbortController();
    abortRef.current = controller;
    const reconnectLimit = 3;

    const connect = async () => {
      for (let attempt = 0; attempt <= reconnectLimit && !controller.signal.aborted; attempt += 1) {
        updateStreamState(attempt === 0 ? "connecting" : "reconnecting");
        try {
          await subscribeAgentRunEvents(
            activeRunId,
            (event) => {
              if (!controller.signal.aborted) updateStreamState("streaming");
              appendEvent(event);
            },
            {
              lastEventId: lastEventIdRef.current,
              signal: controller.signal,
            },
          );
          if (!controller.signal.aborted) updateStreamState("closed");
          return;
        } catch (nextError) {
          if (controller.signal.aborted) return;
          if (attempt >= reconnectLimit) {
            updateStreamState("error");
            setMessage(nextError instanceof Error ? nextError.message : "Agent 事件流连接失败");
            return;
          }
          await new Promise((resolve) => window.setTimeout(resolve, 300 * (attempt + 1)));
        }
      }
    };

    void connect();

    return () => controller.abort();
  }, [activeRunId, appendEvent, run?.status, updateStreamState]);

  const refreshRun = useCallback(async () => {
    if (activeRunId) await loadRun(activeRunId);
  }, [activeRunId, loadRun]);

  const mergeRunData = useCallback((patch: Partial<AgentRunSnapshot>) => {
    setRun((current) => current ? { ...current, ...patch } : current);
  }, []);

  const refreshGovernanceData = useCallback(async (runId: string, eventName?: string) => {
    const tasks: Array<Promise<void>> = [];
    if (!eventName || eventName.startsWith("approval.")) {
      tasks.push(getAgentApprovals(runId).then((approvals) => mergeRunData({ approvals })).catch(() => undefined));
    }
    if (!eventName || eventName.startsWith("migration.")) {
      tasks.push(getAgentMigrationBlocks(runId).then((migrationBlocks) => mergeRunData({ migrationBlocks })).catch(() => undefined));
    }
    if (!eventName || eventName.startsWith("context.")) {
      tasks.push(getAgentContextBuilds(runId).then((contextBuilds) => mergeRunData({ contextBuilds })).catch(() => undefined));
    }
    if (!eventName || eventName.startsWith("loop.")) {
      tasks.push(getAgentLoopObservations(runId).then((loopObservations) => mergeRunData({ loopObservations })).catch(() => undefined));
    }
    if (!eventName || eventName.startsWith("memory.")) {
      tasks.push(getAgentMemoryUsageEvents(runId).then(setMemoryUsage).catch(() => undefined));
    }
    await Promise.all(tasks);
  }, [mergeRunData]);

  useEffect(() => {
    const latest = events[events.length - 1];
    if (!activeRunId || !latest) return;

    if (latest.event.startsWith("tool.")) {
      const toolCallId = typeof latest.payload.tool_call_id === "string" ? latest.payload.tool_call_id : undefined;
      if (toolCallId) {
        void getAgentToolCall(toolCallId)
          .then((toolCall) => {
            setSelectedToolCallId(toolCall.toolCallId);
            setRun((current) => {
              if (!current) return current;
              const nextToolCalls = [
                toolCall,
                ...current.toolCalls.filter((item) => item.toolCallId !== toolCall.toolCallId),
              ];
              return { ...current, toolCalls: nextToolCalls };
            });
          })
          .catch(() => undefined);
      }
    }

    if (latest.event.startsWith("run.")) {
      void getAgentRun(activeRunId).then((snapshot) => {
        setRun(snapshot);
        rememberRun({
          runId: snapshot.runId,
          projectId: snapshot.projectId,
          conversationId: snapshot.conversationId,
          intent: snapshot.intent,
          status: snapshot.status,
          runtimeSnapshotId: snapshot.runtimeSnapshotId,
          localOnly: true,
          updatedAt: snapshot.updatedAt,
          createdAt: snapshot.createdAt,
        });
      }).catch(() => undefined);
    }

    if (/^(approval|migration|context|loop|memory)\./.test(latest.event)) {
      void refreshGovernanceData(activeRunId, latest.event);
    }
  }, [activeRunId, events, refreshGovernanceData, rememberRun]);

  const handleCreateRun = async () => {
    const intent = prompt.trim();
    if (!projectId) {
      setError("请先选择项目，再创建 Agent Run");
      return;
    }
    if (!intent) return;
    setIsCreating(true);
    setError("");
    setMessage("");
    try {
      const queued = await createAgentRun({
        projectId,
        conversationId,
        intent,
        maxIterations,
        autoComplete,
      });
      setActiveRunId(queued.runId);
      setPrompt("");
      setThinkingStartedAt(Date.now());
      setThinkingElapsedMs(0);
      setRun({
        runId: queued.runId,
        projectId,
        conversationId: queued.conversationId ?? conversationId,
        intent,
        status: queued.status,
        currentIteration: 0,
        currentStepIndex: 0,
        maxIterations,
        autoComplete,
        runtimeSnapshotId: queued.runtimeSnapshotId,
        migrationBlockCount: 0,
        blockingToolCallIds: [],
        events: [],
        toolCalls: [],
        approvals: [],
        migrationBlocks: [],
        contextBuilds: [],
        loopObservations: [],
      });
      replaceEvents([]);
      rememberRun({
        runId: queued.runId,
        projectId,
        conversationId: queued.conversationId ?? conversationId,
        intent,
        status: queued.status,
        runtimeSnapshotId: queued.runtimeSnapshotId,
        localOnly: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      await loadRun(queued.runId);
    } catch (nextError) {
      setThinkingStartedAt(null);
      setThinkingElapsedMs(0);
      setError(nextError instanceof Error ? nextError.message : "Agent Run 创建失败");
    } finally {
      setIsCreating(false);
    }
  };

  const runAction = async (action: () => Promise<AgentRunSnapshot>, successMessage: string) => {
    setIsActing(true);
    setError("");
    try {
      const snapshot = await action();
      setRun(snapshot);
      setMessage(successMessage);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "操作失败，请稍后重试");
    } finally {
      setIsActing(false);
    }
  };

  const renameHistoryItem = (item: AgentRunSummary) => {
    const nextTitle = window.prompt("重命名本地对话", item.title || item.intent || item.runId);
    if (nextTitle === null) return;
    updateHistory((current) => current.map((entry) => entry.runId === item.runId ? { ...entry, title: nextTitle.trim() || entry.intent } : entry));
  };

  const deleteHistoryItem = (item: AgentRunSummary) => {
    updateHistory((current) => current.filter((entry) => entry.runId !== item.runId));
    if (item.runId === activeRunId) {
      setActiveRunId("");
      setRun(null);
      replaceEvents([]);
      setRunbook(null);
      setMemoryUsage([]);
    }
  };

  const togglePinHistoryItem = (item: AgentRunSummary) => {
    updateHistory((current) => current.map((entry) => entry.runId === item.runId ? { ...entry, pinned: !entry.pinned } : entry));
  };

  const exportConversation = (item: AgentRunSummary) => {
    const exportPayload = {
      conversation_id: item.conversationId,
      run_id: item.runId,
      title: item.title,
      intent: item.intent,
      status: item.status,
      exported_at: new Date().toISOString(),
      events: item.runId === run?.runId ? events : [],
      tool_calls: item.runId === run?.runId ? run.toolCalls : [],
    };
    const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${item.conversationId || item.runId}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const handleApprovalAction = async (approval: AgentApproval, action: "approve" | "reject") => {
    if (!approval.toolCallId) return;
    setIsActing(true);
    setError("");
    try {
      const casPayload = {
        inputHash: approval.inputHash,
        runtimeSnapshotId: approval.runtimeSnapshotId,
        resourceScopeHash: approval.resourceScopeHash,
        approvalLineageId: approval.approvalLineageId,
        approvalEpoch: approval.approvalEpoch,
      };
      await (action === "approve"
        ? approveAgentToolCall(approval.toolCallId, casPayload)
        : rejectAgentToolCall(approval.toolCallId, casPayload));
      setMessage(action === "approve" ? "审批已批准，等待后端继续执行。" : "审批已拒绝。");
      await refreshRun();
    } catch (nextError) {
      const fallback = "审批操作失败；如果后端返回 409，表示审批已过期或上下文已变化，请刷新后重试。";
      setError(nextError instanceof Error ? nextError.message || fallback : fallback);
    } finally {
      setIsActing(false);
    }
  };

  const handleResolveBlock = async (block: AgentMigrationBlock) => {
    if (!run) return;
    setIsActing(true);
    setError("");
    try {
      await resolveAgentMigrationBlock(run.runId, block.blockId);
      setMessage("迁移阻断已提交解除，恢复前仍需等待 Freshness Gate 结果。");
      await refreshRun();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "迁移阻断处理失败");
    } finally {
      setIsActing(false);
    }
  };

  const handleRunbookSafeAction = (safeAction: AgentRunbookSafeAction) => {
    const action = safeAction.action ?? safeAction.key ?? "";
    if (action === "resume") {
      if (run) void runAction(() => resumeAgentRun(run.runId), "恢复请求已提交。");
      return;
    }
    if (action === "reconcile") {
      if (run) void runAction(() => reconcileAgentRun(run.runId), "Reconcile 已触发。");
      return;
    }
    if (action === "tool_call_detail") {
      if (safeAction.targetId) setSelectedToolCallId(safeAction.targetId);
      setInspectorTab("tool");
      return;
    }
    setMessage("该 Runbook safe action 仍是目标契约，当前前端不会调用不存在的后端接口。");
  };

  useEffect(() => {
    if (scrollFrameRef.current !== null) window.cancelAnimationFrame(scrollFrameRef.current);
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      const transcript = transcriptRef.current;
      if (!transcript) return;
      transcript.scrollTop = transcript.scrollHeight;
    });
    return () => {
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current);
        scrollFrameRef.current = null;
      }
    };
  }, [events, run?.toolCalls.length, pendingApprovals.length, openMigrationBlocks.length, isWaitingForAgentResponse, thinkingElapsedMs]);

  useEffect(() => clearPendingEventBatch, [clearPendingEventBatch]);

  useEffect(() => {
    if (!thinkingStartedAt) {
      setThinkingElapsedMs(0);
      return;
    }

    const updateElapsed = () => setThinkingElapsedMs(Date.now() - thinkingStartedAt);
    updateElapsed();
    const timer = window.setInterval(updateElapsed, 1000);
    return () => window.clearInterval(timer);
  }, [thinkingStartedAt]);

  useEffect(() => {
    if (!thinkingStartedAt) return;
    if (hasAgentResponse || error || run && terminalRunStatuses.includes(run.status)) {
      setThinkingStartedAt(null);
      setThinkingElapsedMs(0);
    }
  }, [error, hasAgentResponse, run, thinkingStartedAt]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey;
      if (!mod) return;
      if (event.key === "Enter") {
        event.preventDefault();
        if (canCreate) void handleCreateRun();
      }
      if (event.key.toLowerCase() === "k") {
        event.preventDefault();
        historySearchRef.current?.focus();
      }
      if (event.key.toLowerCase() === "n") {
        event.preventDefault();
        resetConversation();
      }
      if (event.key === ".") {
        event.preventDefault();
        if (run && canCancel) void runAction(() => cancelAgentRun(run.runId), "取消请求已提交。");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  return (
    <section className="page agents-page agent-codex-page">
      <div className="agent-codex-layout">
        <aside className="agent-codex-rail" aria-label="Agent 运行上下文">
          <div className="agent-rail-brand">
            <span><Icon name="smart_toy" /></span>
            <div>
              <strong>TESTAI</strong>
              <small>智能测试助理</small>
            </div>
          </div>
          <button
            className="agent-new-thread"
            onClick={resetConversation}
            type="button"
          >
            <Icon name="add" />
            新建对话
          </button>
          <div className="agent-history-section">
            <div className="agent-history-title">
              <span>历史对话</span>
              {historyLoading && <Icon name="progress_activity" />}
            </div>
            <div className="agent-history-tools">
              <label>
                <Icon name="search" />
                <input
                  aria-label="搜索本地 Agent 历史"
                  onChange={(event) => setHistorySearch(event.target.value)}
                  placeholder="搜索 prompt / run"
                  ref={historySearchRef}
                  value={historySearch}
                />
              </label>
              <select
                aria-label="历史状态筛选"
                onChange={(event) => setHistoryStatus(event.target.value as "all" | AgentRunStatus)}
                value={historyStatus}
              >
                <option value="all">全部状态</option>
                {terminalRunStatuses.map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}
                <option value="running">运行中</option>
                <option value="needs_human">等待人工</option>
                <option value="migration_blocked">迁移阻断</option>
              </select>
            </div>
            {filteredHistory.length ? (
              <div className="agent-history-list">
                {filteredHistory.map((item) => (
                  <article className={item.runId === activeRunId ? "agent-history-item active" : "agent-history-item"} key={item.runId}>
                    <button
                      className="agent-history-open"
                      onClick={() => {
                        setActiveRunId(item.runId);
                        setConversationId(item.conversationId || createLocalConversationId());
                        setPrompt(item.intent || "");
                        void loadRun(item.runId);
                      }}
                      type="button"
                    >
                      <strong>{item.title || item.intent || item.runId}</strong>
                      <small>{item.conversationId || "local history"} · {item.runId}</small>
                      <StatusBadge status={item.status} />
                      {item.unavailable && <small>远端不可用</small>}
                    </button>
                    <div className="agent-history-actions" aria-label="本地历史操作">
                      <button aria-label={item.pinned ? "取消置顶" : "置顶"} onClick={() => togglePinHistoryItem(item)} type="button">
                        <Icon name={item.pinned ? "keep_off" : "keep"} />
                      </button>
                      <button aria-label="重命名" onClick={() => renameHistoryItem(item)} type="button">
                        <Icon name="edit" />
                      </button>
                      <button aria-label="导出" onClick={() => exportConversation(item)} type="button">
                        <Icon name="download" />
                      </button>
                      <button aria-label="删除本地历史" onClick={() => deleteHistoryItem(item)} type="button">
                        <Icon name="delete" />
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <p className="agent-history-empty">暂无匹配的本地历史。当前后端没有 conversation 列表接口，跨设备历史等待后端契约。</p>
            )}
          </div>
          <div className="agent-rail-section">
            <span>Conversation</span>
            <strong>{conversationId}</strong>
          </div>
          <div className="agent-rail-section">
            <span>当前 Run</span>
            <strong>{run?.runId || "尚未创建"}</strong>
            {run && <StatusBadge status={run.status} />}
          </div>
          <div className="agent-rail-section">
            <span>Runtime Snapshot</span>
            <strong>{run?.runtimeSnapshotId || "等待后端返回"}</strong>
          </div>
          <div className="agent-rail-metrics">
            <Metric label="Iteration" value={run ? `${run.currentIteration}/${run.maxIterations || "-"}` : "-"} />
            <Metric label="ToolCall" value={run?.toolCalls.length ?? 0} />
            <Metric label="Approval" value={pendingApprovals.length} />
            <Metric label="Migration" value={openMigrationBlocks.length} />
          </div>
          <div className="agent-rail-actions">
            <button className="btn" disabled={isLoadingRun || !activeRunId} onClick={refreshRun} type="button">
              <Icon name={isLoadingRun ? "progress_activity" : "refresh"} />
              刷新
            </button>
            <button className="btn" disabled={isActing || !run} onClick={() => run && runAction(() => reconcileAgentRun(run.runId), "Reconcile 已触发。")} type="button">
              <Icon name="sync_problem" />
              Reconcile
            </button>
            <button className="btn" disabled={isActing || !canCancel} onClick={() => run && runAction(() => cancelAgentRun(run.runId), "取消请求已提交。")} type="button">
              <Icon name="stop_circle" />
              取消
            </button>
            <button className="btn primary" disabled={isActing || !canResume} onClick={() => run && runAction(() => resumeAgentRun(run.runId), "恢复请求已提交。")} type="button">
              <Icon name="play_arrow" />
              恢复
            </button>
          </div>
        </aside>

        <main className="agent-thread">
          <header className="agent-thread-header">
            <div>
              <p className="eyebrow">TESTAI</p>
              <h2>testagnet</h2>
              <span>从目标出发，持续展示计划、工具调用、审批、迁移和结果。</span>
            </div>
            <div className="agent-thread-header-actions">
              <ReadinessPill dashboard={dashboard} />
              <span className={`agent-stream-state ${streamState}`}>
                {streamState === "streaming" ? "SSE 已连接" : streamState === "connecting" ? "连接中" : streamState === "reconnecting" ? "重连中" : streamState === "error" ? "连接失败" : streamState === "closed" ? "连接已关闭" : "未连接"}
              </span>
            </div>
          </header>

          <div className="agent-thread-scroll" aria-live="polite" ref={transcriptRef}>
            {run && (
              <ThreadMessage icon="person" meta="用户目标" title={run.intent || prompt} variant="user">
                <p>{run.intent || prompt}</p>
                <div className="agent-thread-tags">
                  <span>project_id: {run.projectId}</span>
                  <span>max_iterations: {run.maxIterations || maxIterations}</span>
                  <span>auto_complete: {run.autoComplete ? "true" : "false"}</span>
                  <span>conversation_id: {run.conversationId || conversationId}</span>
                  <span>{statusLabel(run.status)}</span>
                </div>
              </ThreadMessage>
            )}

            {error && (
              <ThreadMessage icon="error" meta="错误" title={error} tone="danger" />
            )}

            {isWaitingForAgentResponse && <ThinkingMessage elapsedMs={thinkingElapsedMs} />}

            {events.length === 0 && !run && (
              <div className="agent-thread-empty">
                <Icon name="terminal" />
                <strong>我们应该做什么</strong>
                <span>发送目标后，TESTAI 的计划、工具调用和执行结果会显示在这里。</span>
              </div>
            )}

            {transcriptItems.map((item) => {
              if (item.type === "assistant") {
                return <AssistantMessage content={item.content} key={item.key} meta={item.meta} />;
              }
              if (item.type === "tool") {
                return (
                  <ToolCallThreadMessage
                    index={item.index}
                    key={item.key}
                    onSelect={() => {
                      setSelectedToolCallId(item.toolCall.toolCallId);
                      setInspectorTab("tool");
                    }}
                    toolCall={item.toolCall}
                  />
                );
              }
              return <ThreadEvent event={item.event} key={item.key} />;
            })}

            {run?.contextBuilds.map((contextBuild) => (
              <ThreadMessage
                icon="manage_search"
                key={contextBuild.contextBuildId}
                meta="Context Build"
                title={contextBuild.degradationReason || contextBuild.status || contextBuild.contextBuildId}
                tone={contextBuild.degradationReason ? "warning" : "default"}
              >
                <ContextBuildSummary contextBuild={contextBuild} />
              </ThreadMessage>
            ))}

            {run?.loopObservations.map((observation) => (
              <ThreadMessage
                icon="cycle"
                key={observation.observationId}
                meta="Loop Observation"
                title={observation.rootCause || observation.stopReason || observation.observationId}
                tone="warning"
              >
                <LoopObservationSummary observation={observation} />
              </ThreadMessage>
            ))}

            {pendingApprovals.map((approval) => (
              <ThreadMessage icon="approval" key={approval.approvalId} meta="需要审批" title={`ToolCall ${approval.toolCallId || approval.approvalId} 等待人工确认`} tone="warning">
                <ApprovalCard
                  approval={approval}
                  disabled={isActing}
                  onApprove={() => handleApprovalAction(approval, "approve")}
                  onReject={() => handleApprovalAction(approval, "reject")}
                />
              </ThreadMessage>
            ))}

            {openMigrationBlocks.map((block) => (
              <ThreadMessage icon="running_with_errors" key={block.blockId} meta="迁移阻断" title={block.reason || block.blockId} tone="warning">
                <MigrationCard block={block} disabled={isActing} onResolve={() => handleResolveBlock(block)} />
              </ThreadMessage>
            ))}
          </div>

          <form
            className="agent-composer"
            onSubmit={(event) => {
              event.preventDefault();
              void handleCreateRun();
            }}
          >
            <div className="agent-composer-top">
              <span>本地历史 · 多轮对话</span>
              <label>
                <span>循环</span>
                <input
                  aria-label="最大循环次数"
                  max={8}
                  min={1}
                  onChange={(event) => setMaxIterations(Number(event.target.value))}
                  type="number"
                  value={maxIterations}
                />
              </label>
              <label>
                <span>Auto complete</span>
                <input
                  checked={autoComplete}
                  onChange={(event) => setAutoComplete(event.target.checked)}
                  type="checkbox"
                />
              </label>
            </div>
            <div className="agent-composer-box">
              <textarea
                aria-label="Agent 目标描述"
                onChange={(event) => setPrompt(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
                  event.preventDefault();
                  if (canCreate) void handleCreateRun();
                }}
                placeholder="描述你希望 Agent 完成的测试目标，例如：根据登录、查询用户、退出登录链路生成可验证的场景草稿"
                ref={promptRef}
                rows={2}
                value={prompt}
              />
              <button
                aria-label="停止当前 Agent Run"
                className="agent-stop-button"
                disabled={isActing || !canCancel}
                onClick={() => run && void runAction(() => cancelAgentRun(run.runId), "取消请求已提交。")}
                type="button"
              >
                <Icon name="stop" />
              </button>
              <button aria-label="发送 Agent Run" className="agent-send-button" disabled={!canCreate} type="submit">
                <Icon name={isCreating ? "progress_activity" : "arrow_upward"} />
              </button>
            </div>
            {!projectId && <p className="agent-inline-warning">请先在顶部选择项目，Agent Run 必须显式携带项目上下文。</p>}
          </form>
        </main>

        <RunInspector
          activeToolCall={activeToolCall}
          alerts={alerts}
          dashboard={dashboard}
          disabled={isActing}
          memoryUsage={memoryUsage}
          metrics={metrics}
          onMemoryFeedback={(usageEvent, feedback) => {
            void sendAgentMemoryFeedback(usageEvent.usageEventId, feedback)
              .then((updated) => setMemoryUsage((current) => current.map((item) => item.usageEventId === updated.usageEventId ? updated : item)))
              .catch((nextError) => setError(nextError instanceof Error ? nextError.message : "Memory feedback 提交失败"));
          }}
          onReconcile={() => run && void runAction(() => reconcileAgentRun(run.runId), "Reconcile 已触发。")}
          onRunbookSafeAction={handleRunbookSafeAction}
          onResume={() => run && void runAction(() => resumeAgentRun(run.runId), "恢复请求已提交。")}
          run={run}
          runbook={runbook}
          promotionGate={promotionGate}
          releaseGates={releaseGates}
          selectedTab={inspectorTab}
          setSelectedTab={setInspectorTab}
        />
      </div>
    </section>
  );
}

function ThreadMessage({
  children,
  icon,
  meta,
  title,
  tone = "default",
  variant = "default",
}: {
  children?: ReactNode;
  icon: string;
  meta: string;
  title: string;
  tone?: "default" | "info" | "warning" | "danger";
  variant?: "default" | "system" | "user" | "assistant" | "activity";
}) {
  return (
    <article className={`agent-thread-message ${tone} ${variant}`}>
      <div className="agent-thread-icon">
        <Icon name={icon} />
      </div>
      <div className="agent-thread-body">
        <span>{meta}</span>
        <h3>{title}</h3>
        {children}
      </div>
    </article>
  );
}

function ThreadEvent({ event }: { event: AgentRunEvent }) {
  const isAttention = event.event.includes("uncertain") || event.event.includes("migration") || event.event.includes("approval");
  const content = event.payload.content ?? event.payload.delta ?? event.payload.message;
  const hasPayload = Object.keys(event.payload).length > 0;

  return (
    <article className={isAttention ? "agent-thread-message warning compact" : "agent-thread-message compact"}>
      <div className="agent-thread-icon">
        <Icon name={event.event.startsWith("tool.") ? "terminal" : event.event.startsWith("model.") ? "psychology" : "radio_button_checked"} />
      </div>
      <div className="agent-thread-body">
        <span>{event.sequence ? `#${event.sequence}` : "event"} · {event.createdAt || "实时"}</span>
        <h3>{event.event}</h3>
        {content !== undefined ? <MarkdownContent content={String(content)} /> : null}
        {hasPayload && content === undefined ? (
          <details className="agent-event-payload">
            <summary>原始输出</summary>
            <pre>{stringifyValue(event.payload)}</pre>
          </details>
        ) : null}
      </div>
    </article>
  );
}

function ThinkingMessage({ elapsedMs }: { elapsedMs: number }) {
  return (
    <article className="agent-thread-message compact agent-thinking-message">
      <div className="agent-thread-icon">
        <Icon name="psychology" />
      </div>
      <div className="agent-thinking-body" aria-live="polite">
        <span className="agent-thinking-text">
          正在思考
          <span className="agent-thinking-dots" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
        </span>
        <small>{formatThinkingElapsed(elapsedMs)}</small>
      </div>
    </article>
  );
}

function AssistantMessage({ content, meta }: { content: string; meta: string }) {
  return (
    <ThreadMessage icon="psychology" meta={meta} title="Agent 回复" variant="assistant">
      <div className="agent-assistant-response">
        <MarkdownContent content={content || "-"} />
      </div>
    </ThreadMessage>
  );
}

function ToolCallThreadMessage({
  index,
  onSelect,
  toolCall,
}: {
  index: number;
  onSelect: () => void;
  toolCall: AgentToolCall;
}) {
  const tone = ["uncertain", "needs_migration", "manual_intervention"].includes(toolCall.status)
    ? "warning"
    : toolCall.status === "failed"
      ? "danger"
      : "default";

  return (
    <article className={`agent-thread-message compact agent-tool-activity ${tone}`}>
      <div className="agent-thread-icon">
        <Icon name={toolCall.status === "succeeded" ? "check_circle" : toolCall.status === "failed" ? "error" : "terminal"} />
      </div>
      <ToolCallTranscript index={index} onSelect={onSelect} toolCall={toolCall} />
    </article>
  );
}

function ReadinessPill({ dashboard }: { dashboard: AgentDashboardSnapshot | null }) {
  if (!dashboard) return <span className="agent-readiness neutral"><Icon name="monitoring" />Readiness 待加载</span>;
  return (
    <span className={`agent-readiness ${statusTone(dashboard.readiness)}`}>
      <Icon name={dashboard.readiness === "pass" ? "verified" : dashboard.readiness === "blocked" ? "block" : "warning"} />
      Readiness {statusLabel(dashboard.readiness)}
    </span>
  );
}

function StatusBadge({ status }: { status?: string }) {
  return <span className={`agent-status ${statusTone(status)}`}>{statusLabel(status)}</span>;
}

function PanelTitle({ icon, title }: { icon: string; title: string }) {
  return (
    <div className="agent-panel-title">
      <Icon name={icon} />
      <h3>{title}</h3>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="agent-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function EmptyState({ icon, title, description }: { icon: string; title: string; description: string }) {
  return (
    <div className="agent-empty">
      <Icon name={icon} />
      <strong>{title}</strong>
      <span>{description}</span>
    </div>
  );
}

function RunInspector({
  activeToolCall,
  alerts,
  dashboard,
  disabled,
  memoryUsage,
  metrics,
  onMemoryFeedback,
  onReconcile,
  onRunbookSafeAction,
  onResume,
  run,
  runbook,
  promotionGate,
  releaseGates,
  selectedTab,
  setSelectedTab,
}: {
  activeToolCall: AgentToolCall | null;
  alerts: AgentAlert[];
  dashboard: AgentDashboardSnapshot | null;
  disabled: boolean;
  memoryUsage: AgentMemoryUsageEvent[];
  metrics: AgentMetricsSnapshot | null;
  onMemoryFeedback: (usageEvent: AgentMemoryUsageEvent, feedback: AgentMemoryUsageEvent["feedback"]) => void;
  onReconcile: () => void;
  onRunbookSafeAction: (safeAction: AgentRunbookSafeAction) => void;
  onResume: () => void;
  run: AgentRunSnapshot | null;
  runbook: AgentRunbook | null;
  promotionGate: AgentReleaseGate | null;
  releaseGates: AgentReleaseGate[];
  selectedTab: InspectorTab;
  setSelectedTab: (tab: InspectorTab) => void;
}) {
  const tabs: Array<{ key: InspectorTab; label: string; icon: string }> = [
    { key: "run", label: "Run", icon: "fact_check" },
    { key: "tool", label: "Tool", icon: "terminal" },
    { key: "approval", label: "Approval", icon: "approval" },
    { key: "memory", label: "Memory", icon: "memory" },
    { key: "runbook", label: "Runbook", icon: "menu_book" },
    { key: "dashboard", label: "Dashboard", icon: "monitoring" },
  ];

  return (
    <aside className="agent-inspector" aria-label="Agent Run 详情">
      <div className="agent-inspector-tabs">
        {tabs.map((tab) => (
          <button
            aria-pressed={selectedTab === tab.key}
            className={selectedTab === tab.key ? "active" : ""}
            key={tab.key}
            onClick={() => setSelectedTab(tab.key)}
            title={tab.label}
            type="button"
          >
            <Icon name={tab.icon} />
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {selectedTab === "run" && (
        <div className="agent-inspector-card">
          <PanelTitle icon="fact_check" title="Run Summary" />
          {run ? (
            <div className="agent-detail-grid">
              <KeyValue label="run_id" value={run.runId} />
              <KeyValue label="conversation_id" value={run.conversationId} />
              <KeyValue label="project_id" value={run.projectId} />
              <KeyValue label="status" value={run.status} />
              <KeyValue label="runtime_snapshot_id" value={run.runtimeSnapshotId} />
              <KeyValue label="last_event_sequence" value={run.lastEventSequence} />
              <KeyValue label="iteration" value={`${run.currentIteration}/${run.maxIterations}`} />
              <KeyValue label="auto_complete" value={run.autoComplete ? "true" : "false"} />
              {(run.errorCode || run.errorMessage) && (
                <div className="agent-error-box">
                  <strong>{run.errorCode || "run_error"}</strong>
                  <span>{run.errorMessage}</span>
                </div>
              )}
            </div>
          ) : (
            <EmptyState icon="terminal" title="尚未选择 Run" description="创建或打开本地历史 Run 后展示运行详情。" />
          )}
        </div>
      )}

      {selectedTab === "tool" && (
        <div className="agent-inspector-card">
          <PanelTitle icon="terminal" title="Tool Detail" />
          {activeToolCall ? <ToolCallDetail toolCall={activeToolCall} /> : <EmptyState icon="terminal" title="暂无 ToolCall" description="收到 tool.* 事件或 Run 详情返回工具调用后显示。" />}
        </div>
      )}

      {selectedTab === "approval" && (
        <div className="agent-inspector-card">
          <PanelTitle icon="approval" title="Approvals" />
          {run?.approvals.length ? (
            <div className="agent-check-list">
              {run.approvals.map((approval) => (
                <div className="agent-check-row" key={approval.approvalId}>
                  <span>{approval.approvalId}</span>
                  <StatusBadge status={approval.status} />
                  <small>input_hash: {approval.inputHash || "-"}</small>
                  <small>approval_lineage_id: {approval.approvalLineageId || "-"}</small>
                  <small>approval_epoch: {approval.approvalEpoch ?? "-"}</small>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState icon="approval" title="暂无审批" description="pending approval 会在这里展示 CAS 字段。" />
          )}
        </div>
      )}

      {selectedTab === "memory" && (
        <div className="agent-inspector-card">
          <PanelTitle icon="memory" title="Memory Usage" />
          {memoryUsage.length ? (
            <div className="agent-check-list">
              {memoryUsage.map((usageEvent) => (
                <div className="agent-check-row" key={usageEvent.usageEventId}>
                  <span>{usageEvent.memoryKey || usageEvent.usageEventId}</span>
                  <small>{usageEvent.usageType || "usage"} · risk: {usageEvent.riskLevel || "-"}</small>
                  <pre>{stringifyValue(usageEvent.evidence)}</pre>
                  <div className="agent-card-actions">
                    {(["useful", "misleading", "stale"] as const).map((feedback) => (
                      <button
                        className={usageEvent.feedback === feedback ? "btn primary" : "btn"}
                        disabled={disabled}
                        key={feedback}
                        onClick={() => onMemoryFeedback(usageEvent, feedback)}
                        type="button"
                      >
                        {feedback}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState icon="memory" title="暂无 Memory 使用记录" description="高风险动作只依赖 Memory 时，会在这里保留证据与反馈入口。" />
          )}
        </div>
      )}

      {selectedTab === "runbook" && (
        <div className="agent-inspector-card">
          <PanelTitle icon="menu_book" title="Runbook" />
          {runbook ? (
            <div className="agent-runbook">
              <p>{runbook.diagnosis || "暂无诊断摘要。"}</p>
              {runbook.recommendations?.map((item) => (
                <div className="agent-check-row" key={item.key || item.label}>
                  <span>{item.label || item.key || item.action}</span>
                  <small>{item.reason || item.severity || "-"}</small>
                </div>
              ))}
              <div className="agent-card-actions">
                {(runbook.safeActions?.length ? runbook.safeActions : [
                  { action: "reconcile", label: "Reconcile" },
                  { action: "resume", label: "Resume" },
                ]).map((safeAction) => {
                  const action = safeAction.action ?? safeAction.key ?? "";
                  const canRunAction = ["resume", "reconcile", "tool_call_detail"].includes(action);
                  return (
                    <button
                      className={action === "resume" ? "btn primary" : "btn"}
                      disabled={disabled || !run || !canRunAction}
                      key={`${action}-${safeAction.targetId ?? safeAction.label ?? safeAction.key ?? "action"}`}
                      onClick={() => onRunbookSafeAction(safeAction)}
                      title={canRunAction ? safeAction.reason : "目标契约：当前前端不调用不存在的后端接口"}
                      type="button"
                    >
                      {safeAction.label || safeAction.key || safeAction.action || "Safe action"}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <EmptyState icon="menu_book" title="Runbook 暂不可用" description="后端 runbook 返回后展示 diagnosis、recommendations 和 safe actions。" />
          )}
        </div>
      )}

      {selectedTab === "dashboard" && (
        <div className="agent-inspector-card">
          <PanelTitle icon="monitoring" title="Dashboard" />
          {dashboard ? (
            <div className="agent-check-list">
              <div className="agent-check-row">
                <span>readiness</span>
                <StatusBadge status={dashboard.readiness} />
              </div>
              {dashboard.checks.map((check) => (
                <div className="agent-check-row" key={check.key}>
                  <span>{check.key}</span>
                  <StatusBadge status={check.status} />
                  <small>{check.severity || "-"} · {check.message || "-"}</small>
                </div>
              ))}
              <div className="agent-json-block">
                <strong>alert_summary</strong>
                <pre>{stringifyValue(dashboard.alertSummary)}</pre>
              </div>
              <div className="agent-json-block">
                <strong>metrics</strong>
                <pre>{stringifyValue(metrics?.metrics ?? dashboard.metrics)}</pre>
              </div>
              <div className="agent-json-block">
                <strong>alerts</strong>
                <pre>{stringifyValue(alerts)}</pre>
              </div>
              <div className="agent-json-block">
                <strong>release_gate</strong>
                <pre>{stringifyValue({ dashboard: dashboard.releaseGate, gates: releaseGates, promotion: promotionGate })}</pre>
              </div>
            </div>
          ) : (
            <EmptyState icon="monitoring" title="Dashboard 暂不可用" description="读取 /agents/dashboard 后展示 readiness、metrics 和 alerts。" />
          )}
        </div>
      )}
    </aside>
  );
}

function ContextBuildSummary({ contextBuild }: { contextBuild: AgentContextBuild }) {
  return (
    <div className="agent-detail-grid">
      <KeyValue label="context_build_id" value={contextBuild.contextBuildId} />
      <KeyValue label="status" value={contextBuild.status} />
      <KeyValue label="degradation_reason" value={contextBuild.degradationReason} />
      <div className="agent-json-block">
        <strong>required_evidence</strong>
        <pre>{stringifyValue(contextBuild.requiredEvidence)}</pre>
      </div>
    </div>
  );
}

function LoopObservationSummary({ observation }: { observation: AgentLoopObservation }) {
  return (
    <div className="agent-detail-grid">
      <KeyValue label="observation_id" value={observation.observationId} />
      <KeyValue label="stop_reason" value={observation.stopReason} />
      <KeyValue label="mitigation" value={observation.mitigation} />
      <div className="agent-json-block">
        <strong>causal_chain</strong>
        <pre>{stringifyValue(observation.causalChain)}</pre>
      </div>
    </div>
  );
}

function ApprovalCard({
  approval,
  disabled,
  onApprove,
  onReject,
}: {
  approval: AgentApproval;
  disabled: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  const stale = approval.status !== "pending";
  return (
    <div className="agent-governance-card">
      <div className="agent-card-head">
        <strong>{approval.approvalId}</strong>
        <StatusBadge status={approval.status} />
      </div>
      <KeyValue label="ToolCall" value={approval.toolCallId} />
      <KeyValue label="Input Hash" value={approval.inputHash} />
      <KeyValue label="Runtime Snapshot" value={approval.runtimeSnapshotId} />
      <KeyValue label="Resource Scope" value={approval.resourceScopeHash} />
      <KeyValue label="Risk" value={approval.riskReason} />
      <KeyValue label="Permission" value={approval.permissionScope} />
      <KeyValue label="Epoch" value={approval.approvalEpoch} />
      <KeyValue label="Expires At" value={approval.expiresAt} />
      {approval.supersededByToolCallId && <KeyValue label="Superseded By" value={approval.supersededByToolCallId} />}
      <div className="agent-card-actions">
        <button className="btn primary" disabled={disabled || stale} onClick={onApprove} type="button">批准</button>
        <button className="btn" disabled={disabled || stale} onClick={onReject} type="button">拒绝</button>
      </div>
    </div>
  );
}

function MigrationCard({ block, disabled, onResolve }: { block: AgentMigrationBlock; disabled: boolean; onResolve: () => void }) {
  return (
    <div className="agent-governance-card warning">
      <div className="agent-card-head">
        <strong>{block.blockType || block.blockId}</strong>
        <StatusBadge status={block.status} />
      </div>
      <KeyValue label="Reason" value={block.reason} />
      <KeyValue label="ToolCall" value={block.toolCallId} />
      <KeyValue label="Backend Contract" value={block.backendContractVersion} />
      <KeyValue label="Unsupported Schema" value={block.unsupportedSchema} />
      <KeyValue label="Freshness Gate" value={block.freshnessGateResult} />
      <div className="agent-card-actions">
        <button className="btn primary" disabled={disabled || block.status !== "open"} onClick={onResolve} type="button">
          解除阻断
        </button>
      </div>
    </div>
  );
}

function ToolCallDetail({ toolCall }: { toolCall: AgentToolCall }) {
  return (
    <div className="agent-detail-grid">
      <KeyValue label="Tool" value={`${toolCall.toolName}${toolCall.toolVersion ? `@${toolCall.toolVersion}` : ""}`} />
      <KeyValue label="Status" value={statusLabel(toolCall.status)} />
      <KeyValue label="Effect State" value={toolCall.effectSubmissionState} />
      <KeyValue label="Idempotency Key" value={toolCall.idempotencyKey} />
      <KeyValue label="Side Effect" value={toolCall.resolvedSideEffectClass} />
      <KeyValue label="Replay Policy" value={toolCall.resolvedReplayPolicy} />
      <KeyValue label="Backend" value={toolCall.backendName} />
      <KeyValue label="Operation" value={toolCall.backendOperation} />
      <KeyValue label="Contract" value={toolCall.backendContractVersion} />
      <KeyValue label="Capability" value={toolCall.backendEffectCapability} />
      <KeyValue label="Approval" value={toolCall.approvalRequired ? "required" : "not required"} />
      <KeyValue label="Recovery" value={toolCall.recoveryDecision} />
      {(toolCall.errorCode || toolCall.errorMessage) && (
        <div className="agent-error-box">
          <strong>{toolCall.errorCode || "tool_error"}</strong>
          <span>{toolCall.errorMessage}</span>
        </div>
      )}
      {toolCall.evidenceRefs?.length ? (
        <div className="agent-json-block">
          <strong>Evidence Refs</strong>
          <pre>{stringifyValue(toolCall.evidenceRefs)}</pre>
        </div>
      ) : null}
      {toolCall.inputJsonRedacted !== undefined ? (
        <div className="agent-json-block">
          <strong>Input Redacted</strong>
          <pre>{stringifyValue(toolCall.inputJsonRedacted)}</pre>
        </div>
      ) : null}
      {toolCall.requiredPermissionsJson !== undefined ? (
        <div className="agent-json-block">
          <strong>Required Permissions</strong>
          <pre>{stringifyValue(toolCall.requiredPermissionsJson)}</pre>
        </div>
      ) : null}
      {toolCall.outputSummary !== undefined ? (
        <div className="agent-json-block">
          <strong>Output Summary</strong>
          <pre>{stringifyValue(toolCall.outputSummary)}</pre>
        </div>
      ) : null}
      {toolCall.outputJsonRedacted !== undefined ? (
        <div className="agent-json-block">
          <strong>Output Redacted</strong>
          <pre>{stringifyValue(toolCall.outputJsonRedacted)}</pre>
        </div>
      ) : null}
      {toolCall.recentReconcileAttempts?.length ? (
        <div className="agent-json-block">
          <strong>Recent Reconcile Attempts</strong>
          <pre>{stringifyValue(toolCall.recentReconcileAttempts)}</pre>
        </div>
      ) : null}
    </div>
  );
}

function ToolCallTranscript({ index, onSelect, toolCall }: { index: number; onSelect: () => void; toolCall: AgentToolCall }) {
  const outputPreview =
    toolCall.outputJsonRedacted !== undefined && toolCall.outputJsonRedacted !== null
      ? `输出 ${stringifyValue(toolCall.outputJsonRedacted)}`
      : toolCall.backendOperation || toolCall.effectSubmissionState || toolCall.toolCallId;

  return (
    <details className="agent-tool-transcript">
      <summary>
        <span className="agent-tool-activity-copy">
          <small>ToolCall {index}</small>
          <strong>{toolCallActivityLabel(toolCall.status)} · {toolCall.toolName || toolCall.backendOperation || toolCall.toolCallId}</strong>
          <small>{outputPreview}</small>
        </span>
        <StatusBadge status={toolCall.status} />
      </summary>
      <div className="agent-tool-activity-actions">
        <button className="btn" onClick={onSelect} type="button">查看详情</button>
      </div>
      <ToolCallDetail toolCall={toolCall} />
    </details>
  );
}

function KeyValue({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="agent-kv">
      <span>{label}</span>
      <strong>{stringifyValue(value)}</strong>
    </div>
  );
}
