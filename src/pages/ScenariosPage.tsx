import { useCallback, useEffect, useMemo, useState } from "react";
import { lazy, Suspense, useRef } from "react";
import {
  executeUnsavedTestCase,
  executeUnsavedWebSocketTestCase,
  listTestCases,
  listWebSocketTestCases,
  type BackendTestCase,
  type TestCaseAssertion,
  type TestCaseRequestPayload,
  type WebSocketAssertion,
  type WebSocketTestCaseRequestPayload,
} from "../api/apiCases";
import type { EnvironmentOption } from "../api/projects";
import {
  compileScenarioStepConfig,
  readScenarioContext,
  writeScenarioContext,
  type ScenarioBinding,
  type ScenarioBindingTarget,
  type ScenarioContextConfig,
  type ScenarioExtraction,
} from "../api/scenarioContext";
import { extractScenarioDebugValue, normalizeScenarioStepDebug, suggestedVariableName, type ScenarioStepDebugResult } from "../api/scenarioStepDebug";
import {
  deleteScenario,
  deleteScenarioRun,
  duplicateScenario,
  emptyScenario,
  getScenario,
  getScenarioRun,
  listScenarioRuns,
  listScenarios,
  runScenario,
  saveScenario,
  scenarioUniqueId,
  subscribeScenarioRunEvents,
  type ScenarioDataset,
  type ScenarioDatasetRecord,
  type ScenarioActionPosition,
  type ScenarioRequestOverride,
  type ScenarioRequestOverrideTarget,
  type ScenarioResolvedBinding,
  type ScenarioRun,
  type ScenarioRunEvent,
  type ScenarioRunLaunchItem,
  type ScenarioStep,
  type ScenarioStepKind,
  type ScenarioStepStatus,
  type ScenarioStepResult,
  type TestScenario,
} from "../api/scenarios";
import { Icon } from "../components/Icon";
import { Pagination, usePagination } from "../components/Pagination";
import { ConfirmDialog } from "../components/ConfirmDialog";
import type { ActionHandler } from "../types";

type ScenarioTab = "design" | "data" | "history";
const ScriptCodeEditor = lazy(() => import("../components/ScriptCodeEditor"));
type DataNavigationTarget = "fields" | "datasets";
interface ScenarioLiveProgress {
  currentStepIndex?: number;
  transitionTargetIndex?: number;
  stepStatuses: Record<number, ScenarioStepStatus>;
}

interface ScenarioConnectionNotice {
  message: string;
  tone: "info" | "warning" | "success";
}

const scenarioPositionLabels: Record<ScenarioActionPosition, string> = {
  before: "前置",
  main: "主测试用例",
  after: "后置",
};

const scenarioPositionOrder: Record<ScenarioActionPosition, number> = {
  before: 0,
  main: 1,
  after: 2,
};

function orderScenarioSteps(steps: ScenarioStep[]) {
  const nodeOrder = [...new Set(steps.filter((step) => step.actionPosition === "main").map((step) => step.nodeId))];
  return nodeOrder.flatMap((nodeId) => steps
    .filter((step) => step.nodeId === nodeId)
    .sort((left, right) => scenarioPositionOrder[left.actionPosition] - scenarioPositionOrder[right.actionPosition]));
}

function scenarioRunDataset(
  scenario: TestScenario | undefined,
  run: Pick<ScenarioRunLaunchItem, "datasetId" | "datasetName">,
) {
  return scenario?.datasets.find((dataset) =>
    (run.datasetId && dataset.id === run.datasetId) || dataset.name === run.datasetName);
}

function scenarioRunRecordLabel(
  run: Pick<ScenarioRunLaunchItem, "datasetId" | "datasetName" | "recordId" | "recordName">,
  scenario?: TestScenario,
) {
  const dataset = scenarioRunDataset(scenario, run);
  const visibleRecords = (dataset?.records ?? []).filter((record) => record.enabled !== false);
  if ((scenario?.datasets.length ?? 0) === 1 && dataset && visibleRecords.length <= 1) return "";
  return run.recordName || run.recordId || "";
}

function scenarioRunIdentity(
  run: Pick<ScenarioRunLaunchItem, "datasetId" | "datasetName" | "recordId" | "recordName">,
  scenario?: TestScenario,
) {
  const record = scenarioRunRecordLabel(run, scenario);
  return record ? `${run.datasetName} · ${record}` : run.datasetName;
}

function isTerminalRunStatus(status: ScenarioRun["status"]) {
  return status === "passed" || status === "failed" || status === "timeout" || status === "cancelled";
}

function progressFromRunDetail(run: ScenarioRun): ScenarioLiveProgress {
  const stepStatuses = run.stepResults.reduce<Record<number, ScenarioStepStatus>>((result, step, index) => {
    result[index] = step.status;
    return result;
  }, {});
  const runningIndex = run.stepResults.findIndex((step) => step.status === "running");
  return {
    currentStepIndex: run.currentStepIndex ?? (runningIndex >= 0 ? runningIndex : undefined),
    stepStatuses,
  };
}

function nextLiveProgress(current: ScenarioLiveProgress, event: ScenarioRunEvent): ScenarioLiveProgress {
  if (event.event === "step_started" && event.stepIndex !== undefined) {
    return {
      ...current,
      currentStepIndex: event.stepIndex,
      transitionTargetIndex: undefined,
      stepStatuses: { ...current.stepStatuses, [event.stepIndex]: "running" },
    };
  }
  if (event.event === "transition_started" && event.targetStepIndex !== undefined) {
    return { ...current, currentStepIndex: undefined, transitionTargetIndex: event.targetStepIndex };
  }
  if (
    (event.event === "step_completed" || event.event === "step_failed" || event.event === "step_skipped")
    && event.stepIndex !== undefined
  ) {
    const fallback = event.event === "step_completed" ? "passed" : event.event === "step_skipped" ? "skipped" : "failed";
    return {
      ...current,
      currentStepIndex: undefined,
      stepStatuses: { ...current.stepStatuses, [event.stepIndex]: event.status as ScenarioStepStatus || fallback },
    };
  }
  return current;
}

type ScenarioAsset = Pick<ScenarioStep, "kind" | "referenceId" | "name" | "method" | "path"> & {
  requestConfig?: Record<string, unknown>;
};

const builtInAssets: ScenarioAsset[] = [
  { kind: "condition", name: "条件判断", method: "IF", path: "根据表达式决定是否继续" },
  { kind: "delay", name: "等待事件", method: "WAIT", path: "等待指定时间后继续" },
  { kind: "random", name: "生成随机值", method: "RNG", path: "生成数字、字符串或 UUID 并写入变量" },
  { kind: "fixed_value", name: "设置固定值", method: "SET", path: "把 JSON 值写入场景变量" },
  { kind: "script", name: "执行脚本", method: "CODE", path: "在受限沙箱中运行 Python 或 JavaScript" },
];

function unwrapCases(result: unknown): BackendTestCase[] {
  if (Array.isArray(result)) return result;
  if (!result || typeof result !== "object") return [];
  const source = result as { data?: unknown; items?: unknown; records?: unknown; results?: unknown };
  const items = source.data ?? source.items ?? source.records ?? source.results;
  return Array.isArray(items) ? items as BackendTestCase[] : [];
}

function mapCase(source: BackendTestCase, index: number, kind: ScenarioStepKind): ScenarioAsset {
  const requestConfig = kind === "websocket_case"
    ? {
        path: source.path ?? source.url ?? "",
        headers: source.headers ?? {},
        subprotocols: source.subprotocols ?? [],
        messages: source.messages ?? [],
        receive_count: source.receive_count ?? 1,
        connect_timeout_ms: source.connect_timeout_ms ?? 10000,
        receive_timeout_ms: source.receive_timeout_ms ?? 10000,
        assertions: source.assertions ?? [],
        extractors: source.extractors ?? [],
      }
    : {
        method: String(source.method ?? "GET").toUpperCase(),
        path: source.path ?? source.url ?? "",
        headers: source.headers ?? {},
        query_params: source.query_params ?? {},
        body_type: source.body_type ?? "none",
        body: source.body ?? null,
        assertions: source.assertions ?? [],
        extractors: source.extractors ?? [],
      };
  return {
    kind,
    referenceId: source.id as string | number ?? source.test_case_id as string | number ?? index,
    name: String(source.name ?? source.title ?? "未命名测试用例"),
    method: kind === "websocket_case" ? "WS" : String(source.method ?? "GET").toUpperCase(),
    path: String(source.path ?? source.url ?? ""),
    requestConfig,
  };
}

function stepFromAsset(asset: ScenarioAsset, nodeId: string, actionPosition: ScenarioActionPosition): ScenarioStep {
  const defaults = asset.kind === "delay"
    ? { duration_ms: 1000 }
    : asset.kind === "condition"
      ? { expression: "{{status}} == 'success'" }
      : asset.kind === "random"
        ? { type: "integer", min: 1, max: 100, length: 12, output: "randomValue" }
        : asset.kind === "fixed_value"
          ? { output: "value", value: "" }
          : asset.kind === "script"
            ? { language: "python", code: "result = None", inputs: [], outputs: ["result"], timeout_ms: 10000 }
      : asset.requestConfig ?? {};
  return {
    ...asset,
    id: scenarioUniqueId("STEP"),
    configText: JSON.stringify(defaults, null, 2),
    continueOnFailure: false,
    nodeId,
    actionPosition,
  };
}

function formatDate(value?: string) {
  if (!value) return "尚未运行";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN");
}

export function ScenariosPage({
  environmentId,
  environments = [],
  onAction,
  projectId,
}: {
  environmentId?: number;
  environments?: EnvironmentOption[];
  onAction: ActionHandler;
  projectId?: number;
}) {
  const [scenarios, setScenarios] = useState<TestScenario[]>([]);
  const [runs, setRuns] = useState<ScenarioRun[]>([]);
  const [draft, setDraft] = useState<TestScenario>();
  const [selectedStepId, setSelectedStepId] = useState<string>();
  const [selectedDatasetId, setSelectedDatasetId] = useState<string>();
  const [tab, setTab] = useState<ScenarioTab>("design");
  const [assets, setAssets] = useState<ScenarioAsset[]>([]);
  const [assetSearch, setAssetSearch] = useState("");
  const [assetTargetPosition, setAssetTargetPosition] = useState<ScenarioActionPosition>("main");
  const [assetTargetNodeId, setAssetTargetNodeId] = useState<string>();
  const [actionPickerOpen, setActionPickerOpen] = useState(false);
  const [scenarioSearch, setScenarioSearch] = useState("");
  const [assetLoading, setAssetLoading] = useState(false);
  const [assetError, setAssetError] = useState("");
  const [busy, setBusy] = useState(false);
  const [runningScenario, setRunningScenario] = useState(false);
  const [executionRuns, setExecutionRuns] = useState<ScenarioRunLaunchItem[]>([]);
  const [selectedExecutionRunId, setSelectedExecutionRunId] = useState<string>();
  const [runProgressById, setRunProgressById] = useState<Record<string, ScenarioLiveProgress>>({});
  const [runStatusById, setRunStatusById] = useState<Record<string, ScenarioRun["status"]>>({});
  const [runNoticeById, setRunNoticeById] = useState<Record<string, ScenarioConnectionNotice | undefined>>({});
  const [scenarioRunAbortController, setScenarioRunAbortController] = useState<AbortController>();
  const [debuggingStepId, setDebuggingStepId] = useState<string>();
  const [stepDebugResults, setStepDebugResults] = useState<Record<string, ScenarioStepDebugResult>>({});
  const [loadingRunIds, setLoadingRunIds] = useState<Set<string>>(new Set());
  const [deletingRunIds, setDeletingRunIds] = useState<Set<string>>(new Set());
  const [pendingDelete, setPendingDelete] = useState<{ type: "scenario"; scenario: TestScenario } | { type: "run"; run: ScenarioRun }>();
  const [dataNavigationTarget, setDataNavigationTarget] = useState<DataNavigationTarget>();

  const reload = useCallback(async () => {
    if (!projectId) {
      setScenarios([]);
      setRuns([]);
      return;
    }
    const [scenarioResult, runResult] = await Promise.allSettled([
      listScenarios(projectId),
      listScenarioRuns(projectId),
    ]);
    if (scenarioResult.status === "fulfilled") setScenarios(scenarioResult.value);
    if (runResult.status === "fulfilled") setRuns(runResult.value);
    const failure = [scenarioResult, runResult].find((result) => result.status === "rejected");
    if (failure?.status === "rejected") onAction(failure.reason instanceof Error ? failure.reason.message : "场景数据加载失败");
  }, [onAction, projectId]);

  useEffect(() => {
    void reload();
    setDraft(undefined);
    setSelectedStepId(undefined);
    setSelectedDatasetId(undefined);
    setStepDebugResults({});
    setExecutionRuns([]);
    setSelectedExecutionRunId(undefined);
    setRunProgressById({});
    setRunStatusById({});
    setRunNoticeById({});
    setTab("design");
  }, [reload]);

  useEffect(() => () => scenarioRunAbortController?.abort(), [scenarioRunAbortController]);

  useEffect(() => {
    if (!actionPickerOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setActionPickerOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [actionPickerOpen]);

  useEffect(() => {
    if (!projectId) {
      setAssets([]);
      setAssetError("");
      return;
    }
    let ignore = false;
    setAssetLoading(true);
    setAssetError("");
    void Promise.allSettled([listTestCases(projectId), listWebSocketTestCases(projectId)])
      .then(([httpResult, websocketResult]) => {
        if (ignore) return;
        setAssets([
          ...(httpResult.status === "fulfilled" ? unwrapCases(httpResult.value).map((item, index) => mapCase(item, index, "api_case")) : []),
          ...(websocketResult.status === "fulfilled" ? unwrapCases(websocketResult.value).map((item, index) => mapCase(item, index, "websocket_case")) : []),
        ]);
        if (httpResult.status === "rejected" && websocketResult.status === "rejected") setAssetError("测试用例加载失败，仍可编辑已有场景。");
      })
      .finally(() => {
        if (!ignore) setAssetLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [projectId]);

  const selectedStep = draft?.steps.find((step) => step.id === selectedStepId);
  const assetTargetNode = draft?.steps.find((step) => step.nodeId === assetTargetNodeId && step.actionPosition === "main");
  const selectedStepAsset = selectedStep
    ? assets.find((asset) => asset.kind === selectedStep.kind && String(asset.referenceId) === String(selectedStep.referenceId))
    : undefined;
  const latestDraftRun = useMemo(() => {
    if (!draft?.id) return undefined;
    return runs
      .filter((run) => run.scenarioId === draft.id)
      .sort((left, right) => new Date(right.startedAt).getTime() - new Date(left.startedAt).getTime())[0];
  }, [draft?.id, runs]);
  const selectedExecutionRun = executionRuns.find((run) => run.runId === selectedExecutionRunId);
  const selectedExecutionDetail = runs.find((run) => run.id === selectedExecutionRunId);
  const displayedDraftRun = selectedExecutionDetail ?? latestDraftRun;
  const scenarioRunProgress = selectedExecutionRunId ? runProgressById[selectedExecutionRunId] : undefined;
  const scenarioConnectionNotice = selectedExecutionRunId ? runNoticeById[selectedExecutionRunId] : undefined;
  const filteredScenarios = scenarios.filter((scenario) => !scenarioSearch.trim()
    || `${scenario.name} ${scenario.description} ${scenario.tags.join(" ")}`.toLowerCase().includes(scenarioSearch.trim().toLowerCase()));
  const scenarioPagination = usePagination(filteredScenarios, 6, `${projectId ?? "none"}:${scenarioSearch}`);
  const filteredAssets = [...builtInAssets, ...assets].filter((asset) => !assetSearch.trim()
    || `${asset.name} ${asset.method} ${asset.path}`.toLowerCase().includes(assetSearch.trim().toLowerCase()));
  const pickerAssets = filteredAssets.filter((asset) => assetTargetPosition !== "main" || asset.kind === "api_case" || asset.kind === "websocket_case");
  const testCaseAssets = assets.filter((asset) => !assetSearch.trim()
    || `${asset.name} ${asset.method} ${asset.path}`.toLowerCase().includes(assetSearch.trim().toLowerCase()));
  const selectScenario = async (scenario: TestScenario) => {
    if (!projectId) return;
    setBusy(true);
    try {
      const detail = await getScenario(projectId, scenario.id);
      setDraft(detail);
      setSelectedStepId(detail.steps[0]?.id);
      setSelectedDatasetId(undefined);
      setStepDebugResults({});
      setExecutionRuns([]);
      setSelectedExecutionRunId(undefined);
      setRunProgressById({});
      setRunStatusById({});
      setRunNoticeById({});
      setTab("design");
    } catch (error) {
      onAction(error instanceof Error ? error.message : "场景详情加载失败");
    } finally {
      setBusy(false);
    }
  };

  const createScenario = () => {
    if (!projectId) return onAction("请先选择项目");
    const next = emptyScenario(projectId, environmentId ?? environments[0]?.id);
    setDraft(next);
    setSelectedStepId(undefined);
    setSelectedDatasetId(undefined);
    setStepDebugResults({});
    setExecutionRuns([]);
    setSelectedExecutionRunId(undefined);
    setRunProgressById({});
    setRunStatusById({});
    setRunNoticeById({});
    setTab("design");
  };

  const patchDraft = (patch: Partial<TestScenario>) => setDraft((current) => current ? { ...current, ...patch } : current);
  const patchStep = (patch: Partial<ScenarioStep>) => {
    if (!draft || !selectedStepId) return;
    const steps = draft.steps.map((step) => step.id === selectedStepId ? { ...step, ...patch } : step);
    patchDraft({ steps: patch.actionPosition ? orderScenarioSteps(steps) : steps });
  };

  const addStep = (asset: ScenarioAsset, position = assetTargetPosition, targetNodeId = assetTargetNodeId) => {
    if (!draft) return onAction("请先新建或选择场景");
    const isTestCase = asset.kind === "api_case" || asset.kind === "websocket_case";
    if (position === "main" && !isTestCase) return onAction("主流程节点必须绑定 HTTP 或 WebSocket 测试用例");
    if (position !== "main" && !targetNodeId) return onAction("请从画布中的测试用例添加前置或后置动作");
    const nodeId = position === "main" ? scenarioUniqueId("NODE") : targetNodeId!;
    const step = stepFromAsset(asset, nodeId, position);
    patchDraft({ steps: orderScenarioSteps([...draft.steps, step]) });
    setSelectedStepId(step.id);
    setAssetTargetPosition(position);
    setAssetTargetNodeId(nodeId);
    setActionPickerOpen(false);
    onAction(`已添加${scenarioPositionLabels[position]}动作 ${asset.name}`);
  };

  const openActionPicker = (nodeId: string | undefined, position: ScenarioActionPosition) => {
    setAssetTargetNodeId(nodeId);
    setAssetTargetPosition(position);
    setAssetSearch("");
    setActionPickerOpen(true);
  };

  const moveStep = (index: number, direction: -1 | 1) => {
    if (!draft) return;
    const current = draft.steps[index];
    if (current.actionPosition === "main") {
      const nodeIds = draft.steps.filter((step) => step.actionPosition === "main").map((step) => step.nodeId);
      const nodeIndex = nodeIds.indexOf(current.nodeId);
      const targetNodeIndex = nodeIndex + direction;
      if (targetNodeIndex < 0 || targetNodeIndex >= nodeIds.length) return;
      [nodeIds[nodeIndex], nodeIds[targetNodeIndex]] = [nodeIds[targetNodeIndex], nodeIds[nodeIndex]];
      patchDraft({ steps: nodeIds.flatMap((nodeId) => draft.steps.filter((step) => step.nodeId === nodeId)) });
      return;
    }
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= draft.steps.length) return;
    if (draft.steps[index].nodeId !== draft.steps[nextIndex].nodeId || draft.steps[index].actionPosition !== draft.steps[nextIndex].actionPosition) return;
    const next = [...draft.steps];
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    patchDraft({ steps: next });
  };

  const removeStep = (stepId: string) => {
    if (!draft) return;
    const removed = draft.steps.find((step) => step.id === stepId);
    const steps = draft.steps.filter((step) => step.id !== stepId && (removed?.actionPosition !== "main" || step.nodeId !== removed.nodeId));
    patchDraft({ steps });
    if (selectedStepId === stepId) setSelectedStepId(steps[0]?.id);
  };
  const patchDataset = (datasetId: string, patch: Partial<ScenarioDataset>) => {
    if (!draft) return;
    patchDraft({ datasets: draft.datasets.map((dataset) => dataset.id === datasetId ? { ...dataset, ...patch } : dataset) });
  };
  const removeDataset = (datasetId: string) => {
    if (!draft || draft.datasets.length === 1) return;
    const datasets = draft.datasets.filter((dataset) => dataset.id !== datasetId);
    patchDraft({ datasets });
    if (selectedDatasetId === datasetId) setSelectedDatasetId(undefined);
  };

  const executeStep = async (step: ScenarioStep) => {
    if (!projectId || step.referenceId === undefined) return onAction("只有引用测试用例的步骤支持单独执行");
    if (!draft?.environmentId) return onAction("请先选择场景执行环境");
    setDebuggingStepId(step.id);
    setStepDebugResults((current) => {
      const next = { ...current };
      delete next[step.id];
      return next;
    });
    try {
      const asset = assets.find((item) => item.kind === step.kind && String(item.referenceId) === String(step.referenceId));
      const config = {
        ...(asset?.requestConfig ?? {}),
        ...compileScenarioStepConfig(step, draft.steps),
        environment_id: draft.environmentId,
      };
      const result = step.kind === "websocket_case"
        ? await executeUnsavedWebSocketTestCase(projectId, config as unknown as WebSocketTestCaseRequestPayload)
        : await executeUnsavedTestCase(projectId, config as unknown as TestCaseRequestPayload);
      setStepDebugResults((current) => ({ ...current, [step.id]: normalizeScenarioStepDebug(result, step.kind) }));
    } catch (error) {
      onAction(error instanceof Error ? error.message : "步骤执行失败");
    } finally {
      setDebuggingStepId(undefined);
    }
  };

  const persist = async () => {
    if (!projectId || !draft) return;
    if (!draft.name.trim()) return onAction("请输入场景名称");
    if (draft.steps.length === 0) return onAction("请至少添加一个场景步骤");
    if (!draft.steps.some((step) => step.actionPosition === "main")) return onAction("请至少添加一个主测试用例节点");
    if (draft.steps.some((step) => step.actionPosition === "main" && step.kind !== "api_case" && step.kind !== "websocket_case")) return onAction("主流程节点只能绑定 HTTP 或 WebSocket 测试用例");
    if (!draft.environmentId) return onAction("请选择执行环境");
    for (const step of draft.steps) {
      try {
        JSON.parse(step.configText || "{}");
      } catch {
        setSelectedStepId(step.id);
        setTab("design");
        return onAction(`步骤“${step.name}”配置不是合法 JSON`);
      }
    }
    const scriptError = firstScenarioScriptError(draft.steps);
    if (scriptError) {
      setSelectedStepId(scriptError.stepId);
      setTab("design");
      return onAction(scriptError.message);
    }
    for (const dataset of draft.datasets) {
      try {
        JSON.parse(dataset.variablesText || "{}");
      } catch {
        setTab("data");
        return onAction(`数据集“${dataset.name}”变量不是合法 JSON`);
      }
    }
    setBusy(true);
    try {
      const saved = await saveScenario(projectId, { ...draft, name: draft.name.trim(), description: draft.description.trim() });
      await reload();
      setDraft(saved);
      onAction(`已保存场景 ${saved.name}`);
    } catch (error) {
      onAction(error instanceof Error ? error.message : "场景保存失败");
    } finally {
      setBusy(false);
    }
  };

  const copyCurrent = async () => {
    if (!projectId || !draft || !scenarios.some((item) => item.id === draft.id)) return;
    setBusy(true);
    try {
      const copied = await duplicateScenario(projectId, draft);
      await reload();
      setDraft(copied);
      setSelectedStepId(copied.steps[0]?.id);
      onAction(`已复制场景 ${draft.name}`);
    } catch (error) {
      onAction(error instanceof Error ? error.message : "场景复制失败");
    } finally {
      setBusy(false);
    }
  };

  const deleteCurrent = async () => {
    if (!projectId || !draft || !scenarios.some((item) => item.id === draft.id)) return;
    setBusy(true);
    try {
      await deleteScenario(projectId, draft.id);
      await reload();
      setDraft(undefined);
      setSelectedStepId(undefined);
      onAction(`已删除场景 ${draft.name}`);
    } catch (error) {
      onAction(error instanceof Error ? error.message : "场景删除失败");
    } finally {
      setBusy(false);
      setPendingDelete(undefined);
    }
  };

  const execute = async () => {
    if (!projectId || !draft) return onAction("请先选择场景");
    if (draft.steps.length === 0) return onAction("场景没有可执行步骤");
    if (!draft.environmentId) return onAction("请选择执行环境");
    const scriptError = firstScenarioScriptError(draft.steps);
    if (scriptError) {
      setSelectedStepId(scriptError.stepId);
      setTab("design");
      return onAction(scriptError.message);
    }
    setTab("design");
    setBusy(true);
    setRunningScenario(true);
    setStepDebugResults({});
    setExecutionRuns([]);
    setSelectedExecutionRunId(undefined);
    setRunProgressById({});
    setRunStatusById({});
    setRunNoticeById({});
    const controller = new AbortController();
    setScenarioRunAbortController(controller);
    try {
      const saved = await saveScenario(projectId, draft);
      const launch = await runScenario(projectId, saved, { environmentId: saved.environmentId });
      if (!launch.runs.length) throw new Error("场景执行未创建任何运行记录");
      setExecutionRuns(launch.runs);
      setSelectedExecutionRunId(launch.runs[0].runId);
      setRunProgressById(Object.fromEntries(launch.runs.map((run) => [run.runId, { stepStatuses: {} }])));
      setRunStatusById(Object.fromEntries(launch.runs.map((run) => [run.runId, run.status])));
      const waitForRun = async (run: ScenarioRunLaunchItem) => {
        try {
          await subscribeScenarioRunEvents(projectId, run, (event) => {
            setRunProgressById((current) => ({
              ...current,
              [run.runId]: nextLiveProgress(current[run.runId] ?? { stepStatuses: {} }, event),
            }));
            setRunStatusById((current) => ({
              ...current,
              [run.runId]: event.event === "run_completed"
                ? (event.status as ScenarioRun["status"] || "passed")
                : event.event === "run_failed"
                  ? "failed"
                  : event.event === "run_cancelled"
                    ? "cancelled"
                    : event.event === "run_started" || event.event === "step_started"
                      ? "running"
                      : current[run.runId] ?? run.status,
            }));
          }, {
            signal: controller.signal,
            onReconnect: (attempt, lastEventId) => {
              setRunNoticeById((current) => ({
                ...current,
                [run.runId]: {
                  message: `实时连接中断，正在进行第 ${attempt} 次重连（已接收至事件 ${lastEventId}）`,
                  tone: "warning",
                },
              }));
            },
            onReconnected: (lastEventId) => {
              setRunNoticeById((current) => ({
                ...current,
                [run.runId]: {
                  message: `实时连接已恢复，从事件 ${lastEventId} 之后继续接收`,
                  tone: "success",
                },
              }));
            },
            onSequenceGap: async (expectedSequence, receivedSequence) => {
              setRunNoticeById((current) => ({
                ...current,
                [run.runId]: {
                  message: `检测到事件序号缺口（期望 ${expectedSequence}，收到 ${receivedSequence}），正在按运行详情校准`,
                  tone: "warning",
                },
              }));
              const detail = await getScenarioRun(projectId, run.runId);
              setRuns((current) => [detail, ...current.filter((item) => item.id !== detail.id)]);
              setRunProgressById((current) => ({ ...current, [run.runId]: progressFromRunDetail(detail) }));
              setRunStatusById((current) => ({ ...current, [run.runId]: detail.status }));
              setRunNoticeById((current) => ({
                ...current,
                [run.runId]: { message: "运行状态已按服务端详情完成校准", tone: "success" },
              }));
            },
            onHistoryExpired: async () => {
              const detail = await getScenarioRun(projectId, run.runId);
              setRuns((current) => [detail, ...current.filter((item) => item.id !== detail.id)]);
              setRunProgressById((current) => ({ ...current, [run.runId]: progressFromRunDetail(detail) }));
              setRunStatusById((current) => ({ ...current, [run.runId]: detail.status }));
              setRunNoticeById((current) => ({
                ...current,
                [run.runId]: {
                  message: "实时事件历史已过期，已切换到服务端运行详情恢复状态",
                  tone: "info",
                },
              }));
            },
          });
        } catch (error) {
          if (controller.signal.aborted) throw error;
          setRunNoticeById((current) => ({
            ...current,
            [run.runId]: {
              message: error instanceof Error ? `${error.message}，正在通过运行详情继续校准` : "实时连接失败，正在通过运行详情继续校准",
              tone: "warning",
            },
          }));
        }

        let detail = await getScenarioRun(projectId, run.runId);
        while (!isTerminalRunStatus(detail.status) && !controller.signal.aborted) {
          await new Promise((resolve) => window.setTimeout(resolve, 750));
          detail = await getScenarioRun(projectId, run.runId);
        }
        setRunProgressById((current) => ({ ...current, [run.runId]: progressFromRunDetail(detail) }));
        setRunStatusById((current) => ({ ...current, [run.runId]: detail.status }));
        return detail;
      };
      const detailedRuns = await Promise.all(launch.runs.map(waitForRun));
      await reload();
      const latestRun = detailedRuns[0];
      setRuns((current) => [...detailedRuns, ...current.filter((run) => !detailedRuns.some((item) => item.id === run.id))]);
      setDraft({ ...saved, lastRunAt: latestRun?.startedAt });
      setStepDebugResults({});
      setTab("history");
      onAction(`场景 ${saved.name} 已运行 ${detailedRuns.length} 组数据，${detailedRuns.some((run) => run.status === "failed" || run.status === "timeout") ? "存在失败" : "全部通过"}`);
    } catch (error) {
      if (!controller.signal.aborted) onAction(error instanceof Error ? error.message : "场景执行失败");
    } finally {
      controller.abort();
      setScenarioRunAbortController(undefined);
      setRunningScenario(false);
      setBusy(false);
    }
  };

  const loadRunDetail = async (run: ScenarioRun) => {
    if (!projectId || run.detailLoaded || loadingRunIds.has(run.id)) return;
    setLoadingRunIds((current) => new Set(current).add(run.id));
    try {
      const detail = await getScenarioRun(projectId, run.id);
      setRuns((current) => current.map((item) => item.id === run.id ? detail : item));
    } catch (error) {
      onAction(error instanceof Error ? error.message : "运行详情加载失败");
    } finally {
      setLoadingRunIds((current) => {
        const next = new Set(current);
        next.delete(run.id);
        return next;
      });
    }
  };

  const deleteRun = async (run: ScenarioRun) => {
    if (!projectId || deletingRunIds.has(run.id)) return;
    setDeletingRunIds((current) => new Set(current).add(run.id));
    try {
      await deleteScenarioRun(projectId, run.id);
      setRuns((current) => current.filter((item) => item.id !== run.id));
      setLoadingRunIds((current) => {
        const next = new Set(current);
        next.delete(run.id);
        return next;
      });
      onAction(`已删除调试记录 ${scenarioRunIdentity(run, draft)}`);
    } catch (error) {
      onAction(error instanceof Error ? error.message : "调试记录删除失败");
    } finally {
      setDeletingRunIds((current) => {
        const next = new Set(current);
        next.delete(run.id);
        return next;
      });
      setPendingDelete(undefined);
    }
  };

  return (
    <section className="page page-scenarios">
      {!projectId && <div className="alert-banner"><Icon name="info" /><div><strong>请先选择项目</strong><p>场景组合按项目隔离，选择项目后可编排和运行场景。</p></div></div>}
      <div className="scenario-command-bar">
        <div className="scenario-command-main">
          <div className="tabs">
            <button className={tab === "design" ? "active" : ""} onClick={() => { setTab("design"); setSelectedDatasetId(undefined); }} type="button"><Icon name="account_tree" />流程设计</button>
            <button className={tab === "data" ? "active" : ""} onClick={() => setTab("data")} type="button"><Icon name="database" />数据驱动</button>
            <button className={tab === "history" ? "active" : ""} onClick={() => { setTab("history"); setSelectedDatasetId(undefined); }} type="button"><Icon name="history" />调试记录</button>
          </div>
          {draft && <span className="scenario-command-version"><Icon name="layers" />v{draft.version || "草稿"}</span>}
        </div>
        <div className="scenario-actions">
          <button className="btn scenario-copy-button" disabled={busy || !draft || !scenarios.some((item) => item.id === draft.id)} onClick={copyCurrent} type="button"><Icon name="content_copy" />复制</button>
          <button className="btn danger scenario-delete-button" disabled={busy || !draft || !scenarios.some((item) => item.id === draft.id)} onClick={() => draft && setPendingDelete({ type: "scenario", scenario: draft })} type="button"><Icon name="delete" />删除</button>
          <button className="btn scenario-save-button" disabled={busy || !draft} onClick={persist} type="button"><Icon name="save" />保存场景</button>
          <button className={runningScenario ? "btn primary loading" : "btn primary"} disabled={busy || !draft} onClick={execute} type="button"><Icon name={runningScenario ? "progress_activity" : "play_arrow"} />{runningScenario ? "运行中" : "运行场景"}</button>
        </div>
      </div>

      {scenarioConnectionNotice && (
        <div className={`scenario-connection-notice ${scenarioConnectionNotice.tone}`} role="status">
          <Icon name={scenarioConnectionNotice.tone === "success" ? "check_circle" : scenarioConnectionNotice.tone === "warning" ? "sync_problem" : "info"} />
          <span>{scenarioConnectionNotice.message}</span>
          <button aria-label="关闭实时连接提示" onClick={() => selectedExecutionRunId && setRunNoticeById((current) => ({ ...current, [selectedExecutionRunId]: undefined }))} type="button">
            <Icon name="close" />
          </button>
        </div>
      )}

      <div className="scenario-workspace">
        <aside className="scenario-sidebar">
          <div className="scenario-panel-head"><div><span className="eyebrow">Scenarios</span><h3>场景列表</h3></div><button className="icon-btn" disabled={!projectId} onClick={createScenario} title="新建场景" type="button"><Icon name="add" /></button></div>
          <label className="scenario-search"><Icon name="search" /><input onChange={(event) => setScenarioSearch(event.target.value)} placeholder="搜索场景" value={scenarioSearch} /></label>
          <div className="scenario-list">
            {scenarioPagination.pageItems.map((scenario) => <button className={draft?.id === scenario.id ? "scenario-list-item active" : "scenario-list-item"} disabled={busy} key={scenario.id} onClick={() => void selectScenario(scenario)} type="button"><span><strong>{scenario.name}</strong><small>{scenario.steps.length} 步骤 · {scenario.datasets.length} 数据集 · v{scenario.version}</small></span><Icon name="chevron_right" /></button>)}
            {filteredScenarios.length === 0 && <div className="scenario-empty-mini"><Icon name="account_tree" /><span>{scenarios.length ? "没有匹配场景" : "暂无场景"}</span><button disabled={!projectId} onClick={createScenario} type="button">新建场景</button></div>}
          </div>
          <Pagination compact itemLabel="个场景" onPageChange={scenarioPagination.setPage} onPageSizeChange={scenarioPagination.setPageSize} page={scenarioPagination.page} pageSize={scenarioPagination.pageSize} total={filteredScenarios.length} />
          <div className="scenario-divider" />
          <div className="scenario-panel-head"><div><span className="eyebrow">Test cases</span><h3>主流程测试用例</h3></div></div>
          <p className="scenario-asset-hint">从这里添加主测试用例；工具和脚本请在画布用例卡中添加为前置或后置动作。</p>
          <label className="scenario-search"><Icon name="search" /><input onChange={(event) => setAssetSearch(event.target.value)} placeholder="搜索 HTTP 或 WebSocket 用例" value={assetSearch} /></label>
          {assetError && <p className="scenario-inline-error">{assetError}</p>}
          <div className="scenario-asset-list">
            {assetLoading && <p className="scenario-muted">正在加载测试用例...</p>}
            {testCaseAssets.map((asset, index) => <button disabled={!draft} key={`${asset.kind}-${asset.referenceId ?? index}`} onClick={() => addStep(asset, "main", undefined)} type="button"><b className={`scenario-method ${asset.kind}`}>{asset.method}</b><span><strong>{asset.name}</strong><small>主测试用例 · {asset.path}</small></span><Icon name="add_circle" /></button>)}
            {!assetLoading && testCaseAssets.length === 0 && <p className="scenario-muted">没有匹配的测试用例</p>}
          </div>
        </aside>

        <main className="scenario-canvas">
          {!draft ? <ScenarioWelcome hasProject={Boolean(projectId)} onCreate={createScenario} /> : <>
            <header className="scenario-title-editor">
              <div><span className="eyebrow">场景编排</span><input aria-label="场景名称" onChange={(event) => patchDraft({ name: event.target.value })} value={draft.name} /><textarea aria-label="场景说明" onChange={(event) => patchDraft({ description: event.target.value })} placeholder="说明业务流程、验证目标和使用范围" value={draft.description} /></div>
              <div className="scenario-title-meta"><span><Icon name="format_list_numbered" />{draft.steps.length} 个步骤</span><span><Icon name="database" />{draft.datasets.length} 个数据集</span><span><Icon name="history" />{formatDate(draft.lastRunAt)}</span></div>
            </header>
            {tab === "design" && executionRuns.length > 0 && <section className="scenario-run-switcher" aria-label="当前画布运行">
              <div className="scenario-run-switcher-heading">
                <span><Icon name="monitoring" />当前画布运行</span>
                <strong>{selectedExecutionRun ? scenarioRunIdentity(selectedExecutionRun, draft) : "请选择运行记录"}</strong>
                <small>切换后画布状态、连接提示和步骤结果会同步更新</small>
              </div>
              <div className="scenario-run-switcher-options" role="tablist">
                {executionRuns.map((run, index) => {
                  const status = runStatusById[run.runId] ?? run.status;
                  return <button
                    aria-label={`查看运行 ${scenarioRunIdentity(run, draft)}`}
                    aria-selected={selectedExecutionRunId === run.runId}
                    className={selectedExecutionRunId === run.runId ? "active" : ""}
                    key={run.runId}
                    onClick={() => setSelectedExecutionRunId(run.runId)}
                    role="tab"
                    type="button"
                  >
                    <b>{index + 1}</b>
                    <span><strong>{run.datasetName}</strong><small>{scenarioRunRecordLabel(run, draft) || "单条测试记录"}</small></span>
                    <em className={status}>{status}</em>
                  </button>;
                })}
              </div>
            </section>}
            {tab === "design" && <DesignTab debuggingStepId={debuggingStepId} draft={draft} latestRun={displayedDraftRun} liveProgress={runningScenario ? scenarioRunProgress : undefined} moveStep={moveStep} onAddAction={openActionPicker} onExecute={executeStep} onRemove={removeStep} onSelect={setSelectedStepId} selectedStepId={selectedStepId} stepDebugResults={stepDebugResults} />}
            {tab === "data" && <DataTab draft={draft} navigationTarget={dataNavigationTarget} onChange={(datasets) => patchDraft({ datasets })} onNavigated={() => setDataNavigationTarget(undefined)} onSelectDataset={setSelectedDatasetId} selectedDatasetId={selectedDatasetId} />}
            {tab === "history" && <HistoryTab deletingRunIds={deletingRunIds} loadingRunIds={loadingRunIds} onDeleteRun={(run) => setPendingDelete({ type: "run", run })} onLoadRun={loadRunDetail} runs={runs.filter((run) => run.scenarioId === draft.id)} scenario={draft} />}
          </>}
        </main>

        <aside className="scenario-inspector">
          {!draft
            ? <div className="scenario-empty-mini tall"><Icon name="tune" /><span>选择场景后配置属性</span></div>
            : selectedStep && tab === "design"
              ? <StepInspector allSteps={draft.steps} baseRequestConfig={selectedStepAsset?.requestConfig} debugResult={stepDebugResults[selectedStep.id]} debugging={debuggingStepId === selectedStep.id} onChange={patchStep} onExecute={() => void executeStep(selectedStep)} runResult={displayedDraftRun?.stepResults.find((result) => result.stepId === selectedStep.id)} step={selectedStep} />
              : tab === "data" && selectedDatasetId && draft.datasets.some((dataset) => dataset.id === selectedDatasetId)
                ? <DatasetInspector dataset={draft.datasets.find((dataset) => dataset.id === selectedDatasetId)!} fields={collectScenarioRequestFields(draft.steps)} onChange={(patch) => patchDataset(selectedDatasetId, patch)} onClose={() => setSelectedDatasetId(undefined)} onDelete={() => removeDataset(selectedDatasetId)} removable={draft.datasets.length > 1} />
                : <ScenarioInspector draft={draft} environments={environments} onChange={patchDraft} />}
        </aside>
      </div>
      {actionPickerOpen && <div className="modal-backdrop scenario-action-picker-backdrop" onMouseDown={() => setActionPickerOpen(false)}><section aria-label={`添加${scenarioPositionLabels[assetTargetPosition]}动作`} aria-modal="true" className={`scenario-action-picker ${assetTargetPosition}`} onMouseDown={(event) => event.stopPropagation()} role="dialog">
        <div className="modal-head"><div><span className="eyebrow">Add {assetTargetPosition} action</span><h3>添加{scenarioPositionLabels[assetTargetPosition]}动作</h3><p>{assetTargetPosition === "main" ? "选择一个测试用例创建新的主流程节点。" : `动作将绑定到测试用例“${assetTargetNode?.name ?? "未选择"}”。`}</p></div><button aria-label="关闭动作选择" className="icon-btn" onClick={() => setActionPickerOpen(false)} type="button"><Icon name="close" /></button></div>
        <div className={`scenario-action-picker-phase ${assetTargetPosition}`}><Icon name={assetTargetPosition === "before" ? "first_page" : assetTargetPosition === "after" ? "last_page" : "account_tree"} /><span><strong>{scenarioPositionLabels[assetTargetPosition]}动作</strong><small>{assetTargetPosition === "before" ? "准备数据、变量与依赖" : assetTargetPosition === "after" ? "清理数据、恢复环境与收尾处理" : "创建测试用例节点"}</small></span></div>
        <label className="scenario-search"><Icon name="search" /><input autoFocus onChange={(event) => setAssetSearch(event.target.value)} placeholder={`搜索可添加的${scenarioPositionLabels[assetTargetPosition]}动作`} value={assetSearch} /></label>
        {assetError && <p className="scenario-inline-error">{assetError}</p>}
        <div className="scenario-action-picker-list">{assetLoading && <p className="scenario-muted">正在加载测试用例...</p>}{pickerAssets.map((asset, index) => <button key={`${asset.kind}-${asset.referenceId ?? index}`} onClick={() => addStep(asset, assetTargetPosition, assetTargetNodeId)} type="button"><b className={`scenario-method ${asset.kind}`}>{asset.method}</b><span><strong>{asset.name}</strong><small>{asset.referenceId === undefined ? "工具或脚本" : "测试用例"} · {asset.path}</small></span><Icon name="add" /></button>)}{!assetLoading && pickerAssets.length === 0 && <p className="scenario-muted">没有匹配的{scenarioPositionLabels[assetTargetPosition]}动作</p>}</div>
      </section></div>}
      {pendingDelete && <ConfirmDialog
        busy={pendingDelete.type === "scenario" ? busy : deletingRunIds.has(pendingDelete.run.id)}
        confirmLabel="确认删除"
        description={pendingDelete.type === "scenario"
          ? `场景“${pendingDelete.scenario.name}”及其配置将被删除。`
          : `“${scenarioRunIdentity(pendingDelete.run, draft)}”这条调试记录删除后无法恢复。`}
        onCancel={() => setPendingDelete(undefined)}
        onConfirm={() => void (pendingDelete.type === "scenario" ? deleteCurrent() : deleteRun(pendingDelete.run))}
        title={pendingDelete.type === "scenario" ? "删除场景？" : "删除调试记录？"}
      />}
    </section>
  );
}

function ScenarioWelcome({ hasProject, onCreate }: { hasProject: boolean; onCreate: () => void }) {
  return <div className="scenario-welcome"><span><Icon name="account_tree" /></span><h2>组合可复用的业务测试场景</h2><p>从 HTTP 或 WebSocket 用例开始，加入条件与等待步骤，配置数据集后即可运行调试。</p><button className="btn primary" disabled={!hasProject} onClick={onCreate} type="button"><Icon name="add" />新建场景</button></div>;
}

interface ScenarioBindingLink {
  binding: ScenarioBinding;
  extraction: ScenarioExtraction;
  sourceStep: ScenarioStep;
  sourceStepNumber: number;
  targetStep: ScenarioStep;
  targetStepNumber: number;
}

function scenarioBindingLinks(steps: ScenarioStep[]) {
  return steps.flatMap((targetStep, targetIndex) => readScenarioContext(targetStep.configText).bindings.flatMap((binding) => {
    const sourceIndex = steps.findIndex((step) => step.id === binding.sourceStepId);
    if (sourceIndex < 0) return [];
    const sourceStep = steps[sourceIndex];
    const extraction = readScenarioContext(sourceStep.configText).extractions.find((item) => item.id === binding.sourceExtractionId);
    if (!extraction) return [];
    return [{
      binding,
      extraction,
      sourceStep,
      sourceStepNumber: sourceIndex + 1,
      targetStep,
      targetStepNumber: targetIndex + 1,
    }];
  }));
}

function bindingTargetLabel(binding: ScenarioBinding) {
  const target = {
    path: "路径",
    headers: "Header",
    query_params: "Query",
    body: "Body",
  }[binding.target];
  return binding.targetPath ? `${target}.${binding.targetPath}` : target;
}

function runtimeValue(value: unknown, masked = false) {
  if (masked) return "••••••";
  if (value === undefined) return "运行后显示";
  if (value === null) return "null";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

interface ScenarioRuntimeTrace {
  value: unknown;
  masked: boolean;
  error?: string;
  source: "debug" | "run";
}

function debugLinkRuntimeValue(link: ScenarioBindingLink, stepDebugResults?: Record<string, ScenarioStepDebugResult>): ScenarioRuntimeTrace | undefined {
  const debugResult = stepDebugResults?.[link.sourceStep.id];
  if (!debugResult) return undefined;
  const extraction = extractScenarioDebugValue(debugResult, link.extraction.path, link.extraction.messageIndex);
  return {
    value: extraction.value,
    masked: Boolean(link.extraction.masked),
    error: extraction.error,
    source: "debug",
  };
}

function linkRuntimeValue(
  link: ScenarioBindingLink,
  run: ScenarioRun | undefined,
  direction: "input" | "output",
  stepDebugResults?: Record<string, ScenarioStepDebugResult>,
): ScenarioRuntimeTrace | undefined {
  if (direction === "output") {
    const debugValue = debugLinkRuntimeValue(link, stepDebugResults);
    if (debugValue) return debugValue;
  }
  if (direction === "input") {
    const targetResult = run?.stepResults.find((result) => result.stepId === link.targetStep.id);
    const bindingValue = targetResult?.resolvedBindings?.find((item) => item.bindingId === link.binding.id);
    return bindingValue ? { value: bindingValue.value, masked: bindingValue.masked, error: "", source: "run" } : undefined;
  }
  const sourceResult = run?.stepResults.find((result) => result.stepId === link.sourceStep.id);
  const extractionValue = sourceResult?.extractedVariables?.find((item) => item.extractionId === link.extraction.id);
  return extractionValue
    ? { value: extractionValue.value, masked: extractionValue.masked, error: extractionValue.error, source: "run" }
    : undefined;
}

function runtimeTraceValue(trace?: { value: unknown; masked: boolean; error?: string }) {
  if (trace?.error) return `提取失败：${trace.error}`;
  return runtimeValue(trace?.value, trace?.masked);
}

function RuntimeValue({ trace }: { trace?: ScenarioRuntimeTrace }) {
  return <em className={`scenario-reference-value${trace?.error ? " error" : ""}${trace?.source === "debug" ? " debug" : ""}`}>
    {trace?.source === "debug" && <span>调试值</span>}
    {runtimeTraceValue(trace)}
  </em>;
}

function IncomingReferences({ links, run }: { links: ScenarioBindingLink[]; run?: ScenarioRun }) {
  const [expanded, setExpanded] = useState(false);
  if (!links.length) return null;
  return <section className={`scenario-reference-group incoming${expanded ? "" : " collapsed"}`}>
    <header>
      <span><Icon name="call_received" />上游输入</span>
      <span className="scenario-reference-summary"><b>{links.length} 条</b><button aria-expanded={expanded} aria-label={`${expanded ? "收起" : "展开"}上游输入`} onClick={(event) => { event.stopPropagation(); setExpanded((current) => !current); }} type="button"><span>{expanded ? "收起" : "展开"}</span><Icon name="expand_more" /></button></span>
    </header>
    {expanded && <div className="scenario-reference-list">{links.map((link) => {
      const trace = linkRuntimeValue(link, run, "input");
      return <div className="scenario-reference-row" key={link.binding.id} title={`从步骤 ${link.sourceStepNumber} 的响应 ${link.extraction.path} 写入 ${bindingTargetLabel(link.binding)}`}>
        <span className="scenario-reference-step"><b>步骤 {link.sourceStepNumber}</b><small>{link.sourceStep.name}</small></span>
        <Icon name="arrow_forward" />
        <span className="scenario-reference-variable"><code>{link.extraction.name || link.extraction.path}</code><small>响应：{link.extraction.path}</small></span>
        <Icon name="arrow_forward" />
        <span className="scenario-reference-target"><b>{bindingTargetLabel(link.binding)}</b><small>当前步骤写入位置</small></span>
        <RuntimeValue trace={trace} />
      </div>;
    })}</div>}
  </section>;
}

function OutgoingReferences({ links, run, stepDebugResults }: { links: ScenarioBindingLink[]; run?: ScenarioRun; stepDebugResults?: Record<string, ScenarioStepDebugResult> }) {
  const [expanded, setExpanded] = useState(false);
  if (!links.length) return null;
  const grouped = links.reduce<Array<{ extractionId: string; links: ScenarioBindingLink[] }>>((groups, link) => {
    const existing = groups.find((group) => group.extractionId === link.extraction.id);
    if (existing) existing.links.push(link);
    else groups.push({ extractionId: link.extraction.id, links: [link] });
    return groups;
  }, []);
  return <section className={`scenario-reference-group outgoing${expanded ? "" : " collapsed"}`}>
    <header>
      <span><Icon name="call_made" />下游引用</span>
      <span className="scenario-reference-summary"><b>{grouped.length} 个变量 · {links.length} 处</b><button aria-expanded={expanded} aria-label={`${expanded ? "收起" : "展开"}下游引用`} onClick={(event) => { event.stopPropagation(); setExpanded((current) => !current); }} type="button"><span>{expanded ? "收起" : "展开"}</span><Icon name="expand_more" /></button></span>
    </header>
    {expanded && <div className="scenario-reference-list">{grouped.map((group) => {
      const first = group.links[0];
      const trace = linkRuntimeValue(first, run, "output", stepDebugResults);
      return <div className="scenario-reference-output" key={group.extractionId}>
        <div className="scenario-reference-output-head">
          <span className="scenario-reference-variable"><code>{first.extraction.name || first.extraction.path}</code><small>响应：{first.extraction.path}</small></span>
          <RuntimeValue trace={trace} />
        </div>
        <div className="scenario-reference-targets">{group.links.map((link) => <div key={link.binding.id}>
          <Icon name="subdirectory_arrow_right" />
          <span className="scenario-reference-step"><b>步骤 {link.targetStepNumber}</b><small>{link.targetStep.name}</small></span>
          <span className="scenario-reference-target"><b>{bindingTargetLabel(link.binding)}</b><small>写入位置</small></span>
        </div>)}</div>
      </div>;
    })}</div>}
  </section>;
}

function DesignTab({ debuggingStepId, draft, latestRun, liveProgress, moveStep, onAddAction, onExecute, onRemove, onSelect, selectedStepId, stepDebugResults }: { debuggingStepId?: string; draft: TestScenario; latestRun?: ScenarioRun; liveProgress?: ScenarioLiveProgress; moveStep: (index: number, direction: -1 | 1) => void; onAddAction: (nodeId: string | undefined, position: ScenarioActionPosition) => void; onExecute: (step: ScenarioStep) => void; onRemove: (id: string) => void; onSelect: (id: string) => void; selectedStepId?: string; stepDebugResults: Record<string, ScenarioStepDebugResult> }) {
  const links = scenarioBindingLinks(draft.steps);
  const mainSteps = draft.steps.filter((step) => step.actionPosition === "main");
  const renderStep = (step: ScenarioStep) => {
    const index = draft.steps.findIndex((item) => item.id === step.id);
    const position = step.actionPosition;
    const siblings = position === "main" ? mainSteps : draft.steps.filter((item) => item.nodeId === step.nodeId && item.actionPosition === position);
    const siblingIndex = siblings.findIndex((item) => item.id === step.id);
    const incoming = links.filter((link) => link.targetStep.id === step.id);
    const outgoing = links.filter((link) => link.sourceStep.id === step.id);
    const runResult = latestRun?.stepResults.find((result) => result.stepId === step.id);
    const debugResult = stepDebugResults[step.id];
    const debugFailed = debugResult && ["failed", "error", "timeout", "cancelled"].includes(debugResult.status.toLowerCase());
    const debugState = liveProgress || !debugResult ? "" : debugFailed ? " debug-failed" : debugResult.status.toLowerCase() === "passed" ? " debug-passed" : "";
    const liveStatus = liveProgress?.stepStatuses[index];
    const runState = !liveProgress
      ? ""
      : index === liveProgress.currentStepIndex
        ? " flow-running"
        : liveStatus === "passed"
          ? " flow-complete"
          : liveStatus === "failed" || liveStatus === "timeout"
            ? " flow-failed"
            : liveStatus === "skipped"
              ? " flow-skipped"
              : " flow-pending";
    const previousStatus = liveProgress?.stepStatuses[index - 1];
    const connectorState = !liveProgress
      ? ""
      : index === liveProgress.transitionTargetIndex || index === liveProgress.currentStepIndex
        ? " flow-active"
        : previousStatus === "passed"
          ? " flow-complete"
          : previousStatus === "failed" || previousStatus === "timeout"
            ? " flow-failed"
            : " flow-pending";
    return <div className={`${incoming.length ? "scenario-step-wrap has-bindings" : "scenario-step-wrap"}${runState}`} key={step.id}>
    {index > 0 && <div className={`${incoming.length ? "scenario-connector has-bindings" : "scenario-connector"}${connectorState}`}>
      <div aria-hidden="true" className="scenario-connector-track">
        <span className="scenario-connector-port source" />
        <span className="scenario-connector-line" />
        <span className="scenario-flow-pulse primary" />
        <span className="scenario-flow-pulse secondary" />
        <span className="scenario-connector-port target"><Icon name="arrow_downward" /></span>
      </div>
      {incoming.length > 0 && <div className="scenario-connector-bindings"><Icon name="account_tree" /><span><b>{incoming.length} 条数据引用</b><small>进入步骤 {index + 1}</small></span><span className="scenario-connector-sources">{[...new Set(incoming.map((link) => link.sourceStepNumber))].map((stepNumber) => <i key={stepNumber}>步骤 {stepNumber}</i>)}</span></div>}
    </div>}
    <article className={`${selectedStepId === step.id ? "scenario-step-card active" : "scenario-step-card"}${runState}${debugState}`} onClick={() => onSelect(step.id)}>
      <b className="scenario-step-index">{index + 1}</b><span className={`scenario-method ${step.kind}`}>{step.method}</span>
      <div className="scenario-step-main"><strong>{step.name}</strong><small>{step.path || "无附加说明"}</small></div>
      {!liveProgress && debugResult
        ? <span className={`scenario-step-run-status debug ${debugFailed ? "failed" : debugResult.status.toLowerCase()}`}>单步{debugFailed ? "失败" : debugResult.status.toLowerCase() === "passed" ? "通过" : debugResult.status} · {debugResult.durationMs}ms</span>
        : runResult && <span className={`scenario-step-run-status ${runResult.status}`}>{runResult.status} · {runResult.durationMs}ms</span>}
      <span className={`scenario-step-policy ${position}`}>{scenarioPositionLabels[position]} · {position === "after" ? "始终执行" : step.continueOnFailure ? "失败继续" : "失败停止"}</span>
      <div className="scenario-step-actions">{step.referenceId !== undefined && <button className={debuggingStepId === step.id ? "run loading" : "run"} disabled={Boolean(debuggingStepId)} onClick={(event) => { event.stopPropagation(); onExecute(step); }} title="单独执行步骤" type="button"><Icon name={debuggingStepId === step.id ? "progress_activity" : "play_arrow"} /></button>}<button disabled={siblingIndex <= 0} onClick={(event) => { event.stopPropagation(); moveStep(index, -1); }} title="上移" type="button"><Icon name="arrow_upward" /></button><button disabled={siblingIndex < 0 || siblingIndex >= siblings.length - 1} onClick={(event) => { event.stopPropagation(); moveStep(index, 1); }} title="下移" type="button"><Icon name="arrow_downward" /></button><button className="danger" onClick={(event) => { event.stopPropagation(); onRemove(step.id); }} title="移除步骤" type="button"><Icon name="delete" /></button></div>
      {(incoming.length > 0 || outgoing.length > 0) && <div className="scenario-step-references"><IncomingReferences links={incoming} run={latestRun} /><OutgoingReferences links={outgoing} run={latestRun} stepDebugResults={stepDebugResults} /></div>}
    </article>
  </div>;
  };
  return <div className="scenario-step-lane">
    {mainSteps.length === 0 && <button className="scenario-phase-empty" onClick={() => onAddAction(undefined, "main")} type="button"><Icon name="add_circle" /><span><strong>尚未添加主测试用例</strong><small>从项目测试用例中选择 API 或 WebSocket 用例</small></span></button>}
    {mainSteps.map((mainStep, nodeIndex) => {
      const beforeActions = draft.steps.filter((step) => step.nodeId === mainStep.nodeId && step.actionPosition === "before");
      const afterActions = draft.steps.filter((step) => step.nodeId === mainStep.nodeId && step.actionPosition === "after");
      return <section className="scenario-case-node" key={mainStep.nodeId}>
        <header className="scenario-case-node-head"><span>测试用例节点 {nodeIndex + 1}</span><strong>{mainStep.name}</strong></header>
        {beforeActions.length > 0 && <div className="scenario-node-actions before">{beforeActions.map(renderStep)}</div>}
        {renderStep(mainStep)}
        <div className="scenario-node-action-bar">
          <button onClick={() => onAddAction(mainStep.nodeId, "before")} type="button"><Icon name="add" />添加前置动作</button>
          <span>动作仅绑定当前测试用例</span>
          <button onClick={() => onAddAction(mainStep.nodeId, "after")} type="button"><Icon name="add" />添加后置动作</button>
        </div>
        {afterActions.length > 0 && <div className="scenario-node-actions after">{afterActions.map(renderStep)}</div>}
      </section>;
    })}
  </div>;
}

function parseStepConfig(configText: string) {
  try {
    const value = JSON.parse(configText || "{}") as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

interface UpstreamVariableOption {
  sourceStep: ScenarioStep;
  stepNumber: number;
  extraction: ScenarioExtraction;
}

type ScenarioAssertion = TestCaseAssertion | WebSocketAssertion;
type ConditionOperator = "==" | "!=" | ">" | ">=" | "<" | "<=";
type ConditionValueType = "string" | "number" | "boolean" | "null";
type WaitUnit = "ms" | "s" | "min";

interface ParsedCondition {
  left: string;
  operator: ConditionOperator;
  value: string;
  valueType: ConditionValueType;
}

const conditionOperators: Array<{ label: string; value: ConditionOperator }> = [
  { label: "等于", value: "==" },
  { label: "不等于", value: "!=" },
  { label: "大于", value: ">" },
  { label: "大于等于", value: ">=" },
  { label: "小于", value: "<" },
  { label: "小于等于", value: "<=" },
];

function parseConditionExpression(expression: unknown): ParsedCondition | undefined {
  if (typeof expression !== "string") return undefined;
  const matched = expression.match(/^\s*(\{\{[^}]+\}\}|[A-Za-z_][\w.]*)\s*(==|!=|>=|<=|>|<)\s*(.+?)\s*$/);
  if (!matched) return undefined;
  const rawValue = matched[3];
  if (rawValue === "true" || rawValue === "false") {
    return { left: matched[1], operator: matched[2] as ConditionOperator, value: rawValue, valueType: "boolean" };
  }
  if (rawValue === "null") {
    return { left: matched[1], operator: matched[2] as ConditionOperator, value: "", valueType: "null" };
  }
  if (/^-?\d+(?:\.\d+)?$/.test(rawValue)) {
    return { left: matched[1], operator: matched[2] as ConditionOperator, value: rawValue, valueType: "number" };
  }
  const quoted = rawValue.match(/^(["'])(.*)\1$/);
  return {
    left: matched[1],
    operator: matched[2] as ConditionOperator,
    value: quoted ? quoted[2] : rawValue,
    valueType: "string",
  };
}

function conditionExpression(condition: ParsedCondition) {
  const left = condition.left.trim();
  const normalizedLeft = left.startsWith("{{") ? left : `{{${left}}}`;
  const expected = condition.valueType === "string"
    ? JSON.stringify(condition.value)
    : condition.valueType === "null"
      ? "null"
      : condition.valueType === "boolean"
        ? String(condition.value === "true")
        : String(Number(condition.value || 0));
  return `${normalizedLeft} ${condition.operator} ${expected}`;
}

function ConditionStepEditor({
  config,
  onChange,
  upstreamVariables,
}: {
  config: Record<string, unknown>;
  onChange: (patch: Record<string, unknown>) => void;
  upstreamVariables: UpstreamVariableOption[];
}) {
  const parsed = parseConditionExpression(config.expression);
  const condition = parsed ?? {
    left: "",
    operator: "==" as ConditionOperator,
    value: "",
    valueType: "string" as ConditionValueType,
  };
  const update = (patch: Partial<ParsedCondition>) => {
    const next = { ...condition, ...patch };
    onChange({ expression: conditionExpression(next) });
  };
  const suggestions = Array.from(new Set([
    "status",
    ...upstreamVariables.map((item) => item.extraction.name).filter(Boolean),
  ]));

  return (
    <section className="scenario-control-editor condition">
      <header>
        <span className="scenario-control-icon"><Icon name="rule" /></span>
        <div><strong>判断条件</strong><small>选择变量和比较方式，满足条件时继续执行后续步骤。</small></div>
      </header>
      {!parsed && config.expression !== undefined && (
        <div className="scenario-config-compat"><Icon name="info" /><span>当前是历史复杂表达式，系统会原样保留。使用下方表单修改后，将转换为标准条件配置。</span></div>
      )}
      <div className="scenario-condition-grid">
        <label className="scenario-field">
          判断变量
          <input
            aria-label="条件判断变量"
            list="scenario-condition-variables"
            onChange={(event) => update({ left: event.target.value })}
            placeholder="例如 status 或 companyId"
            value={parsed ? condition.left.replace(/^\{\{|\}\}$/g, "") : ""}
          />
          <datalist id="scenario-condition-variables">
            {suggestions.map((item) => <option key={item} value={item} />)}
          </datalist>
        </label>
        <label className="scenario-field">
          比较方式
          <select aria-label="条件比较方式" onChange={(event) => update({ operator: event.target.value as ConditionOperator })} value={condition.operator}>
            {conditionOperators.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        <label className="scenario-field">
          值类型
          <select aria-label="条件值类型" onChange={(event) => {
            const valueType = event.target.value as ConditionValueType;
            update({ valueType, value: valueType === "boolean" ? "true" : valueType === "number" ? "0" : "" });
          }} value={condition.valueType}>
            <option value="string">文本</option>
            <option value="number">数字</option>
            <option value="boolean">布尔值</option>
            <option value="null">空值</option>
          </select>
        </label>
        <label className="scenario-field">
          期望值
          {condition.valueType === "boolean"
            ? <select aria-label="条件期望值" onChange={(event) => update({ value: event.target.value })} value={condition.value}><option value="true">true</option><option value="false">false</option></select>
            : <input aria-label="条件期望值" disabled={condition.valueType === "null"} onChange={(event) => update({ value: event.target.value })} placeholder={condition.valueType === "number" ? "例如 200" : "例如 success"} type={condition.valueType === "number" ? "number" : "text"} value={condition.value} />}
        </label>
      </div>
      {parsed && <div className="scenario-condition-preview"><span>执行表达式</span><code>{String(config.expression)}</code></div>}
    </section>
  );
}

function WaitStepEditor({ config, onChange }: { config: Record<string, unknown>; onChange: (patch: Record<string, unknown>) => void }) {
  const durationMs = Math.max(0, Number(config.duration_ms ?? 1000) || 0);
  const [unit, setUnit] = useState<WaitUnit>(durationMs >= 60000 && durationMs % 60000 === 0 ? "min" : durationMs >= 1000 && durationMs % 1000 === 0 ? "s" : "ms");
  const divisor = unit === "min" ? 60000 : unit === "s" ? 1000 : 1;
  const displayedValue = durationMs / divisor;
  const updateDuration = (value: number, nextUnit = unit) => {
    const factor = nextUnit === "min" ? 60000 : nextUnit === "s" ? 1000 : 1;
    onChange({ duration_ms: Math.max(0, Math.round(value * factor)) });
  };
  return (
    <section className="scenario-control-editor wait">
      <header>
        <span className="scenario-control-icon"><Icon name="timer" /></span>
        <div><strong>等待条件</strong><small>当前步骤暂停指定时长，时间结束后自动执行下一步。</small></div>
      </header>
      <div className="scenario-wait-grid">
        <label className="scenario-field">等待时长<input aria-label="等待时长" min="0" onChange={(event) => updateDuration(Number(event.target.value))} step={unit === "ms" ? "100" : "1"} type="number" value={displayedValue} /></label>
        <label className="scenario-field">时间单位<select aria-label="等待时间单位" onChange={(event) => setUnit(event.target.value as WaitUnit)} value={unit}><option value="ms">毫秒</option><option value="s">秒</option><option value="min">分钟</option></select></label>
      </div>
      <div className="scenario-condition-preview"><span>实际等待</span><code>{durationMs} ms</code></div>
    </section>
  );
}

function RandomStepEditor({ config, onChange }: { config: Record<string, unknown>; onChange: (patch: Record<string, unknown>) => void }) {
  const type = String(config.type ?? "integer");
  return <section className="scenario-control-editor random"><header><span className="scenario-control-icon"><Icon name="casino" /></span><div><strong>随机值生成</strong><small>生成值后写入场景变量，供当前节点及后续节点引用。</small></div></header>
    <div className="scenario-control-grid"><label className="scenario-field">输出变量<input aria-label="随机值输出变量" onChange={(event) => onChange({ output: event.target.value })} value={String(config.output ?? "randomValue")} /></label><label className="scenario-field">值类型<select aria-label="随机值类型" onChange={(event) => onChange({ type: event.target.value })} value={type}><option value="integer">整数</option><option value="string">随机字符串</option><option value="uuid">UUID</option></select></label></div>
    {type === "integer" && <div className="scenario-control-grid"><label className="scenario-field">最小值<input aria-label="随机数最小值" onChange={(event) => onChange({ min: Number(event.target.value) })} type="number" value={Number(config.min ?? 1)} /></label><label className="scenario-field">最大值<input aria-label="随机数最大值" onChange={(event) => onChange({ max: Number(event.target.value) })} type="number" value={Number(config.max ?? 100)} /></label></div>}
    {type === "string" && <label className="scenario-field">字符串长度<input aria-label="随机字符串长度" min="1" onChange={(event) => onChange({ length: Number(event.target.value) })} type="number" value={Number(config.length ?? 12)} /></label>}
  </section>;
}

function FixedValueStepEditor({ config, onChange }: { config: Record<string, unknown>; onChange: (patch: Record<string, unknown>) => void }) {
  const serialized = JSON.stringify(config.value ?? "", null, 2);
  const [text, setText] = useState(serialized);
  const [invalid, setInvalid] = useState(false);
  useEffect(() => { setText(serialized); setInvalid(false); }, [serialized]);
  const updateValue = (value: string) => {
    setText(value);
    try { onChange({ value: JSON.parse(value) as unknown }); setInvalid(false); }
    catch { setInvalid(true); }
  };
  return <section className="scenario-control-editor fixed"><header><span className="scenario-control-icon"><Icon name="data_object" /></span><div><strong>固定值写入</strong><small>按 JSON 原始类型保存，不会把数字、布尔值或对象强制转换为字符串。</small></div></header><label className="scenario-field">输出变量<input aria-label="固定值输出变量" onChange={(event) => onChange({ output: event.target.value })} value={String(config.output ?? "value")} /></label><label className="scenario-field">JSON 值<textarea aria-label="固定值 JSON" onChange={(event) => updateValue(event.target.value)} rows={4} value={text} />{invalid && <small className="error">请输入有效 JSON；字符串需要使用双引号。</small>}</label></section>;
}

const SCRIPT_MAX_BYTES = 100 * 1024;
const PYTHON_SCRIPT_DEFAULT = "result = None";
const JAVASCRIPT_SCRIPT_DEFAULT = "let result = null;";
const PYTHON_SCRIPT_TEMPLATE = "result = None\n\nif companyId != 1:\n    result = {\n        \"success\": True,\n        \"companyId\": companyId\n    }";
const JAVASCRIPT_SCRIPT_TEMPLATE = "let result = null;\n\nif (companyId !== 1) {\n  result = {\n    success: true,\n    companyId: companyId\n  };\n}";
const PYTHON_RESERVED_NAMES = new Set(["False", "None", "True", "and", "as", "assert", "async", "await", "break", "class", "continue", "def", "del", "elif", "else", "except", "finally", "for", "from", "global", "if", "import", "in", "is", "lambda", "nonlocal", "not", "or", "pass", "raise", "return", "try", "while", "with", "yield"]);
const JAVASCRIPT_RESERVED_NAMES = new Set(["await", "break", "case", "catch", "class", "const", "continue", "debugger", "default", "delete", "do", "else", "enum", "export", "extends", "false", "finally", "for", "function", "if", "import", "in", "instanceof", "let", "new", "null", "return", "static", "super", "switch", "this", "throw", "true", "try", "typeof", "var", "void", "while", "with", "yield"]);

function scriptVariableNameIsValid(name: string, language: string) {
  return language === "javascript"
    ? /^[$A-Z_a-z][$\w]*$/.test(name) && !JAVASCRIPT_RESERVED_NAMES.has(name)
    : /^[A-Z_a-z]\w*$/.test(name) && !PYTHON_RESERVED_NAMES.has(name);
}

function scriptDiagnostics(config: Record<string, unknown>, availableInputs: string[]) {
  const language = String(config.language ?? "python");
  const code = String(config.code ?? "");
  const inputs = Array.isArray(config.inputs) ? config.inputs.map(String) : [];
  const outputs = Array.isArray(config.outputs) ? config.outputs.map(String) : [];
  const timeout = Number(config.timeout_ms ?? 10000);
  const errors: string[] = [];
  const warnings: string[] = [];
  const invalidNames = [...inputs, ...outputs].filter((name) => !scriptVariableNameIsValid(name, language));
  const duplicateNames = [...inputs.filter((name, index) => inputs.indexOf(name) !== index), ...outputs.filter((name, index) => outputs.indexOf(name) !== index)];
  const unavailableInputs = inputs.filter((name) => !availableInputs.includes(name));
  if (invalidNames.length) errors.push(`变量名不合法：${[...new Set(invalidNames)].join("、")}`);
  if (duplicateNames.length) errors.push(`变量名不能重复声明：${[...new Set(duplicateNames)].join("、")}`);
  if (unavailableInputs.length) errors.push(`输入变量不来自前置节点：${[...new Set(unavailableInputs)].join("、")}；运行时将提示 Script inputs are unavailable`);
  if (new TextEncoder().encode(code).length > SCRIPT_MAX_BYTES) errors.push("脚本超过后端 100 KB 限制");
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 60000) errors.push("超时时间必须是 1～60000 毫秒的整数");
  if (!outputs.length) warnings.push("建议至少声明一个输出变量；未赋值的已声明输出会返回 null");
  if (/^\s*return\b/m.test(code)) errors.push("脚本在顶层执行，不能使用 return；请直接给输出变量赋值");
  if (language === "python") {
    const forbidden = [
      [/^\s*(?:from\s+\S+\s+)?import\b/m, "import"], [/^\s*(?:async\s+)?def\b/m, "自定义函数"],
      [/^\s*class\b/m, "自定义类"], [/\blambda\b/, "lambda"], [/\b(?:try|except|with|raise)\b/, "异常/上下文语句"],
      [/\b(?:print|eval|exec)\s*\(/, "print/eval/exec"], [/\.[A-Za-z_]\w*/, "属性访问"], [/\b__\w+__\b/, "私有名称"],
    ] as const;
    const matches = forbidden.filter(([pattern]) => pattern.test(code)).map(([, label]) => label);
    if (matches.length) errors.push(`Python 沙箱不支持：${matches.join("、")}`);
  } else if (/\b(?:require|import|fetch|process|XMLHttpRequest)\b/.test(code)) {
    errors.push("JavaScript 沙箱不能加载 Node.js 模块，也不能访问文件系统或网络");
  }
  return { errors, warnings };
}

function availableScriptInputsAt(steps: ScenarioStep[], stepIndex: number) {
  return [...new Set(steps.slice(0, stepIndex).flatMap((sourceStep) => {
    const sourceConfig = parseStepConfig(sourceStep.configText);
    return [
      ...(typeof sourceConfig.output === "string" ? [sourceConfig.output] : []),
      ...(Array.isArray(sourceConfig.outputs) ? sourceConfig.outputs.map(String) : []),
      ...readScenarioContext(sourceStep.configText).extractions.map((extraction) => extraction.name).filter(Boolean),
    ];
  }).filter(Boolean))];
}

function firstScenarioScriptError(steps: ScenarioStep[]) {
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    if (step.kind !== "script") continue;
    const firstError = scriptDiagnostics(parseStepConfig(step.configText), availableScriptInputsAt(steps, index)).errors[0];
    if (firstError) return { stepId: step.id, message: `脚本“${step.name}”：${firstError}` };
  }
  return undefined;
}

function ScriptStepEditor({ availableInputs, config, onChange }: { availableInputs: string[]; config: Record<string, unknown>; onChange: (patch: Record<string, unknown>) => void }) {
  const list = (value: unknown) => Array.isArray(value) ? value.join(", ") : "";
  const parseList = (value: string) => value.split(",").map((item) => item.trim()).filter(Boolean);
  const language = String(config.language ?? "python");
  const code = String(config.code ?? "");
  const diagnostics = scriptDiagnostics(config, availableInputs);
  const selectedInputs = Array.isArray(config.inputs) ? config.inputs.map(String) : [];
  const outputNames = Array.isArray(config.outputs) ? config.outputs.map(String) : [];
  const byteLength = new TextEncoder().encode(code).length;
  const changeLanguage = (nextLanguage: string) => {
    const isDefault = !code || code === PYTHON_SCRIPT_DEFAULT || code === JAVASCRIPT_SCRIPT_DEFAULT || code === PYTHON_SCRIPT_TEMPLATE || code === JAVASCRIPT_SCRIPT_TEMPLATE;
    onChange({ language: nextLanguage, ...(isDefault ? { code: nextLanguage === "python" ? PYTHON_SCRIPT_DEFAULT : JAVASCRIPT_SCRIPT_DEFAULT } : {}) });
  };
  const toggleInput = (name: string) => onChange({ inputs: selectedInputs.includes(name) ? selectedInputs.filter((input) => input !== name) : [...selectedInputs, name] });
  return <section className="scenario-control-editor script">
    <header><span className="scenario-control-icon"><Icon name="code" /></span><div><strong>沙箱脚本</strong><small>输入只能选择前置节点变量；脚本在顶层执行，请直接给输出变量赋值。</small></div></header>
    <div className="scenario-control-grid"><label className="scenario-field">语言<select aria-label="脚本语言" onChange={(event) => changeLanguage(event.target.value)} value={language}><option value="python">Python</option><option value="javascript">JavaScript</option></select></label><label className="scenario-field">超时（毫秒）<input aria-label="脚本超时" max="60000" min="1" onChange={(event) => onChange({ timeout_ms: Number(event.target.value) })} type="number" value={Number(config.timeout_ms ?? 10000)} /><small>后端允许 1～60000 ms</small></label></div>
    <div className="scenario-control-grid"><label className="scenario-field">输入变量<input aria-label="脚本输入变量" onChange={(event) => onChange({ inputs: parseList(event.target.value) })} placeholder="从下方前置变量选择" value={list(config.inputs)} /><small>缺少任一输入时脚本不会执行</small></label><label className="scenario-field">输出变量<input aria-label="脚本输出变量" onChange={(event) => onChange({ outputs: parseList(event.target.value) })} placeholder="result" value={list(config.outputs)} /><small>未赋值的输出最终为 null</small></label></div>
    <div className="scenario-script-inputs"><span>可用前置变量</span>{availableInputs.length ? <div>{availableInputs.map((name) => <button className={selectedInputs.includes(name) ? "selected" : ""} key={name} onClick={() => toggleInput(name)} type="button"><code>{name}</code><Icon name={selectedInputs.includes(name) ? "check" : "add"} /></button>)}</div> : <small>当前节点之前还没有可用输出；请先在前置节点配置响应取值或输出变量。</small>}</div>
    <label className="scenario-field scenario-script-editor-field"><span>代码</span><div className="scenario-script-editor" data-language={language}><div className="scenario-script-editor-toolbar"><span>{language === "python" ? "Python" : "JavaScript"}</span><small className={byteLength > SCRIPT_MAX_BYTES ? "error" : ""}>{byteLength.toLocaleString()} / {SCRIPT_MAX_BYTES.toLocaleString()} bytes</small></div><Suspense fallback={<div className="scenario-script-editor-loading">正在加载代码编辑器...</div>}><ScriptCodeEditor code={code} inputNames={selectedInputs} language={language} onChange={(value) => onChange({ code: value })} outputNames={outputNames} placeholder={language === "python" ? PYTHON_SCRIPT_TEMPLATE : JAVASCRIPT_SCRIPT_TEMPLATE} /></Suspense></div></label>
    {(diagnostics.errors.length > 0 || diagnostics.warnings.length > 0) && <div className="scenario-script-diagnostics" aria-live="polite">{diagnostics.errors.map((message) => <p className="error" key={message}><Icon name="error" />{message}</p>)}{diagnostics.warnings.map((message) => <p className="warning" key={message}><Icon name="warning" />{message}</p>)}</div>}
    <details className="scenario-script-help"><summary>查看沙箱编写规范</summary><div><p><b>输出方式：</b>不要写 <code>return</code>，直接赋值，例如 <code>result = companyId != 1</code>。</p><p><b>Python：</b>支持变量、流程控制、容器、运算、下标和安全内置函数；不支持 import、函数/类、lambda、属性访问、I/O、网络、print、try/with/raise、eval/exec。</p><p><b>容量：</b>脚本 100 KB，输入和输出数据各 1 MB；输出必须能转换为 JSON。</p></div></details>
  </section>;
}

function StepInspector({ allSteps, baseRequestConfig, debugResult, debugging, onChange, onExecute, runResult, step }: { allSteps: ScenarioStep[]; baseRequestConfig?: Record<string, unknown>; debugResult?: ScenarioStepDebugResult; debugging: boolean; onChange: (patch: Partial<ScenarioStep>) => void; onExecute: () => void; runResult?: ScenarioStepResult; step: ScenarioStep }) {
  const [responseExpanded, setResponseExpanded] = useState(false);
  const [responseSearch, setResponseSearch] = useState("");
  const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(new Set());
  const stepIndex = allSteps.findIndex((item) => item.id === step.id);
  const context = readScenarioContext(step.configText);
  const requestConfig = { ...(baseRequestConfig ?? {}), ...parseStepConfig(step.configText) };
  const upstreamVariables = allSteps.slice(0, stepIndex).flatMap((sourceStep, index) =>
    readScenarioContext(sourceStep.configText).extractions.map((extraction) => ({ sourceStep, stepNumber: index + 1, extraction })));
  const availableScriptInputs = availableScriptInputsAt(allSteps, stepIndex);
  useEffect(() => {
    setResponseExpanded(false);
    setResponseSearch("");
    if (!debugResult) return setCollapsedPaths(new Set());
    setCollapsedPaths(new Set(debugResult.sources.flatMap((source) => topLevelContainers(source.value, source.messageIndex))));
  }, [debugResult, step.id]);
  const updateContext = (next: ScenarioContextConfig) => onChange({ configText: writeScenarioContext(step.configText, next) });
  const patchConfig = (patch: Record<string, unknown>) => {
    const next = { ...requestConfig, ...patch };
    const summaryPath = step.kind === "condition" && typeof next.expression === "string"
      ? next.expression
      : step.kind === "delay" && typeof next.duration_ms === "number"
        ? `等待 ${next.duration_ms >= 1000 && next.duration_ms % 1000 === 0 ? `${next.duration_ms / 1000} 秒` : `${next.duration_ms} 毫秒`}`
        : undefined;
    onChange({
      configText: writeScenarioContext(JSON.stringify(next), context),
      ...(typeof patch.path === "string" ? { path: patch.path } : summaryPath ? { path: summaryPath } : {}),
    });
  };
  const bindField = (target: ScenarioBindingTarget, targetPath: string, sourceKey: string) => {
    const [sourceStepId, sourceExtractionId] = sourceKey.split("::");
    const source = upstreamVariables.find((item) => item.sourceStep.id === sourceStepId && item.extraction.id === sourceExtractionId);
    if (!source) return;
    const variableName = source.extraction.name || suggestedVariableName(source.extraction.path);
    const marker = `{{${variableName}}}`;
    const bindingPath = target === "path" ? variableName : targetPath;
    const next = structuredClone(requestConfig);
    if (target === "path") {
      const currentPath = String(next.path ?? step.path);
      next.path = currentPath.includes(marker) ? currentPath : `${currentPath}${currentPath.endsWith("/") ? "" : "/"}${marker}`;
    }
    else {
      const container = asRecord(next[target]);
      next[target] = container;
      setNestedRequestValue(container, targetPath, marker);
    }
    const existing = context.bindings.find((binding) => binding.target === target && (target === "path" || binding.targetPath === bindingPath));
    const binding: ScenarioBinding = { id: existing?.id ?? scenarioUniqueId("BIND"), name: variableName, sourceStepId, sourceExtractionId, target, targetPath: bindingPath };
    const bindings = existing ? context.bindings.map((item) => item.id === existing.id ? binding : item) : [...context.bindings, binding];
    onChange({ configText: writeScenarioContext(JSON.stringify(next), { ...context, bindings }), ...(target === "path" ? { path: String(next.path) } : {}) });
  };
  const addExtraction = (path: string, messageIndex?: number) => {
    const name = suggestedVariableName(path);
    updateContext({ ...context, extractions: [...context.extractions, { id: scenarioUniqueId("VAR"), name, path, ...(messageIndex === undefined ? {} : { messageIndex }) }] });
  };
  const addAssertion = (path: string, value: unknown, messageIndex?: number) => {
    const assertions = Array.isArray(requestConfig.assertions) ? requestConfig.assertions as ScenarioAssertion[] : [];
    const assertion: ScenarioAssertion = step.kind === "websocket_case"
      ? { type: "message_json_equals", message_index: messageIndex ?? 0, path, expected: structuredClone(value) }
      : { type: "json_equals", path, expected: structuredClone(value) };
    const existingIndex = assertions.findIndex((item) =>
      item.type === assertion.type
      && "path" in item
      && item.path === path
      && (
        assertion.type !== "message_json_equals"
        || ("message_index" in item && item.message_index === assertion.message_index)
      ));
    patchConfig({
      assertions: existingIndex < 0
        ? [...assertions, assertion]
        : assertions.map((item, index) => index === existingIndex ? assertion : item),
    });
  };
  const canDebug = step.kind === "api_case" || step.kind === "websocket_case";
  const anchor = allSteps.find((item) => item.nodeId === step.nodeId && item.actionPosition === "main");
  return <><div className="scenario-inspector-content"><div className="scenario-panel-head"><div><span className="eyebrow">Action config</span><h3>执行动作配置</h3></div><div className="scenario-inspector-head-actions">{canDebug && <button aria-label="执行步骤" className={debugging ? "scenario-inspector-run loading" : "scenario-inspector-run"} disabled={debugging} onClick={onExecute} type="button"><Icon name={debugging ? "progress_activity" : "play_arrow"} />{debugging ? "执行中" : "执行步骤"}</button>}<span className={`scenario-method ${step.kind}`}>{step.method}</span></div></div>
    <label className="scenario-field">动作名称<input onChange={(event) => onChange({ name: event.target.value })} value={step.name} /></label>
    <div className="scenario-action-placement"><span>{scenarioPositionLabels[step.actionPosition]}</span><strong>{anchor?.name ?? step.name}</strong><small>{step.actionPosition === "main" ? "主流程节点只承载一个项目测试用例。" : `该动作只绑定到“${anchor?.name ?? "当前测试用例"}”，不会作为场景全局动作执行。`}</small></div>
    {canDebug ? <ScenarioRequestEditor bindings={context.bindings} config={requestConfig} key={`request-${step.id}`} onBind={bindField} onChange={patchConfig} runResult={runResult} step={step} upstreamVariables={upstreamVariables} /> : <label className="scenario-field">路径或说明<input onChange={(event) => onChange({ path: event.target.value })} value={step.path} /></label>}
    {step.kind === "condition" && <ConditionStepEditor config={requestConfig} onChange={patchConfig} upstreamVariables={upstreamVariables} />}
    {step.kind === "delay" && <WaitStepEditor config={requestConfig} onChange={patchConfig} />}
    {step.kind === "random" && <RandomStepEditor config={requestConfig} onChange={patchConfig} />}
    {step.kind === "fixed_value" && <FixedValueStepEditor config={requestConfig} onChange={patchConfig} />}
    {step.kind === "script" && <ScriptStepEditor availableInputs={availableScriptInputs} config={requestConfig} onChange={patchConfig} />}
    {canDebug && <ScenarioAssertionEditor assertions={Array.isArray(requestConfig.assertions) ? requestConfig.assertions as ScenarioAssertion[] : []} key={`assertion-${step.id}`} kind={step.kind} onChange={(assertions) => patchConfig({ assertions })} />}
    {debugResult && <section className={`scenario-debug-response-card ${debugResult.status.toLowerCase()}`}>
      <header><div><strong>响应信息</strong><small>本次单步执行结果，点击展开查看完整字段</small></div><span>{debugResult.status}</span></header>
      <button aria-label="展开响应信息" onClick={() => setResponseExpanded(true)} type="button">
        <span><Icon name="speed" /><small>耗时</small><strong>{debugResult.durationMs} ms</strong></span>
        <span><Icon name="http" /><small>状态码</small><strong>{debugResult.statusCode ?? "-"}</strong></span>
        <span><Icon name="data_object" /><small>响应数据</small><strong>{debugResult.sources.length ? `${debugResult.sources.length} 组` : "无结构化数据"}</strong></span>
        <em><Icon name="open_in_full" />展开</em>
      </button>
      {debugResult.errorMessage && <p><Icon name="error" />{debugResult.errorMessage}</p>}
    </section>}
    {canDebug && <section className="scenario-context-section"><header><div><strong>响应取值</strong><small>给响应 JSON 路径命名，供后续步骤直接引用</small></div><button onClick={() => updateContext({ ...context, extractions: [...context.extractions, { id: scenarioUniqueId("VAR"), name: "", path: "" }] })} type="button"><Icon name="add" />新增</button></header>
      {context.extractions.length === 0 && <p>暂未定义响应取值，例如变量名 companyId、路径 data.id。</p>}
      {context.extractions.map((extraction) => {
        const debugExtraction = debugResult
          ? extractScenarioDebugValue(debugResult, extraction.path, extraction.messageIndex)
          : undefined;
        const runtime = debugExtraction
          ? {
              value: debugExtraction.value,
              masked: Boolean(extraction.masked),
              error: debugExtraction.error,
            }
          : runResult?.extractedVariables?.find((item) => item.extractionId === extraction.id);
        const runtimeLabel = debugResult ? "本次调试取值" : "本次运行取值";
        return <div className="scenario-context-entry" key={extraction.id}><div className="scenario-context-row"><input aria-label="取值变量名" onChange={(event) => updateContext({ ...context, extractions: context.extractions.map((item) => item.id === extraction.id ? { ...item, name: event.target.value } : item) })} value={extraction.name} /><input aria-label="响应 JSON 路径" onChange={(event) => updateContext({ ...context, extractions: context.extractions.map((item) => item.id === extraction.id ? { ...item, path: event.target.value } : item) })} value={extraction.path} /><button onClick={() => updateContext({ extractions: context.extractions.filter((item) => item.id !== extraction.id), bindings: context.bindings })} type="button"><Icon name="delete" /></button></div>{runtime && <small className={runtime.error ? "scenario-runtime-value error" : "scenario-runtime-value"}><Icon name={runtime.error ? "error" : "check_circle"} />{runtime.error ? "本次提取失败" : runtimeLabel} <code>{runtime.error || runtimeValue(runtime.value, runtime.masked)}</code></small>}</div>;
      })}
      <p>{context.extractions.length} 取值 · {context.bindings.length} 引用</p>
    </section>}
    <label className="scenario-check"><input checked={step.actionPosition === "after" || step.continueOnFailure} disabled={step.actionPosition === "after"} onChange={(event) => onChange({ continueOnFailure: event.target.checked })} type="checkbox" /><span><strong>{step.actionPosition === "after" ? "继续执行其余后置动作" : "动作失败后继续"}</strong><small>{step.actionPosition === "after" ? "单个后置动作失败不会阻止当前测试用例的其他收尾动作" : "关闭时中断当前节点后续前置或主测试用例；后置动作仍会执行"}</small></span></label>
  </div>
  {responseExpanded && debugResult && <div className="modal-backdrop scenario-response-backdrop"><section aria-label={`${step.name} 调试响应`} aria-modal="true" className="scenario-response-modal" role="dialog"><div className="modal-head"><div><span className="eyebrow">Step response</span><h3>{step.name}</h3></div><button className="icon-btn" onClick={() => setResponseExpanded(false)} title="关闭响应详情" type="button"><Icon name="close" /></button></div><div className="scenario-response-search"><Icon name="search" /><input aria-label="搜索响应字段" onChange={(event) => setResponseSearch(event.target.value)} value={responseSearch} />{responseSearch && <button onClick={() => setResponseSearch("")} title="清空响应搜索" type="button"><Icon name="close" /></button>}</div><ResponseContent collapsedPaths={collapsedPaths} onAssert={addAssertion} onCollapsedPathsChange={setCollapsedPaths} onExtract={addExtraction} result={debugResult} search={responseSearch} /></section></div>}
  </>;
}

function asRecord(value: unknown) { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function setNestedRequestValue(target: Record<string, unknown>, path: string, value: unknown) { const parts = path.split(".").filter(Boolean); let current = target; parts.forEach((part, index) => { if (index === parts.length - 1) current[part] = value; else { current[part] = asRecord(current[part]); current = current[part] as Record<string, unknown>; } }); }
function collectLeafPaths(value: unknown, prefix = "", result: string[] = []) { if (!value || typeof value !== "object") return result; Object.entries(value as Record<string, unknown>).forEach(([key, item]) => { const path = prefix ? `${prefix}.${key}` : key; if (item && typeof item === "object") collectLeafPaths(item, path, result); else result.push(path); }); return result; }

function assertionExpectedText(value: unknown) {
  return typeof value === "string" ? value : JSON.stringify(value);
}

function parseAssertionExpected(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return value;
  }
}

function createScenarioAssertion(kind: ScenarioStepKind): ScenarioAssertion {
  return kind === "websocket_case"
    ? { type: "message_count", expected: 1 }
    : { type: "status_code", expected: 200 };
}

function ScenarioAssertionEditor({ assertions, kind, onChange }: { assertions: ScenarioAssertion[]; kind: ScenarioStepKind; onChange: (assertions: ScenarioAssertion[]) => void }) {
  const [expanded, setExpanded] = useState(false);
  const websocket = kind === "websocket_case";
  const patch = (index: number, value: Partial<ScenarioAssertion>) => onChange(assertions.map((assertion, itemIndex) => itemIndex === index ? { ...assertion, ...value } as ScenarioAssertion : assertion));
  const changeType = (index: number, type: ScenarioAssertion["type"]) => {
    const current = assertions[index];
    const next = websocket
      ? {
          type,
          expected: type === "message_count" ? 1 : "",
          ...(type === "message_count" ? {} : { message_index: "message_index" in current ? current.message_index ?? 0 : 0 }),
          ...(type === "message_json_equals" ? { path: "path" in current ? current.path ?? "" : "" } : {}),
        } as WebSocketAssertion
      : {
          type,
          expected: type === "status_code" ? 200 : "",
          ...(type === "json_equals" ? { path: "path" in current ? current.path ?? "" : "" } : {}),
        } as TestCaseAssertion;
    onChange(assertions.map((assertion, itemIndex) => itemIndex === index ? next : assertion));
  };
  return <section className={expanded ? "scenario-assertion-section expanded" : "scenario-assertion-section"}>
    <button
      aria-expanded={expanded}
      className="scenario-assertion-toggle"
      onClick={() => setExpanded((current) => !current)}
      type="button"
    >
      <span><strong>断言</strong><small>所有断言通过时，该步骤才判定为 passed</small></span>
      <span className="scenario-assertion-summary">
        <em>{assertions.length > 0 ? `${assertions.length} 条` : "未配置"}</em>
        <Icon name="expand_more" />
      </span>
    </button>
    {expanded && <div className="scenario-assertion-content">
      <div className="scenario-assertion-actions"><button onClick={() => onChange([...assertions, createScenarioAssertion(kind)])} type="button"><Icon name="add" />新增断言</button></div>
      {assertions.length === 0 && <div className="scenario-assertion-warning"><Icon name="warning" /><span><strong>尚未配置断言</strong><small>当前只能说明接口完成请求，不能验证响应是否符合业务预期。</small></span></div>}
      {assertions.map((assertion, index) => {
        const needsMessageIndex = assertion.type === "message_contains" || assertion.type === "message_json_equals";
        const needsPath = assertion.type === "json_equals" || assertion.type === "message_json_equals";
        return <div className="scenario-assertion-card" key={`${assertion.type}-${index}`}>
          <header><b>{index + 1}</b><select aria-label={`断言 ${index + 1} 类型`} onChange={(event) => changeType(index, event.target.value as ScenarioAssertion["type"])} value={assertion.type}>
            {websocket ? <><option value="message_count">接收消息数量</option><option value="message_contains">消息内容包含</option><option value="message_json_equals">消息 JSON 等于</option></> : <><option value="status_code">HTTP 状态码</option><option value="body_contains">响应内容包含</option><option value="json_equals">响应 JSON 等于</option></>}
          </select><button onClick={() => onChange(assertions.filter((_, itemIndex) => itemIndex !== index))} title={`删除断言 ${index + 1}`} type="button"><Icon name="delete" /></button></header>
          <div className="scenario-assertion-fields">
            {needsMessageIndex && <label>消息序号<input aria-label={`断言 ${index + 1} 消息序号`} min="0" onChange={(event) => patch(index, { message_index: Math.max(0, Number(event.target.value) || 0) } as Partial<WebSocketAssertion>)} type="number" value={"message_index" in assertion ? assertion.message_index ?? 0 : 0} /></label>}
            {needsPath && <label>JSON 路径<input aria-label={`断言 ${index + 1} JSON 路径`} onChange={(event) => patch(index, { path: event.target.value })} placeholder="例如 data.id" value={"path" in assertion ? assertion.path ?? "" : ""} /></label>}
            <label className={needsMessageIndex && needsPath ? "wide" : ""}>预期值<input aria-label={`断言 ${index + 1} 预期值`} onChange={(event) => patch(index, { expected: parseAssertionExpected(event.target.value) })} value={assertionExpectedText(assertion.expected)} /></label>
          </div>
        </div>;
      })}
      {assertions.length > 0 && <p><Icon name="verified" />已配置 {assertions.length} 条断言，任意一条失败都会使步骤失败。</p>}
    </div>}
  </section>;
}

function VariableSelect({ binding, label, onChange, options, runtimeBinding }: { binding?: ScenarioBinding; label: string; onChange: (key: string) => void; options: UpstreamVariableOption[]; runtimeBinding?: ScenarioResolvedBinding }) {
  if (!options.length) return null;
  return <label className={runtimeBinding ? "scenario-variable-select has-runtime" : "scenario-variable-select"}><Icon name="data_object" /><select aria-label={label} onChange={(event) => event.target.value && onChange(event.target.value)} value={binding ? `${binding.sourceStepId}::${binding.sourceExtractionId}` : ""}><option value="">引用变量</option>{options.map((item) => <option key={`${item.sourceStep.id}::${item.extraction.id}`} value={`${item.sourceStep.id}::${item.extraction.id}`}>步骤 {item.stepNumber} · {item.extraction.name || item.extraction.path}</option>)}</select>{runtimeBinding && <small title="本次场景运行解析后的实际值">本次值 <code>{runtimeValue(runtimeBinding.value, runtimeBinding.masked)}</code></small>}</label>;
}

function KeyValueEditor({ bindings, label, onBind, onChange, options, runResult, target, value }: { bindings: ScenarioBinding[]; label: string; onBind: (target: ScenarioBindingTarget, path: string, key: string) => void; onChange: (value: Record<string, string>) => void; options: UpstreamVariableOption[]; runResult?: ScenarioStepResult; target: "headers" | "query_params"; value: unknown }) {
  const serialized = JSON.stringify(asRecord(value));
  const [rows, setRows] = useState(() => Object.entries(asRecord(value)).map(([key, item]) => ({ key, value: String(item) })));
  useEffect(() => setRows(Object.entries(asRecord(value)).map(([key, item]) => ({ key, value: String(item) }))), [serialized]);
  const commit = (next: Array<{ key: string; value: string }>) => {
    setRows(next);
    onChange(Object.fromEntries(next.filter((row) => row.key.trim()).map((row) => [row.key.trim(), row.value])));
  };
  return <div className="scenario-request-kv">{rows.map((row, index) => {
    const binding = bindings.find((item) => item.target === target && item.targetPath === row.key);
    return <div className="scenario-request-kv-row" key={`${row.key}-${index}`}><input aria-label={`${label} ${index + 1} 名称`} onChange={(event) => commit(rows.map((item, i) => i === index ? { ...item, key: event.target.value } : item))} value={row.key} /><input aria-label={`${label} ${index + 1} 值`} onChange={(event) => commit(rows.map((item, i) => i === index ? { ...item, value: event.target.value } : item))} value={row.value} /><VariableSelect binding={binding} label={`${label} ${row.key || index + 1} 引用上游变量`} onChange={(source) => row.key.trim() && onBind(target, row.key.trim(), source)} options={options} runtimeBinding={runResult?.resolvedBindings?.find((item) => item.bindingId === binding?.id)} /><button onClick={() => commit(rows.filter((_, i) => i !== index))} type="button"><Icon name="delete" /></button></div>;
  })}<button className="scenario-request-add" onClick={() => setRows([...rows, { key: "", value: "" }])} type="button"><Icon name="add" />新增{label}</button></div>;
}

function ScenarioRequestEditor({ bindings, config, onBind, onChange, runResult, step, upstreamVariables }: { bindings: ScenarioBinding[]; config: Record<string, unknown>; onBind: (target: ScenarioBindingTarget, path: string, source: string) => void; onChange: (patch: Record<string, unknown>) => void; runResult?: ScenarioStepResult; step: ScenarioStep; upstreamVariables: UpstreamVariableOption[] }) {
  const [tab, setTab] = useState<"headers" | "query" | "body">("headers");
  const [expanded, setExpanded] = useState(false);
  const bodyType = String(config.body_type ?? "none");
  const pathBinding = bindings.find((item) => item.target === "path");
  return <section className={expanded ? "scenario-request-editor expanded" : "scenario-request-editor"}><button aria-expanded={expanded} className="scenario-request-toggle" onClick={() => setExpanded((current) => !current)} type="button"><span><strong>请求配置</strong><small>变量直接在对应字段中引用，运行后展示解析值</small></span><span className="scenario-request-summary"><em>{step.method}</em><Icon name="expand_more" /></span></button>{expanded && <div className="scenario-request-content"><div className="scenario-request-path"><label className="scenario-field">请求路径<input onChange={(event) => onChange({ path: event.target.value })} value={String(config.path ?? step.path)} /></label><VariableSelect binding={pathBinding} label="请求路径引用上游变量" onChange={(source) => onBind("path", "", source)} options={upstreamVariables} runtimeBinding={runResult?.resolvedBindings?.find((item) => item.bindingId === pathBinding?.id)} /></div><div className="scenario-request-tabs"><button className={tab === "headers" ? "active" : ""} onClick={() => setTab("headers")} type="button">Headers <i>{Object.keys(asRecord(config.headers)).length}</i></button><button className={tab === "query" ? "active" : ""} onClick={() => setTab("query")} type="button">Query <i>{Object.keys(asRecord(config.query_params)).length}</i></button><button className={tab === "body" ? "active" : ""} onClick={() => setTab("body")} type="button">Body</button></div>
    {tab === "headers" && <KeyValueEditor bindings={bindings} label="请求头" onBind={onBind} onChange={(headers) => onChange({ headers })} options={upstreamVariables} runResult={runResult} target="headers" value={config.headers} />}
    {tab === "query" && <KeyValueEditor bindings={bindings} label="Query 参数" onBind={onBind} onChange={(query_params) => onChange({ query_params })} options={upstreamVariables} runResult={runResult} target="query_params" value={config.query_params} />}
    {tab === "body" && <div className="scenario-request-body"><label>请求体类型<select aria-label="请求体类型" onChange={(event) => onChange({ body_type: event.target.value })} value={bodyType}><option value="none">无请求体</option><option value="json">JSON</option><option value="raw_json">Raw JSON</option><option value="raw_text">Raw Text</option></select></label>{bodyType !== "none" && <label className="scenario-request-json"><span>请求体 JSON</span><textarea aria-label="请求体 JSON" onChange={(event) => { try { onChange({ body: JSON.parse(event.target.value) }); } catch { /* keep editing */ } }} defaultValue={JSON.stringify(config.body, null, 2)} /></label>}{bodyType !== "none" && upstreamVariables.length > 0 && <div className="scenario-body-bindings"><strong>字段引用</strong>{collectLeafPaths(config.body).map((path) => { const binding = bindings.find((item) => item.target === "body" && item.targetPath === path); return <div key={path}><code>{path}</code><VariableSelect binding={binding} label={`请求体 ${path} 引用上游变量`} onChange={(source) => onBind("body", path, source)} options={upstreamVariables} runtimeBinding={runResult?.resolvedBindings?.find((item) => item.bindingId === binding?.id)} /></div>; })}</div>}</div>}
  </div>}</section>;
}

function responseStatePath(path: string, messageIndex?: number) { return `${messageIndex === undefined ? "http" : `message-${messageIndex}`}:${path}`; }
function topLevelContainers(value: unknown, messageIndex?: number) { return Object.entries(asRecord(value)).filter(([, item]) => item !== null && typeof item === "object").map(([key]) => responseStatePath(key, messageIndex)); }
function formatResponse(value: unknown) { return typeof value === "string" ? value : JSON.stringify(value); }
function countMatches(value: unknown, search: string): number { if (!search.trim()) return 0; const keyword = search.toLowerCase(); if (!value || typeof value !== "object") return String(value).toLowerCase().includes(keyword) ? 1 : 0; return Object.entries(value as Record<string, unknown>).reduce((sum, [key, item]) => sum + (key.toLowerCase().includes(keyword) ? 1 : countMatches(item, search)), 0); }
function ResponseContent({ collapsedPaths, onAssert, onCollapsedPathsChange, onExtract, result, search = "" }: { collapsedPaths: Set<string>; onAssert: (path: string, value: unknown, index?: number) => void; onCollapsedPathsChange: (paths: Set<string>) => void; onExtract: (path: string, index?: number) => void; result: ScenarioStepDebugResult; search?: string }) {
  const matches = result.sources.reduce((sum, source) => sum + countMatches(source.value, search), 0);
  return <div className="scenario-response-modal-body">{search && <p className="scenario-response-match-count">找到 {matches} 个匹配字段</p>}{result.sources.map((source, index) => <div className="scenario-response-source" key={source.messageIndex ?? index}><ResponseTree collapsedPaths={collapsedPaths} messageIndex={source.messageIndex} onAssert={onAssert} onCollapsedPathsChange={onCollapsedPathsChange} onExtract={onExtract} search={search} value={source.value} /></div>)}</div>;
}
function ResponseTree({ collapsedPaths, messageIndex, onAssert, onCollapsedPathsChange, onExtract, path = "", search = "", value }: { collapsedPaths: Set<string>; messageIndex?: number; onAssert: (path: string, value: unknown, index?: number) => void; onCollapsedPathsChange: (paths: Set<string>) => void; onExtract: (path: string, index?: number) => void; path?: string; search?: string; value: unknown }) {
  if (!value || typeof value !== "object") return null;
  return <div className="scenario-response-tree">{Object.entries(value as Record<string, unknown>).map(([key, item]) => {
    const itemPath = path ? `${path}.${key}` : key;
    const nested = item !== null && typeof item === "object";
    const statePath = responseStatePath(itemPath, messageIndex);
    const collapsed = nested && !search && collapsedPaths.has(statePath);
    const branchMatches = search && JSON.stringify({ [key]: item }).toLowerCase().includes(search.toLowerCase());
    if (search && !branchMatches) return null;
    const count = nested ? (Array.isArray(item) ? item.length : Object.keys(asRecord(item)).length) : 0;
    return <div className={nested ? "scenario-response-node nested" : "scenario-response-node"} key={itemPath}><div className={nested ? "scenario-response-line branch" : "scenario-response-line"}>{nested ? <><button aria-expanded={!collapsed} aria-label={`${collapsed ? "展开" : "收起"} ${itemPath}`} className="scenario-response-toggle" onClick={() => { const next = new Set(collapsedPaths); collapsed ? next.delete(statePath) : next.add(statePath); onCollapsedPathsChange(next); }} type="button"><Icon name={collapsed ? "chevron_right" : "expand_more"} /><code>{key}</code><small>{Array.isArray(item) ? `Array(${count})` : `Object(${count})`}</small></button><ResponseFieldActions itemPath={itemPath} messageIndex={messageIndex} onAssert={onAssert} onExtract={onExtract} value={item} /></> : <><code>{key}</code><span className={`scenario-response-value ${item === null ? "null" : typeof item}`}>{formatResponse(item)}</span><ResponseFieldActions itemPath={itemPath} messageIndex={messageIndex} onAssert={onAssert} onExtract={onExtract} value={item} /></>}</div>{nested && !collapsed && <ResponseTree collapsedPaths={collapsedPaths} messageIndex={messageIndex} onAssert={onAssert} onCollapsedPathsChange={onCollapsedPathsChange} onExtract={onExtract} path={itemPath} search={search} value={item} />}</div>;
  })}</div>;
}

function ResponseFieldActions({ itemPath, messageIndex, onAssert, onExtract, value }: { itemPath: string; messageIndex?: number; onAssert: (path: string, value: unknown, index?: number) => void; onExtract: (path: string, index?: number) => void; value: unknown }) {
  return <div className="scenario-response-actions">
    <button aria-label={`将 ${itemPath} 设为断言`} className="scenario-response-assert" onClick={() => onAssert(itemPath, value, messageIndex)} type="button"><Icon name="fact_check" /><span>设为断言</span></button>
    <button aria-label={`将 ${itemPath} 设为变量`} className="scenario-response-extract" onClick={() => onExtract(itemPath, messageIndex)} type="button"><Icon name="add_link" /><span>设为变量</span></button>
  </div>;
}

function ScenarioInspector({ draft, environments, onChange }: { draft: TestScenario; environments: EnvironmentOption[]; onChange: (patch: Partial<TestScenario>) => void }) {
  return <div className="scenario-inspector-content"><div className="scenario-panel-head"><div><span className="eyebrow">Scenario config</span><h3>场景配置</h3></div></div>
    <label className="scenario-field">执行环境<select onChange={(event) => onChange({ environmentId: Number(event.target.value) || undefined })} value={draft.environmentId ?? ""}><option value="">请选择环境</option>{environments.map((environment) => <option key={environment.id} value={environment.id}>{environment.name}</option>)}</select></label>
    <label className="scenario-field">标签<input onChange={(event) => onChange({ tags: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) })} placeholder="回归, 核心链路" value={draft.tags.join(", ")} /></label>
    <div className="scenario-summary-card"><span><Icon name="format_list_numbered" /><strong>{draft.steps.length}</strong><small>执行步骤</small></span><span><Icon name="database" /><strong>{draft.datasets.filter((item) => item.enabled).length}</strong><small>启用数据集</small></span></div>
    <p className="scenario-help">选择中间的步骤可编辑步骤名称、配置 JSON 和失败处理策略。</p>
  </div>;
}

interface ScenarioRequestField {
  key: string;
  stepId: string;
  stepIndex: number;
  stepName: string;
  method: string;
  target: ScenarioRequestOverrideTarget;
  path: string;
  value: unknown;
  depth: number;
}

const requestTargetLabels: Record<ScenarioRequestOverrideTarget, string> = {
  path: "Path",
  headers: "Header",
  query_params: "Query",
  body: "Body",
};

function requestFieldKey(stepId: string, target: ScenarioRequestOverrideTarget, path: string) {
  return `${stepId}::${target}::${path}`;
}

function parseStepRequestConfig(step: ScenarioStep) {
  try {
    return asRecord(JSON.parse(step.configText || "{}"));
  } catch {
    return {};
  }
}

function appendRequestFields(
  fields: ScenarioRequestField[],
  step: ScenarioStep,
  stepIndex: number,
  target: ScenarioRequestOverrideTarget,
  value: unknown,
  path = "",
  depth = 0,
) {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      fields.push({ key: requestFieldKey(step.id, target, path), stepId: step.id, stepIndex, stepName: step.name, method: step.method, target, path, value, depth });
      return;
    }
    value.forEach((item, index) => appendRequestFields(fields, step, stepIndex, target, item, `${path}[${index}]`, depth + 1));
    return;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) {
      fields.push({ key: requestFieldKey(step.id, target, path), stepId: step.id, stepIndex, stepName: step.name, method: step.method, target, path, value, depth });
      return;
    }
    entries.forEach(([key, item]) => appendRequestFields(fields, step, stepIndex, target, item, path ? `${path}.${key}` : key, depth + 1));
    return;
  }
  fields.push({ key: requestFieldKey(step.id, target, path), stepId: step.id, stepIndex, stepName: step.name, method: step.method, target, path, value, depth });
}

function collectScenarioRequestFields(steps: ScenarioStep[]) {
  return steps.flatMap((step, stepIndex) => {
    if (step.kind !== "api_case" && step.kind !== "websocket_case") return [];
    const config = parseStepRequestConfig(step);
    const fields: ScenarioRequestField[] = [];
    appendRequestFields(fields, step, stepIndex, "path", config.path ?? step.path);
    appendRequestFields(fields, step, stepIndex, "headers", config.headers ?? {});
    if (step.kind === "api_case") {
      appendRequestFields(fields, step, stepIndex, "query_params", config.query_params ?? {});
      if (String(config.body_type ?? "none") !== "none" || config.body !== undefined) {
        appendRequestFields(fields, step, stepIndex, "body", config.body);
      }
    } else {
      appendRequestFields(fields, step, stepIndex, "body", config.messages ?? []);
    }
    return fields;
  });
}

function requestValueText(value: unknown) {
  if (typeof value === "string") return value;
  if (value === undefined) return "";
  return JSON.stringify(value);
}

function parseRequestValue(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return value;
  }
}

function datasetCaseCount(dataset: ScenarioDataset) {
  return dataset.records?.length ?? 0;
}

function DataTab({
  draft,
  navigationTarget,
  onChange,
  onNavigated,
  onSelectDataset,
  selectedDatasetId,
}: {
  draft: TestScenario;
  navigationTarget?: DataNavigationTarget;
  onChange: (datasets: ScenarioDataset[]) => void;
  onNavigated: () => void;
  onSelectDataset: (datasetId: string) => void;
  selectedDatasetId?: string;
}) {
  const [fieldSearch, setFieldSearch] = useState("");
  const [showDrivenFields, setShowDrivenFields] = useState(false);
  const fieldPickerRef = useRef<HTMLElement>(null);
  const datasetListRef = useRef<HTMLDivElement>(null);
  const fields = useMemo(() => collectScenarioRequestFields(draft.steps), [draft.steps]);
  const activeKeys = useMemo(() => {
    const keys = new Set<string>();
    draft.datasets.forEach((dataset) => dataset.records.forEach((record) =>
      record.requestOverrides.forEach((override) => {
        keys.add(requestFieldKey(override.stepId, override.target, override.path));
      })));
    return keys;
  }, [draft.datasets]);
  const activeFields = fields.filter((field) => activeKeys.has(field.key));
  const filteredFields = fields.filter((field) => {
    const keyword = fieldSearch.trim().toLowerCase();
    return !keyword || `${field.stepName} ${field.method} ${requestTargetLabels[field.target]} ${field.path}`.toLowerCase().includes(keyword);
  });
  const groupedFields = draft.steps.map((step, index) => ({
    step,
    index,
    fields: filteredFields.filter((field) => field.stepId === step.id),
  })).filter((group) => group.fields.length);

  const focusTarget = (element: HTMLElement | null) => {
    if (!element) return;
    element.scrollIntoView?.({ behavior: "smooth", block: "start" });
    element.classList.add("scenario-focus-target");
    window.setTimeout(() => element.classList.remove("scenario-focus-target"), 1200);
  };

  useEffect(() => {
    if (!navigationTarget) return;
    focusTarget(navigationTarget === "fields" ? fieldPickerRef.current : datasetListRef.current);
    onNavigated();
  }, [navigationTarget, onNavigated]);

  const addField = (field: ScenarioRequestField) => {
    onChange(draft.datasets.map((dataset) => {
      return {
        ...dataset,
        records: dataset.records.map((record) => {
          if (record.requestOverrides.some((override) => requestFieldKey(override.stepId, override.target, override.path) === field.key)) return record;
          return {
            ...record,
            requestOverrides: [...record.requestOverrides, {
              stepId: field.stepId,
              target: field.target,
              path: field.path,
              value: field.value,
            }],
          };
        }),
      };
    }));
  };
  const removeField = (field: ScenarioRequestField) => onChange(draft.datasets.map((dataset) => ({
    ...dataset,
    records: dataset.records.map((record) => ({
      ...record,
      requestOverrides: record.requestOverrides.filter((override) =>
        requestFieldKey(override.stepId, override.target, override.path) !== field.key),
    })),
  })));
  const addDataset = () => {
    const id = scenarioUniqueId("DATA");
    onChange([...draft.datasets, {
    id,
    name: `数据集 ${draft.datasets.length + 1}`,
    enabled: true,
    variablesText: "{}",
    records: [{
      id: scenarioUniqueId("RECORD"),
      name: "测试记录 1",
      enabled: true,
      requestOverrides: activeFields.map((field) => ({
        stepId: field.stepId,
        target: field.target,
        path: field.path,
        value: field.value,
      })),
    }],
    }]);
    onSelectDataset(id);
  };

  return <div className="scenario-data-tab">
    <div className="scenario-data-hero">
      <div><span className="eyebrow">Request-driven datasets</span><h3>请求数据驱动</h3><p>从场景步骤中选择请求字段，为每组数据配置不同值。支持 Path、Header、Query 以及任意深度的 JSON Body。</p></div>
      <div className="scenario-data-summary">
        <button onClick={() => focusTarget(fieldPickerRef.current)} type="button"><strong>{fields.length}</strong><small>可选请求字段</small><Icon name="south" /></button>
        <button onClick={() => setShowDrivenFields(true)} type="button"><strong>{activeFields.length}</strong><small>已驱动字段</small><Icon name="open_in_new" /></button>
        <button onClick={() => focusTarget(datasetListRef.current)} type="button"><strong>{draft.datasets.filter((dataset) => dataset.enabled).reduce((total, dataset) => total + dataset.records.filter((record) => record.enabled).length, 0)}</strong><small>运行数据组</small><Icon name="south" /></button>
      </div>
    </div>

    <section className="scenario-field-picker" ref={fieldPickerRef}>
      <header><div><Icon name="account_tree" /><span><strong>选择需要变化的请求字段</strong><small>字段会按执行步骤和请求位置完整展开，深层 JSON 不再需要手写路径。</small></span></div><label><Icon name="search" /><input aria-label="搜索请求字段" onChange={(event) => setFieldSearch(event.target.value)} placeholder="搜索步骤、Body 路径或参数名" value={fieldSearch} /></label></header>
      {fields.length === 0 ? <div className="scenario-data-empty"><Icon name="data_object" /><strong>暂无可驱动请求字段</strong><span>请先在流程设计中添加 HTTP 或 WebSocket 测试步骤。</span></div> : <div className="scenario-field-groups">
        {groupedFields.map((group) => <details className="scenario-field-group" key={group.step.id} open>
          <summary><b>{group.index + 1}</b><span><strong>{group.step.name}</strong><small>{group.step.method} · {group.step.path}</small></span><em>{group.fields.length} 个字段</em><Icon name="expand_more" /></summary>
          <div>{group.fields.map((field) => {
            const active = activeKeys.has(field.key);
            return <button aria-pressed={active} className={active ? "scenario-field-option active" : "scenario-field-option"} key={field.key} onClick={() => active ? removeField(field) : addField(field)} type="button">
              <span className={`scenario-field-location ${field.target}`}>{requestTargetLabels[field.target]}</span>
              <span className="scenario-field-path" style={{ paddingLeft: Math.min(field.depth, 6) * 7 }}><code>{field.path || "(完整值)"}</code><small title={requestValueText(field.value)}>原值：{requestValueText(field.value) || '""'}</small></span>
              <span className="scenario-field-action"><Icon name={active ? "check_circle" : "add_circle"} />{active ? "已加入" : "加入"}</span>
            </button>;
          })}</div>
        </details>)}
        {groupedFields.length === 0 && <div className="scenario-data-empty compact"><Icon name="search_off" /><span>没有匹配的请求字段</span></div>}
      </div>}
    </section>

    <div className="scenario-dataset-toolbar"><div><h3>数据记录</h3><p className="scenario-muted">同一序号的字段值组成一条测试记录，每条记录都会生成一次独立场景运行。</p></div><button className="btn" onClick={addDataset} type="button"><Icon name="add" />新增数据集</button></div>
    {activeFields.length === 0 && <div className="scenario-data-guide"><Icon name="touch_app" /><div><strong>先从上方选择请求字段</strong><p>选择后，这里会自动生成结构化表单。无需再手写变量名或六层 JSON 路径。</p></div></div>}
    <div className="scenario-dataset-list" ref={datasetListRef}>{draft.datasets.map((dataset, index) => <button aria-pressed={selectedDatasetId === dataset.id} className={`${dataset.enabled ? "scenario-dataset-row" : "scenario-dataset-row disabled"}${selectedDatasetId === dataset.id ? " active" : ""}`} key={dataset.id} onClick={() => onSelectDataset(dataset.id)} type="button">
      <b>{index + 1}</b>
      <span><strong>{dataset.name}</strong><small>{dataset.enabled ? "启用" : "停用"} · {datasetCaseCount(dataset)} 条测试记录</small></span>
      <em>{activeFields.length} 个字段 · {dataset.records.filter((record) => record.enabled).length} 条启用</em>
      <Icon name="chevron_right" />
    </button>)}</div>
    {showDrivenFields && <DataDetailDialog
      description="已驱动字段会在每条测试记录中保存一个值，并在运行时覆盖对应步骤的原始请求字段。"
      emptyMessage="当前还没有选择请求覆盖字段。"
      items={activeFields.map((field) => ({
        badge: requestTargetLabels[field.target],
        description: `步骤 ${field.stepIndex + 1} · ${field.stepName}`,
        title: field.path || "(完整请求值)",
        value: requestValueText(field.value),
      }))}
      onClose={() => setShowDrivenFields(false)}
      title="已驱动请求字段"
    />}
  </div>;
}

function DatasetInspector({
  dataset,
  fields,
  onChange,
  onClose,
  onDelete,
  removable,
}: {
  dataset: ScenarioDataset;
  fields: ScenarioRequestField[];
  onChange: (patch: Partial<ScenarioDataset>) => void;
  onClose: () => void;
  onDelete: () => void;
  removable: boolean;
}) {
  const [showOverrideFields, setShowOverrideFields] = useState(false);
  const recordsRef = useRef<HTMLElement>(null);
  const activeFields = fields.filter((field) => dataset.records.some((record) =>
    record.requestOverrides.some((override) =>
      requestFieldKey(override.stepId, override.target, override.path) === field.key)));
  const caseCount = datasetCaseCount(dataset);
  const patchRecord = (recordId: string, patch: Partial<ScenarioDatasetRecord>) => {
    onChange({
      records: dataset.records.map((record) => record.id === recordId ? { ...record, ...patch } : record),
    });
  };
  const patchOverride = (record: ScenarioDatasetRecord, field: ScenarioRequestField, value: unknown) => {
    const hasOverride = record.requestOverrides.some((override) =>
      requestFieldKey(override.stepId, override.target, override.path) === field.key);
    patchRecord(record.id, {
      requestOverrides: hasOverride
        ? record.requestOverrides.map((override) =>
          requestFieldKey(override.stepId, override.target, override.path) === field.key
            ? { ...override, value }
            : override)
        : [...record.requestOverrides, {
          stepId: field.stepId,
          target: field.target,
          path: field.path,
          value,
        }],
    });
  };
  const addCase = () => {
    const source = dataset.records[dataset.records.length - 1];
    onChange({
      records: [...dataset.records, {
        id: scenarioUniqueId("RECORD"),
        name: `测试记录 ${dataset.records.length + 1}`,
        enabled: true,
        requestOverrides: source
          ? source.requestOverrides.map((override) => ({ ...override }))
          : activeFields.map((field) => ({
            stepId: field.stepId,
            target: field.target,
            path: field.path,
            value: field.value,
          })),
      }],
    });
  };
  const duplicateCase = (record: ScenarioDatasetRecord) => onChange({
    records: [...dataset.records, {
      ...record,
      id: scenarioUniqueId("RECORD"),
      name: `${record.name} 副本`,
      requestOverrides: record.requestOverrides.map((override) => ({ ...override })),
    }],
  });
  const removeCase = (recordId: string) => {
    if (caseCount <= 1) return;
    onChange({
      records: dataset.records.filter((record) => record.id !== recordId),
    });
  };
  const focusRecords = () => {
    recordsRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    recordsRef.current?.classList.add("scenario-focus-target");
    window.setTimeout(() => recordsRef.current?.classList.remove("scenario-focus-target"), 1200);
  };

  return <div className="scenario-inspector-content scenario-dataset-inspector">
    <div className="scenario-panel-head"><div><span className="eyebrow">Dataset config</span><h3>数据集配置</h3></div><button className="icon-btn" onClick={onClose} title="关闭数据集配置" type="button"><Icon name="close" /></button></div>
    <label className="scenario-field">数据集名称<input aria-label="当前数据集名称" onChange={(event) => onChange({ name: event.target.value })} value={dataset.name} /></label>
    <label className="scenario-dataset-enabled"><span><strong>参与场景运行</strong><small>启用后，每组测试数据都会生成一条独立运行记录。</small></span><label className="switch" title={dataset.enabled ? "停用数据集" : "启用数据集"}><input checked={dataset.enabled} onChange={(event) => onChange({ enabled: event.target.checked })} type="checkbox" /><i /></label></label>
    <div className="scenario-dataset-inspector-summary">
      <button onClick={() => setShowOverrideFields(true)} type="button"><Icon name="database" /><strong>{activeFields.length}</strong><small>请求覆盖字段</small><Icon name="open_in_new" /></button>
      <button onClick={focusRecords} type="button"><Icon name="format_list_numbered" /><strong>{caseCount}</strong><small>测试记录</small><Icon name="south" /></button>
    </div>
    <section className="scenario-dataset-inspector-fields" ref={recordsRef}>
      <header><span><strong>测试记录</strong><small>每张记录卡都是一次完整、独立的场景运行。</small></span><button disabled={activeFields.length === 0} onClick={addCase} type="button"><Icon name="add" />新增测试记录</button></header>
      {activeFields.length === 0 ? <div className="scenario-data-empty compact"><Icon name="touch_app" /><span>请先在中间区域选择请求字段</span></div> : <div className="scenario-dataset-records">{dataset.records.map((record, recordIndex) => <article className={record.enabled ? "scenario-dataset-record" : "scenario-dataset-record disabled"} key={record.id}>
        <header>
          <b>{recordIndex + 1}</b>
          <input aria-label={`记录 ${recordIndex + 1} 名称`} onChange={(event) => patchRecord(record.id, { name: event.target.value })} value={record.name} />
          <label className="switch compact" title={record.enabled ? "停用测试记录" : "启用测试记录"}><input checked={record.enabled} onChange={(event) => patchRecord(record.id, { enabled: event.target.checked })} type="checkbox" /><i /></label>
          <button onClick={() => duplicateCase(record)} title={`复制测试记录 ${recordIndex + 1}`} type="button"><Icon name="content_copy" /></button>
          <button disabled={caseCount <= 1} onClick={() => removeCase(record.id)} title={`删除测试记录 ${recordIndex + 1}`} type="button"><Icon name="delete" /></button>
        </header>
        <div>{activeFields.map((field) => {
          const override = record.requestOverrides.find((item) =>
            requestFieldKey(item.stepId, item.target, item.path) === field.key);
          return <label className="scenario-dataset-record-field" key={field.key}>
            <span><b>步骤 {field.stepIndex + 1}</b><strong>{field.stepName}</strong><small><i>{requestTargetLabels[field.target]}</i><code title={field.path}>{field.path || "(完整值)"}</code></small></span>
            <input aria-label={`${dataset.name} ${record.name} 步骤 ${field.stepIndex + 1} ${requestTargetLabels[field.target]} ${field.path || "完整值"}`} onChange={(event) => patchOverride(record, field, parseRequestValue(event.target.value))} value={requestValueText(override?.value)} />
          </label>;
        })}</div>
      </article>)}</div>}
    </section>
    <button className="btn danger scenario-dataset-delete" disabled={!removable} onClick={onDelete} type="button"><Icon name="delete" />删除数据集</button>
    {showOverrideFields && <DataDetailDialog
      description={`“${dataset.name}”中的每条测试记录都可以为这些字段提供独立值，运行时不会修改原始接口定义。`}
      emptyMessage="当前数据集没有请求覆盖字段。"
      items={activeFields.map((field) => ({
        badge: requestTargetLabels[field.target],
        description: `步骤 ${field.stepIndex + 1} · ${field.stepName}`,
        title: field.path || "(完整请求值)",
        value: `${dataset.records.length} 条记录已配置`,
      }))}
      onClose={() => setShowOverrideFields(false)}
      title="请求覆盖字段"
    />}
  </div>;
}

function DataDetailDialog({
  description,
  emptyMessage,
  items,
  onClose,
  title,
}: {
  description: string;
  emptyMessage: string;
  items: Array<{ badge: string; description: string; title: string; value: string }>;
  onClose: () => void;
  title: string;
}) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return <div className="modal-backdrop scenario-data-detail-backdrop" onMouseDown={(event) => {
    if (event.target === event.currentTarget) onClose();
  }} role="presentation">
    <section aria-labelledby="scenario-data-detail-title" aria-modal="true" className="scenario-data-detail-dialog" role="dialog">
      <header>
        <div><span className="eyebrow">Data details</span><h3 id="scenario-data-detail-title">{title}</h3><p>{description}</p></div>
        <button className="icon-btn" onClick={onClose} ref={closeButtonRef} title="关闭详情" type="button"><Icon name="close" /></button>
      </header>
      {items.length === 0 ? <div className="scenario-data-detail-empty"><Icon name="data_object" /><span>{emptyMessage}</span></div> : <div className="scenario-data-detail-list">
        {items.map((item, index) => <article key={`${item.description}-${item.title}`}>
          <b>{index + 1}</b>
          <span><strong>{item.title}</strong><small>{item.description}</small></span>
          <i>{item.badge}</i>
          <code title={item.value}>{item.value || '""'}</code>
        </article>)}
      </div>}
      <footer><button className="btn primary" onClick={onClose} type="button">知道了</button></footer>
    </section>
  </div>;
}

function JsonSnapshot({ label, value }: { label: string; value: unknown }) {
  if (value === undefined) return null;
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return <section className="scenario-run-snapshot"><strong>{label}</strong><pre>{text}</pre></section>;
}

function RunStepDetail({ index, result }: { index: number; result: ScenarioStepResult }) {
  const extractedVariables = result.extractedVariables ?? [];
  const resolvedBindings = result.resolvedBindings ?? [];
  const assertions = result.assertions ?? [];
  const hasDetails = Boolean(
    result.request
    || result.response
    || result.errorMessage
    || assertions.length
    || extractedVariables.length
    || resolvedBindings.length,
  );
  return <details className={`scenario-run-step ${result.status}`}>
    <summary>
      <b>{index + 1}</b>
      <span><strong>{result.name}</strong><small>{result.request?.method ?? result.kind ?? "步骤"} · {(result.request?.url ?? result.request?.path ?? result.message) || "暂无执行说明"}</small></span>
      {result.response?.statusCode !== undefined && <code>HTTP {result.response.statusCode}</code>}
      <small>{result.durationMs}ms</small>
      <i className={result.status}>{result.status}</i>
      <Icon name="expand_more" />
    </summary>
    <div className="scenario-run-step-detail">
      <div className="scenario-run-step-meta">
        {result.executionId && <span>执行记录 <code>{result.executionId}</code></span>}
        {result.startedAt && <span>开始 {formatDate(result.startedAt)}</span>}
        {result.finishedAt && <span>结束 {formatDate(result.finishedAt)}</span>}
      </div>
      {result.message && result.message !== result.errorMessage && <p className="scenario-run-message">{result.message}</p>}
      {result.errorMessage && <div className="scenario-run-error"><Icon name="error" /><div><strong>执行错误</strong><p>{result.errorMessage}</p></div></div>}
      {!hasDetails && <div className="scenario-run-detail-empty"><Icon name="info" /><span>后端运行详情尚未返回该步骤的请求、响应或断言快照。</span></div>}
      <div className="scenario-run-data-sections">
        {result.request && <details className="scenario-run-data-section request">
          <summary><span><Icon name="upload" /><strong>请求信息</strong><small>{result.request.url ?? result.request.path ?? "查看实际请求数据"}</small></span>{result.request.method && <em>{result.request.method}</em>}<Icon name="expand_more" /></summary>
          <div className="scenario-run-data-content">
            {(result.request.url || result.request.path) && <p className="scenario-run-url">{result.request.url ?? result.request.path}</p>}
            <JsonSnapshot label="Headers" value={result.request.headers} />
            <JsonSnapshot label="Query 参数" value={result.request.queryParams} />
            <JsonSnapshot label="Request Body" value={result.request.body} />
          </div>
        </details>}
        {result.response && <details className="scenario-run-data-section response">
          <summary><span><Icon name="download" /><strong>响应信息</strong><small>查看响应头、响应体与消息数据</small></span>{result.response.statusCode !== undefined && <em>HTTP {result.response.statusCode}</em>}<Icon name="expand_more" /></summary>
          <div className="scenario-run-data-content">
            <JsonSnapshot label="Headers" value={result.response.headers} />
            <JsonSnapshot label="Response Body" value={result.response.body} />
            <JsonSnapshot label="WebSocket 消息" value={result.response.receivedMessages} />
          </div>
        </details>}
        {assertions.length > 0 && <details className="scenario-run-data-section assertions">
          <summary><span><Icon name="fact_check" /><strong>断言结果</strong><small>查看预期值、实际值与校验信息</small></span><em>{assertions.length} 条</em><Icon name="expand_more" /></summary>
          <div className="scenario-run-data-content scenario-run-assertions">{assertions.map((assertion, assertionIndex) => <div key={`${assertion.name}-${assertionIndex}`}><i className={assertion.status}>{assertion.status}</i><strong>{assertion.name}</strong><span>{assertion.message}</span>{assertion.expected !== undefined && <code>期望 {runtimeValue(assertion.expected)}</code>}{assertion.actual !== undefined && <code>实际 {runtimeValue(assertion.actual)}</code>}</div>)}</div>
        </details>}
      </div>
      {(resolvedBindings.length > 0 || extractedVariables.length > 0) && <section className="scenario-run-values"><h4>变量追踪</h4><div>{resolvedBindings.map((binding) => <span key={binding.bindingId}><b>输入</b><code>{bindingTargetLabel({ id: binding.bindingId, sourceStepId: binding.sourceStepId, sourceExtractionId: binding.sourceExtractionId, target: binding.target as ScenarioBindingTarget, targetPath: binding.targetPath })}</code><em>{runtimeValue(binding.value, binding.masked)}</em></span>)}{extractedVariables.map((variable) => <span key={variable.extractionId}><b>输出</b><code>{variable.name || variable.path}</code><em className={variable.error ? "error" : ""}>{variable.error ? `提取失败：${variable.error}` : runtimeValue(variable.value, variable.masked)}</em></span>)}</div></section>}
    </div>
  </details>;
}

function HistoryTab({
  deletingRunIds,
  loadingRunIds,
  onDeleteRun,
  onLoadRun,
  runs,
  scenario,
}: {
  deletingRunIds: Set<string>;
  loadingRunIds: Set<string>;
  onDeleteRun: (run: ScenarioRun) => void;
  onLoadRun: (run: ScenarioRun) => void;
  runs: ScenarioRun[];
  scenario: TestScenario;
}) {
  return <div className="scenario-history-tab"><div className="panel-title"><div><h3>调试记录</h3><p className="scenario-muted">展开运行和步骤，查看实际请求、响应、断言、错误与变量值</p></div></div>
    {runs.length === 0 ? <div className="scenario-lane-empty"><Icon name="history" /><h3>暂无调试记录</h3><p>保存并运行场景后，步骤执行结果会显示在这里。</p></div> : <div className="scenario-run-list">{runs.map((run) => {
      const loading = loadingRunIds.has(run.id);
      const deleting = deletingRunIds.has(run.id);
      const passedSteps = run.stepResults.filter((result) => result.status === "passed").length;
      const recordLabel = scenarioRunRecordLabel(run, scenario);
      return <details className={`${loading ? "scenario-run-card loading" : "scenario-run-card"} ${run.status}${deleting ? " deleting" : ""}`} key={run.id} onToggle={(event) => event.currentTarget.open && onLoadRun(run)}>
        <summary className="scenario-run-summary">
          <span className={`status ${run.status === "passed" ? "status-通过" : "status-失败"}`}>{run.status}</span>
          <span><strong>{run.environmentName ?? "未命名环境"} · {scenarioRunIdentity(run, scenario)}</strong><small>{recordLabel && run.recordId ? `记录 ${run.recordId} · ` : ""}{formatDate(run.startedAt)} · {(run.durationMs / 1000).toFixed(1)}s</small></span>
          <span className="scenario-run-progress">{passedSteps}/{run.stepResults.length} 步骤通过</span>
          <button aria-label={`删除调试记录 ${scenarioRunIdentity(run, scenario)}`} className="scenario-run-delete" disabled={deleting} onClick={(event) => { event.preventDefault(); event.stopPropagation(); void onDeleteRun(run); }} title="删除调试记录" type="button"><Icon name={deleting ? "progress_activity" : "delete"} /></button>
          <Icon name={loading ? "progress_activity" : "expand_more"} />
        </summary>
        <div className="scenario-run-content">
          {loading && <div className="scenario-run-loading"><Icon name="progress_activity" />正在加载完整运行详情...</div>}
          {!loading && run.stepResults.map((result, index) => <RunStepDetail index={index} key={result.stepId} result={result} />)}
          {!loading && run.stepResults.length === 0 && <div className="scenario-run-detail-empty"><Icon name="info" /><span>该运行没有返回步骤详情。</span></div>}
        </div>
      </details>;
    })}</div>}
  </div>;
}
