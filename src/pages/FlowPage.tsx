import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type PointerEvent as ReactPointerEvent } from "react";
import { listTestCases, listWebSocketTestCases, type BackendTestCase } from "../api/apiCases";
import {
  createFlow,
  executeUnsavedFlow,
  getFlow,
  listFlows,
  updateFlow,
  validateFlowDefinition,
  type FlowDefinition,
  type FlowEdge,
  type FlowEdgeRoute,
  type FlowInputBinding,
  type FlowNode,
  type FlowNodeKind,
  type FlowSummary,
} from "../api/flows";
import { Icon } from "../components/Icon";
import type { ActionHandler } from "../types";

interface CaseAsset {
  id: string | number;
  kind: "api_case" | "websocket_case";
  name: string;
  method: string;
  path: string;
}

const palette: Array<{ kind: FlowNodeKind; icon: string; name: string; description: string }> = [
  { kind: "condition", icon: "alt_route", name: "条件分支", description: "根据表达式决定后续路径" },
  { kind: "delay", icon: "schedule", name: "等待", description: "延迟指定时间后继续" },
  { kind: "start", icon: "play_circle", name: "开始", description: "流程执行入口" },
  { kind: "end", icon: "stop_circle", name: "结束", description: "流程执行终点" },
];

const kindMeta: Record<FlowNodeKind, { icon: string; label: string; tone: string }> = {
  api_case: { icon: "api", label: "HTTP 接口", tone: "blue" },
  websocket_case: { icon: "hub", label: "WebSocket", tone: "green" },
  condition: { icon: "alt_route", label: "条件分支", tone: "orange" },
  delay: { icon: "schedule", label: "等待", tone: "blue" },
  start: { icon: "play_circle", label: "开始", tone: "green" },
  end: { icon: "stop_circle", label: "结束", tone: "orange" },
};

function uniqueId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function executionKey() {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : uniqueId("execution");
}

function unwrapCases(result: unknown): BackendTestCase[] {
  if (Array.isArray(result)) return result;
  if (!result || typeof result !== "object") return [];
  const source = result as { data?: unknown; items?: unknown; records?: unknown; results?: unknown };
  const list = source.data ?? source.items ?? source.records ?? source.results;
  return Array.isArray(list) ? list as BackendTestCase[] : [];
}

function mapCase(source: BackendTestCase, index: number, kind: CaseAsset["kind"]): CaseAsset {
  return {
    id: source.id as string | number ?? source.test_case_id as string | number ?? `${kind}-${index}`,
    kind,
    name: String(source.name ?? source.title ?? "未命名测试用例"),
    method: kind === "websocket_case" ? "WS" : String(source.method ?? "GET").toUpperCase(),
    path: String(source.path ?? source.url ?? ""),
  };
}

function createNode(kind: FlowNodeKind, position: { x: number; y: number }, asset?: CaseAsset): FlowNode {
  const meta = kindMeta[kind];
  return {
    id: uniqueId("node"),
    kind,
    name: asset?.name ?? meta.label,
    referenceId: asset?.id,
    method: asset?.method,
    path: asset?.path,
    position,
    config: {
      condition: kind === "condition" ? "true" : "",
      delayMs: kind === "delay" ? 1000 : undefined,
      continueOnFailure: false,
      inputBindings: [],
      outputPaths: kind === "api_case" || kind === "websocket_case" ? ["response.body", "response.status"] : [],
    },
  };
}

function emptyFlow(projectId: number, environmentId?: number): FlowDefinition {
  return {
    schemaVersion: "1.0",
    projectId,
    environmentId,
    name: "未命名可视化流程",
    description: "",
    nodes: [],
    edges: [],
    viewport: { zoom: 1 },
  };
}

function normalizeFlow(value: unknown, projectId: number, environmentId?: number): FlowDefinition {
  if (!value || typeof value !== "object") throw new Error("导入文件不是有效的流程 JSON");
  const source = value as Partial<FlowDefinition>;
  if (!Array.isArray(source.nodes) || !Array.isArray(source.edges)) throw new Error("导入文件缺少 nodes 或 edges");
  const defaults = emptyFlow(projectId, environmentId);
  return {
    ...defaults,
    ...source,
    schemaVersion: "1.0",
    projectId,
    environmentId: source.environmentId ?? environmentId,
    name: String(source.name ?? defaults.name),
    description: String(source.description ?? ""),
    nodes: source.nodes.map((node) => ({
      ...node,
      id: node.id === undefined || node.id === null ? "" : String(node.id),
      name: String(node.name ?? ""),
      position: {
        x: Number(node.position?.x),
        y: Number(node.position?.y),
      },
      config: {
        ...node.config,
        caseConfig: node.config?.caseConfig && typeof node.config.caseConfig === "object" && !Array.isArray(node.config.caseConfig)
          ? node.config.caseConfig
          : undefined,
        caseOverrides: node.config?.caseOverrides && typeof node.config.caseOverrides === "object" && !Array.isArray(node.config.caseOverrides)
          ? node.config.caseOverrides
          : undefined,
        inputBindings: Array.isArray(node.config?.inputBindings)
          ? node.config.inputBindings.map((binding) => ({
            ...binding,
            id: binding.id === undefined || binding.id === null ? "" : String(binding.id),
            target: String(binding.target ?? ""),
            sourceNodeId: String(binding.sourceNodeId ?? ""),
            sourcePath: String(binding.sourcePath ?? ""),
          }))
          : [],
        outputPaths: Array.isArray(node.config?.outputPaths) ? node.config.outputPaths.map(String) : [],
      },
    })),
    edges: source.edges.map((edge) => ({
      ...edge,
      id: edge.id === undefined || edge.id === null ? "" : String(edge.id),
      source: String(edge.source ?? ""),
      target: String(edge.target ?? ""),
      route: edge.route ?? "always",
    })),
    viewport: { zoom: Math.max(.6, Math.min(1.4, source.viewport?.zoom ?? 1)) },
  };
}

function edgePath(source: FlowNode, target: FlowNode) {
  const sx = source.position.x + 188;
  const sy = source.position.y + 48;
  const tx = target.position.x;
  const ty = target.position.y + 48;
  const bend = Math.max(50, Math.abs(tx - sx) * 0.45);
  return `M ${sx} ${sy} C ${sx + bend} ${sy}, ${tx - bend} ${ty}, ${tx} ${ty}`;
}

function hasPath(edges: FlowEdge[], source: string, target: string) {
  const visited = new Set<string>();
  const pending = [source];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || visited.has(current)) continue;
    if (current === target) return true;
    visited.add(current);
    edges.filter((edge) => edge.source === current).forEach((edge) => pending.push(edge.target));
  }
  return false;
}

export function FlowPage({
  environmentId,
  onAction,
  projectId,
}: {
  environmentId?: number;
  onAction: ActionHandler;
  projectId?: number;
}) {
  const [flow, setFlow] = useState<FlowDefinition>(() => emptyFlow(projectId ?? 0, environmentId));
  const [flows, setFlows] = useState<FlowSummary[]>([]);
  const [assets, setAssets] = useState<CaseAsset[]>([]);
  const [assetSearch, setAssetSearch] = useState("");
  const [selectedNodeId, setSelectedNodeId] = useState<string>();
  const [connectingFrom, setConnectingFrom] = useState<string>();
  const [message, setMessage] = useState("");
  const [loadingAssets, setLoadingAssets] = useState(false);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [dragging, setDragging] = useState<{ id: string; offsetX: number; offsetY: number }>();
  const [connectionPointer, setConnectionPointer] = useState<{ x: number; y: number }>();
  const [invalidLocalConfigs, setInvalidLocalConfigs] = useState<Set<string>>(() => new Set());
  const canvasRef = useRef<HTMLDivElement>(null);
  const importRef = useRef<HTMLInputElement>(null);

  const selectedNode = useMemo(
    () => flow.nodes.find((node) => node.id === selectedNodeId),
    [flow.nodes, selectedNodeId],
  );
  const filteredAssets = useMemo(() => {
    const query = assetSearch.trim().toLowerCase();
    return query ? assets.filter((asset) => `${asset.name} ${asset.method} ${asset.path}`.toLowerCase().includes(query)) : assets;
  }, [assetSearch, assets]);

  useEffect(() => {
    setInvalidLocalConfigs(new Set());
  }, [selectedNodeId]);

  const notify = useCallback((text: string) => {
    setMessage(text);
    onAction(text);
  }, [onAction]);

  useEffect(() => {
    setFlow(emptyFlow(projectId ?? 0, environmentId));
    setSelectedNodeId(undefined);
    setConnectingFrom(undefined);
    setInvalidLocalConfigs(new Set());
    if (!projectId) {
      setAssets([]);
      setFlows([]);
      return;
    }
    let ignore = false;
    setLoadingAssets(true);
    void Promise.allSettled([listTestCases(projectId), listWebSocketTestCases(projectId), listFlows(projectId)])
      .then(([httpResult, websocketResult, flowResult]) => {
        if (ignore) return;
        const nextAssets = [
          ...(httpResult.status === "fulfilled" ? unwrapCases(httpResult.value).map((item, index) => mapCase(item, index, "api_case")) : []),
          ...(websocketResult.status === "fulfilled" ? unwrapCases(websocketResult.value).map((item, index) => mapCase(item, index, "websocket_case")) : []),
        ];
        setAssets(nextAssets);
        setFlows(flowResult.status === "fulfilled" ? flowResult.value : []);
      })
      .finally(() => {
        if (!ignore) setLoadingAssets(false);
      });
    return () => {
      ignore = true;
    };
  }, [projectId]);

  useEffect(() => {
    setFlow((current) => ({ ...current, environmentId }));
  }, [environmentId]);

  const updateNode = useCallback((nodeId: string, updater: (node: FlowNode) => FlowNode) => {
    setFlow((current) => ({ ...current, nodes: current.nodes.map((node) => node.id === nodeId ? updater(node) : node) }));
  }, []);

  const addNode = useCallback((kind: FlowNodeKind, position: { x: number; y: number }, asset?: CaseAsset) => {
    const node = createNode(kind, position, asset);
    setFlow((current) => ({ ...current, nodes: [...current.nodes, node] }));
    setSelectedNodeId(node.id);
  }, []);

  const dropOnCanvas = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const kind = event.dataTransfer.getData("application/flow-kind") as FlowNodeKind;
    const assetId = event.dataTransfer.getData("application/flow-asset");
    const asset = assets.find((item) => String(item.id) === assetId);
    if (!kind) return;
    addNode(kind, {
      x: Math.max(12, (event.clientX - rect.left) / flow.viewport.zoom - 94),
      y: Math.max(12, (event.clientY - rect.top) / flow.viewport.zoom - 35),
    }, asset);
  };

  const beginNodeDrag = (event: ReactPointerEvent<HTMLDivElement>, node: FlowNode) => {
    if ((event.target as HTMLElement).closest("button")) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setSelectedNodeId(node.id);
    setDragging({
      id: node.id,
      offsetX: (event.clientX - rect.left) / flow.viewport.zoom - node.position.x,
      offsetY: (event.clientY - rect.top) / flow.viewport.zoom - node.position.y,
    });
  };

  const moveNode = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    if (connectingFrom) {
      setConnectionPointer({
        x: (event.clientX - rect.left) / flow.viewport.zoom,
        y: (event.clientY - rect.top) / flow.viewport.zoom,
      });
    }
    if (!dragging) return;
    const canvasWidth = rect.width / flow.viewport.zoom;
    const canvasHeight = rect.height / flow.viewport.zoom;
    const x = Math.max(8, Math.min(canvasWidth - 196, (event.clientX - rect.left) / flow.viewport.zoom - dragging.offsetX));
    const y = Math.max(8, Math.min(canvasHeight - 104, (event.clientY - rect.top) / flow.viewport.zoom - dragging.offsetY));
    updateNode(dragging.id, (node) => ({ ...node, position: { x, y } }));
  };

  const connectNode = (targetId: string) => {
    if (!connectingFrom) return;
    const sourceNode = flow.nodes.find((node) => node.id === connectingFrom);
    const targetNode = flow.nodes.find((node) => node.id === targetId);
    if (sourceNode?.kind === "end") {
      setConnectingFrom(undefined);
      setConnectionPointer(undefined);
      notify("结束节点不能连接下游节点");
      return;
    }
    if (targetNode?.kind === "start") {
      setConnectingFrom(undefined);
      setConnectionPointer(undefined);
      notify("开始节点不能连接上游节点");
      return;
    }
    if (sourceNode?.kind === "condition" && flow.edges.filter((edge) => edge.source === connectingFrom).length >= 2) {
      setConnectingFrom(undefined);
      setConnectionPointer(undefined);
      notify("条件节点最多连接一条 true 和一条 false 下游路径");
      return;
    }
    if (connectingFrom === targetId || flow.edges.some((edge) => edge.source === connectingFrom && edge.target === targetId)) {
      setConnectingFrom(undefined);
      return;
    }
    if (hasPath(flow.edges, targetId, connectingFrom)) {
      setConnectingFrom(undefined);
      notify("流程不允许形成循环关联");
      return;
    }
    setFlow((current) => {
      if (current.edges.some((edge) => edge.source === connectingFrom && edge.target === targetId)) return current;
      const source = current.nodes.find((node) => node.id === connectingFrom);
      const existingRoutes = current.edges.filter((edge) => edge.source === connectingFrom).map((edge) => edge.route);
      const route: FlowEdgeRoute = source?.kind === "condition"
        ? existingRoutes.includes("true") ? "false" : "true"
        : "always";
      return { ...current, edges: [...current.edges, { id: uniqueId("edge"), source: connectingFrom, target: targetId, route }] };
    });
    setConnectingFrom(undefined);
    setConnectionPointer(undefined);
  };

  const beginConnection = (event: ReactPointerEvent<HTMLButtonElement>, nodeId: string) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    setConnectingFrom(nodeId);
    setConnectionPointer({
      x: (event.clientX - rect.left) / flow.viewport.zoom,
      y: (event.clientY - rect.top) / flow.viewport.zoom,
    });
  };

  const finishConnection = (event: ReactPointerEvent<HTMLDivElement>) => {
    setDragging(undefined);
    if (!connectingFrom) return;
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-flow-input]");
    const targetId = target?.dataset.flowInput;
    if (targetId) connectNode(targetId);
    else {
      setConnectingFrom(undefined);
      setConnectionPointer(undefined);
    }
  };

  const previewPath = useMemo(() => {
    const source = flow.nodes.find((node) => node.id === connectingFrom);
    if (!source || !connectionPointer) return "";
    const sx = source.position.x + 188;
    const sy = source.position.y + 48;
    const bend = Math.max(50, Math.abs(connectionPointer.x - sx) * .45);
    return `M ${sx} ${sy} C ${sx + bend} ${sy}, ${connectionPointer.x - bend} ${connectionPointer.y}, ${connectionPointer.x} ${connectionPointer.y}`;
  }, [connectingFrom, connectionPointer, flow.nodes]);

  const deleteSelected = () => {
    if (!selectedNodeId) return;
    setFlow((current) => ({
      ...current,
      edges: current.edges.filter((edge) => edge.source !== selectedNodeId && edge.target !== selectedNodeId),
      nodes: current.nodes
        .filter((node) => node.id !== selectedNodeId)
        .map((node) => ({
          ...node,
          config: {
            ...node.config,
            inputBindings: node.config.inputBindings.filter((binding) => binding.sourceNodeId !== selectedNodeId),
          },
        })),
    }));
    setInvalidLocalConfigs((current) => new Set([...current].filter((key) => !key.startsWith(`${selectedNodeId}:`))));
    setSelectedNodeId(undefined);
  };

  const duplicateSelected = () => {
    if (!selectedNode) return;
    const node = {
      ...selectedNode,
      id: uniqueId("node"),
      name: `${selectedNode.name} 副本`,
      position: { x: selectedNode.position.x + 28, y: selectedNode.position.y + 28 },
      config: {
        ...selectedNode.config,
        inputBindings: selectedNode.config.inputBindings.map((binding) => ({ ...binding, id: uniqueId("binding") })),
        outputPaths: [...selectedNode.config.outputPaths],
      },
    };
    setFlow((current) => ({ ...current, nodes: [...current.nodes, node] }));
    setSelectedNodeId(node.id);
  };

  const autoLayout = () => {
    const incoming = new Map(flow.nodes.map((node) => [node.id, 0]));
    flow.edges.forEach((edge) => incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1));
    const ordered = [...flow.nodes].sort((a, b) => (incoming.get(a.id) ?? 0) - (incoming.get(b.id) ?? 0));
    setFlow((current) => ({
      ...current,
      nodes: current.nodes.map((node) => {
        const index = ordered.findIndex((item) => item.id === node.id);
        return { ...node, position: { x: 40 + (index % 4) * 245, y: 70 + Math.floor(index / 4) * 155 } };
      }),
    }));
    notify("已自动整理画布");
  };

  const saveFlow = async () => {
    if (!projectId) return notify("请先选择项目");
    if (!flow.name.trim()) return notify("请输入流程名称");
    if (invalidLocalConfigs.size > 0) return notify("请先修正节点本地用例配置中的 JSON 格式错误");
    const issues = validateFlowDefinition(flow);
    if (issues.length > 0) return notify(issues[0].message);
    setSaving(true);
    const definition = { ...flow, projectId, environmentId, updatedAt: new Date().toISOString() };
    try {
      const result = definition.id
        ? await updateFlow(projectId, definition.id, definition)
        : await createFlow(projectId, definition);
      const id = String(result.id ?? result.flow_id ?? definition.id ?? "");
      if (id) setFlow((current) => ({ ...current, id }));
      notify("流程已保存");
      void listFlows(projectId).then(setFlows).catch(() => undefined);
    } catch (error) {
      notify(error instanceof Error ? error.message : "流程保存失败");
    } finally {
      setSaving(false);
    }
  };

  const runFlow = async () => {
    if (!projectId) return notify("请先选择项目");
    if (flow.nodes.length === 0) return notify("请先添加流程节点");
    if (invalidLocalConfigs.size > 0) return notify("请先修正节点本地用例配置中的 JSON 格式错误");
    const issues = validateFlowDefinition(flow, true);
    if (issues.length > 0) return notify(issues[0].message);
    setRunning(true);
    try {
      const result = await executeUnsavedFlow(projectId, { ...flow, projectId, environmentId }, environmentId, executionKey());
      notify(result.execution_id ? `流程执行完成，执行编号 ${result.execution_id}` : "流程执行完成");
    } catch (error) {
      notify(error instanceof Error ? error.message : "流程试运行失败");
    } finally {
      setRunning(false);
    }
  };

  const importFlow = async (file?: File) => {
    if (!file) return;
    try {
      const value = JSON.parse(await file.text());
      const next = { ...normalizeFlow(value.definition ?? value, projectId ?? 0, environmentId), id: undefined, updatedAt: undefined };
      const issues = validateFlowDefinition(next);
      if (issues.length > 0) throw new Error(`导入失败：${issues[0].message}`);
      setFlow(next);
      setSelectedNodeId(undefined);
      setInvalidLocalConfigs(new Set());
      notify(`已导入 ${next.nodes.length} 个节点`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "流程导入失败");
    }
  };

  const exportFlow = () => {
    const blob = new Blob([JSON.stringify(flow, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${flow.name || "flow"}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
    notify("流程 JSON 已导出");
  };

  const loadSavedFlow = async (summary: FlowSummary) => {
    if (!projectId) return;
    try {
      const definition = summary.definition ?? await getFlow(projectId, summary.id);
      setFlow({ ...normalizeFlow(definition, projectId, environmentId), id: definition.id ?? summary.id });
      setSelectedNodeId(undefined);
      setInvalidLocalConfigs(new Set());
    } catch (error) {
      notify(error instanceof Error ? error.message : "流程加载失败");
    }
  };

  const removeEdge = (edgeId: string) => {
    setFlow((current) => {
      const edge = current.edges.find((item) => item.id === edgeId);
      if (!edge) return current;
      return {
        ...current,
        edges: current.edges.filter((item) => item.id !== edgeId),
        nodes: current.nodes.map((node) => node.id !== edge.target ? node : {
          ...node,
          config: {
            ...node.config,
            inputBindings: node.config.inputBindings.filter((binding) => binding.sourceNodeId !== edge.source),
          },
        }),
      };
    });
  };

  return (
    <section className="page page-flow">
      <div className="flow-command-bar">
        <div className="flow-title-fields">
          <input aria-label="流程名称" onChange={(event) => setFlow((current) => ({ ...current, name: event.target.value }))} value={flow.name} />
          <span>{flow.nodes.length} 节点 · {flow.edges.length} 关联</span>
        </div>
        <div className="toolbar-actions">
          <input accept="application/json,.json" aria-label="导入流程文件" hidden onChange={(event) => void importFlow(event.target.files?.[0])} ref={importRef} type="file" />
          <button className="btn" onClick={() => importRef.current?.click()} type="button"><Icon name="upload_file" />导入</button>
          <button className="btn" onClick={exportFlow} type="button"><Icon name="download" />导出</button>
          <button className="btn" disabled={running} onClick={() => void runFlow()} type="button"><Icon name={running ? "progress_activity" : "play_arrow"} />{running ? "运行中" : "试运行"}</button>
          <button className="btn primary" disabled={saving} onClick={() => void saveFlow()} type="button"><Icon name={saving ? "progress_activity" : "save"} />{saving ? "保存中" : "保存流程"}</button>
        </div>
      </div>

      <div className="flow-builder-shell">
        <aside className="builder-list flow-assets-panel">
          <div className="panel-title"><h3>测试用例与组件</h3><small>{assets.length} 个用例</small></div>
          <label className="flow-search"><Icon name="search" /><input aria-label="搜索测试用例" onChange={(event) => setAssetSearch(event.target.value)} placeholder="搜索用例、方法或路径" value={assetSearch} /></label>
          <div className="flow-panel-section">
            <strong>测试用例</strong>
            {loadingAssets && <p className="empty-copy">正在加载测试用例...</p>}
            {!loadingAssets && filteredAssets.length === 0 && <p className="empty-copy">暂无匹配用例，可从接口测试用例模块创建。</p>}
            {filteredAssets.map((asset) => (
              <button
                className="flow-asset"
                draggable
                key={`${asset.kind}-${asset.id}`}
                onDragStart={(event) => {
                  event.dataTransfer.setData("application/flow-kind", asset.kind);
                  event.dataTransfer.setData("application/flow-asset", String(asset.id));
                }}
                onDoubleClick={() => addNode(asset.kind, { x: 80 + flow.nodes.length * 20, y: 80 + flow.nodes.length * 18 }, asset)}
                type="button"
              >
                <span className={`method method-${asset.method}`}>{asset.method}</span>
                <span><strong>{asset.name}</strong><small>{asset.path || "未配置路径"}</small></span>
                <Icon name="drag_indicator" />
              </button>
            ))}
          </div>
          <div className="flow-panel-section">
            <strong>流程组件</strong>
            {palette.map((item) => (
              <button
                className="flow-asset flow-component"
                draggable
                key={item.kind}
                onDragStart={(event) => event.dataTransfer.setData("application/flow-kind", item.kind)}
                onDoubleClick={() => addNode(item.kind, { x: 100 + flow.nodes.length * 20, y: 100 + flow.nodes.length * 18 })}
                type="button"
              >
                <Icon name={item.icon} /><span><strong>{item.name}</strong><small>{item.description}</small></span><Icon name="drag_indicator" />
              </button>
            ))}
          </div>
          {flows.length > 0 && <div className="flow-panel-section"><strong>已保存流程</strong>{flows.map((item) => <button className="saved-flow-item" key={item.id} onClick={() => void loadSavedFlow(item)} type="button"><Icon name="account_tree" /><span>{item.name}<small>{item.nodeCount} 节点</small></span></button>)}</div>}
        </aside>

        <div className="canvas-panel flow-canvas-panel">
          <div className="canvas-toolbar">
            <button className="btn" onClick={autoLayout} type="button"><Icon name="auto_fix_high" />自动布局</button>
            <button className="btn" disabled={!selectedNode} onClick={duplicateSelected} type="button"><Icon name="content_copy" />复制节点</button>
            <button className="btn flow-danger-btn" disabled={!selectedNode} onClick={deleteSelected} type="button"><Icon name="delete" />删除节点</button>
            <span className="canvas-hint">{connectingFrom ? "请选择目标节点的输入端口" : "拖入组件，拖动节点位置，点击端口建立关联"}</span>
            <div className="flow-zoom">
              <button aria-label="缩小画布" onClick={() => setFlow((current) => ({ ...current, viewport: { zoom: Math.max(.6, current.viewport.zoom - .1) } }))} type="button"><Icon name="remove" /></button>
              <span>{Math.round(flow.viewport.zoom * 100)}%</span>
              <button aria-label="放大画布" onClick={() => setFlow((current) => ({ ...current, viewport: { zoom: Math.min(1.4, current.viewport.zoom + .1) } }))} type="button"><Icon name="add" /></button>
            </div>
          </div>
          <div className="flow-canvas-viewport">
            <div
              className={connectingFrom ? "flow-canvas is-connecting" : "flow-canvas"}
              onDragOver={(event) => event.preventDefault()}
              onDrop={dropOnCanvas}
              onPointerMove={moveNode}
              onPointerUp={finishConnection}
              ref={canvasRef}
              style={{
                height: `${100 / flow.viewport.zoom}%`,
                transform: `scale(${flow.viewport.zoom})`,
                width: `${100 / flow.viewport.zoom}%`,
              }}
            >
              {flow.nodes.length === 0 && <div className="flow-empty"><Icon name="account_tree" /><strong>从左侧拖入测试用例或流程组件</strong><span>双击组件也可以快速添加到画布</span></div>}
              <svg className="flow-lines">
                {flow.edges.map((edge) => {
                  const source = flow.nodes.find((node) => node.id === edge.source);
                  const target = flow.nodes.find((node) => node.id === edge.target);
                  if (!source || !target) return null;
                  return <path d={edgePath(source, target)} key={edge.id} onClick={() => removeEdge(edge.id)} />;
                })}
                {previewPath && <path className="flow-preview-line" d={previewPath} />}
              </svg>
              {flow.nodes.map((node) => {
                const meta = kindMeta[node.kind];
                return (
                  <div
                    className={`flow-node tone-${meta.tone}${selectedNodeId === node.id ? " active" : ""}`}
                    key={node.id}
                    onClick={() => setSelectedNodeId(node.id)}
                    onPointerDown={(event) => beginNodeDrag(event, node)}
                    style={{ left: node.position.x, top: node.position.y }}
                  >
                    {node.kind !== "start" && (
                      <button
                        aria-label={`连接到 ${node.name}`}
                        className="flow-port input"
                        data-flow-input={node.id}
                        onClick={(event) => { event.stopPropagation(); connectNode(node.id); }}
                        onPointerUp={(event) => { event.stopPropagation(); connectNode(node.id); }}
                        type="button"
                      />
                    )}
                    <div className="flow-node-head"><Icon name={meta.icon} /><span>{meta.label}</span>{node.method && <b className={`method method-${node.method}`}>{node.method}</b>}</div>
                    <strong>{node.name}</strong>
                    <small>{node.path || node.config.condition || (node.config.delayMs ? `${node.config.delayMs} ms` : "流程控制节点")}</small>
                    {node.kind !== "end" && (
                      <button
                        aria-label={`从 ${node.name} 建立连接`}
                        className={connectingFrom === node.id ? "flow-port output active" : "flow-port output"}
                        onClick={(event) => { event.stopPropagation(); setConnectingFrom(node.id); }}
                        onPointerDown={(event) => beginConnection(event, node.id)}
                        type="button"
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <aside className="property-panel flow-property-panel">
          <div className="panel-title"><h3>属性配置</h3>{selectedNode && <span className="status status-muted">{kindMeta[selectedNode.kind].label}</span>}</div>
          {!selectedNode && <div className="flow-property-empty"><Icon name="tune" /><p>选择画布节点后，可配置属性、输入取值和输出字段。</p></div>}
          {selectedNode && (
            <>
              <label>节点名称<input onChange={(event) => updateNode(selectedNode.id, (node) => ({ ...node, name: event.target.value }))} value={selectedNode.name} /></label>
              <label>说明<textarea onChange={(event) => updateNode(selectedNode.id, (node) => ({ ...node, config: { ...node.config, description: event.target.value } }))} value={selectedNode.config.description ?? ""} /></label>
              {selectedNode.kind === "condition" && <label>条件表达式<textarea onChange={(event) => updateNode(selectedNode.id, (node) => ({ ...node, config: { ...node.config, condition: event.target.value } }))} value={selectedNode.config.condition ?? ""} /></label>}
              {selectedNode.kind === "delay" && <label>等待时间（毫秒）<input min="0" onChange={(event) => updateNode(selectedNode.id, (node) => ({ ...node, config: { ...node.config, delayMs: Number(event.target.value) } }))} type="number" value={selectedNode.config.delayMs ?? 0} /></label>}
              <label className="flow-check"><input checked={selectedNode.config.continueOnFailure ?? false} onChange={(event) => updateNode(selectedNode.id, (node) => ({ ...node, config: { ...node.config, continueOnFailure: event.target.checked } }))} type="checkbox" />节点失败后继续执行</label>
              {(selectedNode.kind === "api_case" || selectedNode.kind === "websocket_case") && (
                <NodeCaseConfigEditor
                  node={selectedNode}
                  onChange={(field, value) => updateNode(selectedNode.id, (node) => ({
                    ...node,
                    config: { ...node.config, [field]: value },
                  }))}
                  onValidityChange={(field, valid) => {
                    const key = `${selectedNode.id}:${field}`;
                    setInvalidLocalConfigs((current) => {
                      const next = new Set(current);
                      if (valid) next.delete(key);
                      else next.add(key);
                      return next;
                    });
                  }}
                />
              )}
              <NodeRelations
                edges={flow.edges}
                nodes={flow.nodes}
                onEdgeChange={(edgeId, route) => setFlow((current) => ({
                  ...current,
                  edges: current.edges.map((edge) => edge.id === edgeId ? { ...edge, route } : edge),
                }))}
                onSelect={setSelectedNodeId}
                selectedNode={selectedNode}
              />
              <BindingEditor edges={flow.edges} nodes={flow.nodes} onChange={(inputBindings) => updateNode(selectedNode.id, (node) => ({ ...node, config: { ...node.config, inputBindings } }))} selectedNode={selectedNode} />
              <OutputEditor node={selectedNode} onChange={(outputPaths) => updateNode(selectedNode.id, (node) => ({ ...node, config: { ...node.config, outputPaths } }))} />
            </>
          )}
        </aside>
      </div>
      {message && <span className="flow-inline-message">{message}</span>}
    </section>
  );
}

function NodeCaseConfigEditor({ node, onChange, onValidityChange }: { node: FlowNode; onChange: (field: "caseConfig" | "caseOverrides", value: Record<string, unknown> | undefined) => void; onValidityChange: (field: "caseConfig" | "caseOverrides", valid: boolean) => void }) {
  return (
    <div className="flow-config-section node-case-config">
      <div className="flow-config-head"><strong>节点本地用例配置</strong><span>仅当前流程生效</span></div>
      <p>执行时依次应用完整本地配置、字段覆盖和输入取值关联，不会修改被引用的测试用例。</p>
      <p>不能覆盖项目、用例身份或执行环境字段。</p>
      <JsonObjectEditor
        label="完整本地配置 caseConfig"
        onChange={(value) => onChange("caseConfig", value)}
        onValidityChange={(valid) => onValidityChange("caseConfig", valid)}
        placeholder='{"method":"POST","path":"/login","headers":{"X-Flow-Only":"true"}}'
        value={node.config.caseConfig}
      />
      <JsonObjectEditor
        label="字段覆盖 caseOverrides"
        onChange={(value) => onChange("caseOverrides", value)}
        onValidityChange={(valid) => onValidityChange("caseOverrides", valid)}
        placeholder='{"path":"/login-for-this-flow"}'
        value={node.config.caseOverrides}
      />
    </div>
  );
}

function JsonObjectEditor({ label, onChange, onValidityChange, placeholder, value }: { label: string; onChange: (value: Record<string, unknown> | undefined) => void; onValidityChange: (valid: boolean) => void; placeholder: string; value?: Record<string, unknown> }) {
  const formatted = useMemo(() => value ? JSON.stringify(value, null, 2) : "", [value]);
  const [draft, setDraft] = useState(formatted);
  const [error, setError] = useState("");

  useEffect(() => setDraft(formatted), [formatted]);

  const update = (next: string) => {
    setDraft(next);
    if (!next.trim()) {
      setError("");
      onValidityChange(true);
      onChange(undefined);
      return;
    }
    try {
      const parsed = JSON.parse(next) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("必须输入 JSON 对象");
      setError("");
      onValidityChange(true);
      onChange(parsed as Record<string, unknown>);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "JSON 格式错误");
      onValidityChange(false);
    }
  };

  return (
    <label className={error ? "json-object-editor invalid" : "json-object-editor"}>
      <span>{label}</span>
      <textarea aria-label={label} onChange={(event) => update(event.target.value)} placeholder={placeholder} value={draft} />
      {error && <small>{error}</small>}
    </label>
  );
}

function NodeRelations({ edges, nodes, onEdgeChange, onSelect, selectedNode }: { edges: FlowEdge[]; nodes: FlowNode[]; onEdgeChange: (edgeId: string, route: FlowEdgeRoute) => void; onSelect: (nodeId: string) => void; selectedNode: FlowNode }) {
  const upstreamRelations = edges
    .filter((edge) => edge.target === selectedNode.id)
    .map((edge) => ({ edge, node: nodes.find((node) => node.id === edge.source) }))
    .filter((relation): relation is { edge: FlowEdge; node: FlowNode } => Boolean(relation.node));
  const downstreamRelations = edges
    .filter((edge) => edge.source === selectedNode.id)
    .map((edge) => ({ edge, node: nodes.find((node) => node.id === edge.target) }))
    .filter((relation): relation is { edge: FlowEdge; node: FlowNode } => Boolean(relation.node));

  return (
    <div className="flow-config-section node-relations">
      <div className="flow-config-head"><strong>连接关系</strong><span>{upstreamRelations.length} 上游 · {downstreamRelations.length} 下游</span></div>
      <RelationGroup direction="upstream" onEdgeChange={onEdgeChange} onSelect={onSelect} relations={upstreamRelations} sourceKind={selectedNode.kind} />
      <RelationGroup direction="downstream" onEdgeChange={onEdgeChange} onSelect={onSelect} relations={downstreamRelations} sourceKind={selectedNode.kind} />
    </div>
  );
}

function RelationGroup({ direction, onEdgeChange, onSelect, relations, sourceKind }: { direction: "upstream" | "downstream"; onEdgeChange: (edgeId: string, route: FlowEdgeRoute) => void; onSelect: (nodeId: string) => void; relations: Array<{ edge: FlowEdge; node: FlowNode }>; sourceKind: FlowNodeKind }) {
  const isUpstream = direction === "upstream";
  return (
    <div className="relation-group">
      <div className="relation-label"><Icon name={isUpstream ? "arrow_back" : "arrow_forward"} /><strong>{isUpstream ? "上游节点" : "下游节点"}</strong></div>
      {relations.length === 0 && <span className="relation-empty">暂无{isUpstream ? "上游" : "下游"}节点</span>}
      {relations.map(({ edge, node }) => (
        <div className="relation-row" key={edge.id}>
          <button aria-label={`查看${isUpstream ? "上游" : "下游"}节点 ${node.name}`} className="relation-node" onClick={() => onSelect(node.id)} type="button">
            <Icon name={kindMeta[node.kind].icon} />
            <span><strong>{node.name}</strong><small>{kindMeta[node.kind].label}{node.method ? ` · ${node.method}` : ""}</small></span>
            <Icon name="chevron_right" />
          </button>
          {!isUpstream && (
            <select aria-label={`到 ${node.name} 的执行路由`} onChange={(event) => onEdgeChange(edge.id, event.target.value as FlowEdgeRoute)} value={edge.route}>
              {sourceKind === "condition"
                ? <><option value="true">条件为 true</option><option value="false">条件为 false</option></>
                : <><option value="always">始终执行</option><option value="success">上游成功</option><option value="failure">上游失败</option></>}
            </select>
          )}
        </div>
      ))}
    </div>
  );
}

function BindingEditor({ edges, nodes, onChange, selectedNode }: { edges: FlowEdge[]; nodes: FlowNode[]; onChange: (bindings: FlowInputBinding[]) => void; selectedNode: FlowNode }) {
  const upstreamIds = edges.filter((edge) => edge.target === selectedNode.id).map((edge) => edge.source);
  const upstreamNodes = nodes.filter((node) => upstreamIds.includes(node.id));
  const addBinding = () => {
    const source = upstreamNodes[0];
    onChange([...selectedNode.config.inputBindings, { id: uniqueId("binding"), target: "", sourceNodeId: source?.id ?? "", sourcePath: source?.config.outputPaths[0] ?? "response.body" }]);
  };
  const update = (id: string, field: keyof FlowInputBinding, value: string) => onChange(selectedNode.config.inputBindings.map((item) => item.id === id ? { ...item, [field]: value } : item));
  return (
    <div className="flow-config-section">
      <div className="flow-config-head"><strong>输入取值关联</strong><button onClick={addBinding} type="button">+ 新增</button></div>
      <p>把上游节点输出写入当前节点的请求变量，例如 <code>headers.Authorization</code>。</p>
      {selectedNode.config.inputBindings.map((binding) => (
        <div className="binding-card" key={binding.id}>
          <input aria-label="目标字段" onChange={(event) => update(binding.id, "target", event.target.value)} placeholder="目标字段，如 body.user_id" value={binding.target} />
          <select aria-label="来源节点" onChange={(event) => update(binding.id, "sourceNodeId", event.target.value)} value={binding.sourceNodeId}><option value="">选择上游节点</option>{upstreamNodes.map((node) => <option key={node.id} value={node.id}>{node.name}</option>)}</select>
          <input aria-label="来源路径" onChange={(event) => update(binding.id, "sourcePath", event.target.value)} placeholder="来源路径，如 response.body.data.id" value={binding.sourcePath} />
          <button aria-label="删除输入关联" className="icon-btn" onClick={() => onChange(selectedNode.config.inputBindings.filter((item) => item.id !== binding.id))} type="button"><Icon name="delete" /></button>
        </div>
      ))}
      {upstreamNodes.length === 0 && <small>先连接一个上游节点，才能建立取值关联。</small>}
    </div>
  );
}

function OutputEditor({ node, onChange }: { node: FlowNode; onChange: (paths: string[]) => void }) {
  const [draft, setDraft] = useState("");
  return (
    <div className="flow-config-section">
      <div className="flow-config-head"><strong>可引用输出</strong><button onClick={() => { const path = draft.trim(); if (path && !node.config.outputPaths.includes(path)) { onChange([...node.config.outputPaths, path]); setDraft(""); } }} type="button">+ 添加</button></div>
      <p>声明后续节点可引用的响应路径。</p>
      <div className="output-path-add"><input aria-label="新增输出路径" onChange={(event) => setDraft(event.target.value)} placeholder="response.body.data.token" value={draft} /></div>
      <div className="output-path-list">{node.config.outputPaths.map((path) => <button key={path} onClick={() => onChange(node.config.outputPaths.filter((item) => item !== path))} title="点击移除" type="button">{path}<Icon name="close" /></button>)}</div>
    </div>
  );
}
