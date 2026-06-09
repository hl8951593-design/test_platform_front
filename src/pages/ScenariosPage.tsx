import { useCallback, useEffect, useMemo, useState } from "react";
import { listTestCases, listWebSocketTestCases, type BackendTestCase } from "../api/apiCases";
import type { EnvironmentOption } from "../api/projects";
import {
  clearScenarioRuns,
  deleteScenario,
  duplicateScenario,
  emptyScenario,
  listScenarioRuns,
  listScenarios,
  runScenario,
  saveScenario,
  scenarioUniqueId,
  type ScenarioDataset,
  type ScenarioRun,
  type ScenarioStep,
  type ScenarioStepKind,
  type TestScenario,
} from "../api/scenarios";
import { Icon } from "../components/Icon";
import type { ActionHandler } from "../types";

type ScenarioTab = "design" | "data" | "history";
type ScenarioAsset = Pick<ScenarioStep, "kind" | "referenceId" | "name" | "method" | "path">;

const builtInAssets: ScenarioAsset[] = [
  { kind: "condition", name: "条件判断", method: "IF", path: "根据表达式决定是否继续" },
  { kind: "delay", name: "等待事件", method: "WAIT", path: "等待指定时间后继续" },
];

function unwrapCases(result: unknown): BackendTestCase[] {
  if (Array.isArray(result)) return result;
  if (!result || typeof result !== "object") return [];
  const source = result as { data?: unknown; items?: unknown; records?: unknown; results?: unknown };
  const items = source.data ?? source.items ?? source.records ?? source.results;
  return Array.isArray(items) ? items as BackendTestCase[] : [];
}

function mapCase(source: BackendTestCase, index: number, kind: ScenarioStepKind): ScenarioAsset {
  return {
    kind,
    referenceId: source.id as string | number ?? source.test_case_id as string | number ?? index,
    name: String(source.name ?? source.title ?? "未命名测试用例"),
    method: kind === "websocket_case" ? "WS" : String(source.method ?? "GET").toUpperCase(),
    path: String(source.path ?? source.url ?? ""),
  };
}

function stepFromAsset(asset: ScenarioAsset): ScenarioStep {
  const defaults = asset.kind === "delay"
    ? { duration_ms: 1000 }
    : asset.kind === "condition"
      ? { expression: "{{status}} == 'success'" }
      : {};
  return {
    ...asset,
    id: scenarioUniqueId("STEP"),
    configText: JSON.stringify(defaults, null, 2),
    continueOnFailure: false,
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
  const [tab, setTab] = useState<ScenarioTab>("design");
  const [assets, setAssets] = useState<ScenarioAsset[]>([]);
  const [assetSearch, setAssetSearch] = useState("");
  const [scenarioSearch, setScenarioSearch] = useState("");
  const [assetLoading, setAssetLoading] = useState(false);
  const [assetError, setAssetError] = useState("");

  const reload = useCallback(() => {
    if (!projectId) {
      setScenarios([]);
      setRuns([]);
      return;
    }
    setScenarios(listScenarios(projectId));
    setRuns(listScenarioRuns(projectId));
  }, [projectId]);

  useEffect(() => {
    reload();
    setDraft(undefined);
    setSelectedStepId(undefined);
    setTab("design");
  }, [reload]);

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
  const filteredScenarios = scenarios.filter((scenario) => !scenarioSearch.trim()
    || `${scenario.name} ${scenario.description} ${scenario.tags.join(" ")}`.toLowerCase().includes(scenarioSearch.trim().toLowerCase()));
  const filteredAssets = [...builtInAssets, ...assets].filter((asset) => !assetSearch.trim()
    || `${asset.name} ${asset.method} ${asset.path}`.toLowerCase().includes(assetSearch.trim().toLowerCase()));
  const stats = useMemo(() => [
    { label: "场景数量", value: scenarios.length, icon: "account_tree", tone: "blue" },
    { label: "编排步骤", value: scenarios.reduce((total, item) => total + item.steps.length, 0), icon: "format_list_numbered", tone: "green" },
    { label: "数据集", value: scenarios.reduce((total, item) => total + item.datasets.length, 0), icon: "database", tone: "orange" },
    { label: "调试失败", value: runs.filter((item) => item.status === "failed").length, icon: "error", tone: "red" },
  ], [runs, scenarios]);

  const selectScenario = (scenario: TestScenario) => {
    setDraft(structuredClone(scenario));
    setSelectedStepId(scenario.steps[0]?.id);
    setTab("design");
  };

  const createScenario = () => {
    if (!projectId) return onAction("请先选择项目");
    const next = emptyScenario(projectId, environmentId ?? environments[0]?.id);
    setDraft(next);
    setSelectedStepId(undefined);
    setTab("design");
  };

  const patchDraft = (patch: Partial<TestScenario>) => setDraft((current) => current ? { ...current, ...patch } : current);
  const patchStep = (patch: Partial<ScenarioStep>) => {
    if (!draft || !selectedStepId) return;
    patchDraft({ steps: draft.steps.map((step) => step.id === selectedStepId ? { ...step, ...patch } : step) });
  };

  const addStep = (asset: ScenarioAsset) => {
    if (!draft) return onAction("请先新建或选择场景");
    const step = stepFromAsset(asset);
    patchDraft({ steps: [...draft.steps, step] });
    setSelectedStepId(step.id);
    onAction(`已添加步骤 ${asset.name}`);
  };

  const moveStep = (index: number, direction: -1 | 1) => {
    if (!draft) return;
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= draft.steps.length) return;
    const next = [...draft.steps];
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    patchDraft({ steps: next });
  };

  const removeStep = (stepId: string) => {
    if (!draft) return;
    const steps = draft.steps.filter((step) => step.id !== stepId);
    patchDraft({ steps });
    if (selectedStepId === stepId) setSelectedStepId(steps[0]?.id);
  };

  const persist = () => {
    if (!projectId || !draft) return;
    if (!draft.name.trim()) return onAction("请输入场景名称");
    if (draft.steps.length === 0) return onAction("请至少添加一个场景步骤");
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
    for (const dataset of draft.datasets) {
      try {
        JSON.parse(dataset.variablesText || "{}");
      } catch {
        setTab("data");
        return onAction(`数据集“${dataset.name}”变量不是合法 JSON`);
      }
    }
    const saved = saveScenario(projectId, { ...draft, name: draft.name.trim(), description: draft.description.trim() });
    reload();
    setDraft(saved);
    onAction(`已保存场景 ${saved.name}`);
  };

  const copyCurrent = () => {
    if (!projectId || !draft || !scenarios.some((item) => item.id === draft.id)) return;
    const copied = duplicateScenario(projectId, draft);
    reload();
    selectScenario(copied);
    onAction(`已复制场景 ${draft.name}`);
  };

  const deleteCurrent = () => {
    if (!projectId || !draft || !scenarios.some((item) => item.id === draft.id) || !window.confirm(`确定删除场景“${draft.name}”吗？`)) return;
    deleteScenario(projectId, draft.id);
    reload();
    setDraft(undefined);
    setSelectedStepId(undefined);
    onAction(`已删除场景 ${draft.name}`);
  };

  const execute = () => {
    if (!projectId || !draft) return onAction("请先选择场景");
    if (draft.steps.length === 0) return onAction("场景没有可执行步骤");
    if (!draft.environmentId) return onAction("请选择执行环境");
    const saved = saveScenario(projectId, draft);
    const environment = environments.find((item) => item.id === saved.environmentId);
    const scenarioRuns = runScenario(projectId, saved, environment?.name);
    const latestRun = scenarioRuns[0];
    reload();
    setDraft({ ...saved, lastRunAt: latestRun?.startedAt });
    setTab("history");
    onAction(`场景 ${saved.name} 已运行 ${scenarioRuns.length} 组数据，${scenarioRuns.some((run) => run.status === "failed") ? "存在失败" : "全部通过"}`);
  };

  return (
    <section className="page page-scenarios">
      {!projectId && <div className="alert-banner"><Icon name="info" /><div><strong>请先选择项目</strong><p>场景组合按项目隔离，选择项目后可编排和运行场景。</p></div></div>}
      <div className="scenario-command-bar">
        <div className="tabs">
          <button className={tab === "design" ? "active" : ""} onClick={() => setTab("design")} type="button">流程设计</button>
          <button className={tab === "data" ? "active" : ""} onClick={() => setTab("data")} type="button">数据驱动</button>
          <button className={tab === "history" ? "active" : ""} onClick={() => setTab("history")} type="button">调试记录</button>
        </div>
        <div className="scenario-actions">
          <button className="btn" disabled={!draft || !scenarios.some((item) => item.id === draft.id)} onClick={copyCurrent} type="button"><Icon name="content_copy" />复制</button>
          <button className="btn danger" disabled={!draft || !scenarios.some((item) => item.id === draft.id)} onClick={deleteCurrent} type="button"><Icon name="delete" />删除</button>
          <button className="btn" disabled={!draft} onClick={persist} type="button"><Icon name="save" />保存场景</button>
          <button className="btn primary" disabled={!draft} onClick={execute} type="button"><Icon name="play_arrow" />运行场景</button>
        </div>
      </div>

      <div className="stats-grid compact-stats">
        {stats.map((stat) => <article className={`metric-card tone-${stat.tone}`} key={stat.label}><Icon name={stat.icon} /><div><p>{stat.label}</p><strong>{stat.value}</strong></div></article>)}
      </div>

      <div className="scenario-workspace">
        <aside className="scenario-sidebar">
          <div className="scenario-panel-head"><div><span className="eyebrow">Scenarios</span><h3>场景列表</h3></div><button className="icon-btn" disabled={!projectId} onClick={createScenario} title="新建场景" type="button"><Icon name="add" /></button></div>
          <label className="scenario-search"><Icon name="search" /><input onChange={(event) => setScenarioSearch(event.target.value)} placeholder="搜索场景" value={scenarioSearch} /></label>
          <div className="scenario-list">
            {filteredScenarios.map((scenario) => <button className={draft?.id === scenario.id ? "scenario-list-item active" : "scenario-list-item"} key={scenario.id} onClick={() => selectScenario(scenario)} type="button"><span><strong>{scenario.name}</strong><small>{scenario.steps.length} 步骤 · {scenario.datasets.length} 数据集</small></span><Icon name="chevron_right" /></button>)}
            {filteredScenarios.length === 0 && <div className="scenario-empty-mini"><Icon name="account_tree" /><span>{scenarios.length ? "没有匹配场景" : "暂无场景"}</span><button disabled={!projectId} onClick={createScenario} type="button">新建场景</button></div>}
          </div>

          {tab === "design" && <>
            <div className="scenario-divider" />
            <div className="scenario-panel-head"><div><span className="eyebrow">Assets</span><h3>步骤资产</h3></div></div>
            <label className="scenario-search"><Icon name="search" /><input onChange={(event) => setAssetSearch(event.target.value)} placeholder="搜索用例或组件" value={assetSearch} /></label>
            {assetError && <p className="scenario-inline-error">{assetError}</p>}
            <div className="scenario-asset-list">
              {assetLoading && <p className="scenario-muted">正在加载测试用例...</p>}
              {filteredAssets.map((asset, index) => <button disabled={!draft} key={`${asset.kind}-${asset.referenceId ?? index}`} onClick={() => addStep(asset)} type="button"><b className={`scenario-method ${asset.kind}`}>{asset.method}</b><span><strong>{asset.name}</strong><small>{asset.path}</small></span><Icon name="add_circle" /></button>)}
            </div>
          </>}
        </aside>

        <main className="scenario-canvas">
          {!draft ? <ScenarioWelcome hasProject={Boolean(projectId)} onCreate={createScenario} /> : <>
            <header className="scenario-title-editor">
              <div><span className="eyebrow">场景编排</span><input aria-label="场景名称" onChange={(event) => patchDraft({ name: event.target.value })} value={draft.name} /><textarea aria-label="场景说明" onChange={(event) => patchDraft({ description: event.target.value })} placeholder="说明业务流程、验证目标和使用范围" value={draft.description} /></div>
              <div className="scenario-title-meta"><span><Icon name="format_list_numbered" />{draft.steps.length} 个步骤</span><span><Icon name="database" />{draft.datasets.length} 个数据集</span><span><Icon name="history" />{formatDate(draft.lastRunAt)}</span></div>
            </header>
            {tab === "design" && <DesignTab draft={draft} moveStep={moveStep} onAddFirst={() => addStep(builtInAssets[1])} onRemove={removeStep} onSelect={setSelectedStepId} selectedStepId={selectedStepId} />}
            {tab === "data" && <DataTab draft={draft} onChange={(datasets) => patchDraft({ datasets })} />}
            {tab === "history" && <HistoryTab onClear={() => { if (projectId) { clearScenarioRuns(projectId, draft.id); reload(); } }} runs={runs.filter((run) => run.scenarioId === draft.id)} />}
          </>}
        </main>

        <aside className="scenario-inspector">
          {!draft ? <div className="scenario-empty-mini tall"><Icon name="tune" /><span>选择场景后配置属性</span></div> : selectedStep && tab === "design" ? <StepInspector onChange={patchStep} step={selectedStep} /> : <ScenarioInspector draft={draft} environments={environments} onChange={patchDraft} />}
        </aside>
      </div>
    </section>
  );
}

function ScenarioWelcome({ hasProject, onCreate }: { hasProject: boolean; onCreate: () => void }) {
  return <div className="scenario-welcome"><span><Icon name="account_tree" /></span><h2>组合可复用的业务测试场景</h2><p>从 HTTP 或 WebSocket 用例开始，加入条件与等待步骤，配置数据集后即可运行调试。</p><button className="btn primary" disabled={!hasProject} onClick={onCreate} type="button"><Icon name="add" />新建场景</button></div>;
}

function DesignTab({ draft, moveStep, onAddFirst, onRemove, onSelect, selectedStepId }: { draft: TestScenario; moveStep: (index: number, direction: -1 | 1) => void; onAddFirst: () => void; onRemove: (id: string) => void; onSelect: (id: string) => void; selectedStepId?: string }) {
  if (draft.steps.length === 0) return <div className="scenario-lane-empty"><Icon name="playlist_add" /><h3>添加第一个执行步骤</h3><p>从左侧资产库选择测试用例，或先加入等待组件开始编排。</p><button className="btn" onClick={onAddFirst} type="button"><Icon name="add" />添加等待步骤</button></div>;
  return <div className="scenario-step-lane">{draft.steps.map((step, index) => <div className="scenario-step-wrap" key={step.id}>
    {index > 0 && <span className="scenario-connector"><Icon name="arrow_downward" /></span>}
    <article className={selectedStepId === step.id ? "scenario-step-card active" : "scenario-step-card"} onClick={() => onSelect(step.id)}>
      <b className="scenario-step-index">{index + 1}</b><span className={`scenario-method ${step.kind}`}>{step.method}</span>
      <div><strong>{step.name}</strong><small>{step.path || "无附加说明"}</small></div>
      <span className="scenario-step-policy">{step.continueOnFailure ? "失败继续" : "失败停止"}</span>
      <div className="scenario-step-actions"><button disabled={index === 0} onClick={(event) => { event.stopPropagation(); moveStep(index, -1); }} title="上移" type="button"><Icon name="arrow_upward" /></button><button disabled={index === draft.steps.length - 1} onClick={(event) => { event.stopPropagation(); moveStep(index, 1); }} title="下移" type="button"><Icon name="arrow_downward" /></button><button className="danger" onClick={(event) => { event.stopPropagation(); onRemove(step.id); }} title="移除步骤" type="button"><Icon name="delete" /></button></div>
    </article>
  </div>)}</div>;
}

function StepInspector({ onChange, step }: { onChange: (patch: Partial<ScenarioStep>) => void; step: ScenarioStep }) {
  return <div className="scenario-inspector-content"><div className="scenario-panel-head"><div><span className="eyebrow">Step config</span><h3>步骤配置</h3></div><span className={`scenario-method ${step.kind}`}>{step.method}</span></div>
    <label className="scenario-field">步骤名称<input onChange={(event) => onChange({ name: event.target.value })} value={step.name} /></label>
    <label className="scenario-field">路径或说明<input onChange={(event) => onChange({ path: event.target.value })} value={step.path} /></label>
    <label className="scenario-field">步骤配置 JSON<textarea aria-label="步骤配置 JSON" onChange={(event) => onChange({ configText: event.target.value })} spellCheck={false} value={step.configText} /></label>
    <label className="scenario-check"><input checked={step.continueOnFailure} onChange={(event) => onChange({ continueOnFailure: event.target.checked })} type="checkbox" /><span><strong>失败后继续</strong><small>当前步骤失败时仍执行后续步骤</small></span></label>
    {step.referenceId !== undefined && <div className="scenario-reference"><Icon name="link" /><span><strong>引用测试用例</strong><small>{step.kind} · {String(step.referenceId)}</small></span></div>}
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

function DataTab({ draft, onChange }: { draft: TestScenario; onChange: (datasets: ScenarioDataset[]) => void }) {
  const patch = (id: string, value: Partial<ScenarioDataset>) => onChange(draft.datasets.map((item) => item.id === id ? { ...item, ...value } : item));
  return <div className="scenario-data-tab"><div className="panel-title"><div><h3>数据驱动</h3><p className="scenario-muted">每个启用数据集会作为一组场景运行变量</p></div><button className="btn" onClick={() => onChange([...draft.datasets, { id: scenarioUniqueId("DATA"), name: `数据集 ${draft.datasets.length + 1}`, enabled: true, variablesText: "{}" }])} type="button"><Icon name="add" />新增数据集</button></div>
    <div className="scenario-dataset-list">{draft.datasets.map((dataset, index) => <article className="scenario-dataset" key={dataset.id}><header><b>{index + 1}</b><input aria-label={`数据集 ${index + 1} 名称`} onChange={(event) => patch(dataset.id, { name: event.target.value })} value={dataset.name} /><label className="switch" title={dataset.enabled ? "停用数据集" : "启用数据集"}><input checked={dataset.enabled} onChange={(event) => patch(dataset.id, { enabled: event.target.checked })} type="checkbox" /><i /></label><button className="icon-btn" disabled={draft.datasets.length === 1} onClick={() => onChange(draft.datasets.filter((item) => item.id !== dataset.id))} title="删除数据集" type="button"><Icon name="delete" /></button></header><label>变量 JSON<textarea aria-label={`${dataset.name} 变量 JSON`} onChange={(event) => patch(dataset.id, { variablesText: event.target.value })} spellCheck={false} value={dataset.variablesText} /></label></article>)}</div>
  </div>;
}

function HistoryTab({ onClear, runs }: { onClear: () => void; runs: ScenarioRun[] }) {
  return <div className="scenario-history-tab"><div className="panel-title"><div><h3>调试记录</h3><p className="scenario-muted">展示当前场景的本地模拟运行结果</p></div><button className="btn" disabled={runs.length === 0} onClick={onClear} type="button">清空全部记录</button></div>
    {runs.length === 0 ? <div className="scenario-lane-empty"><Icon name="history" /><h3>暂无调试记录</h3><p>保存并运行场景后，步骤执行结果会显示在这里。</p></div> : <div className="scenario-run-list">{runs.map((run) => <article className="scenario-run-card" key={run.id}><header><div><span className={`status ${run.status === "passed" ? "status-通过" : "status-失败"}`}>{run.status}</span><strong>{run.environmentName ?? "未命名环境"} · {run.datasetName}</strong></div><small>{formatDate(run.startedAt)} · {(run.durationMs / 1000).toFixed(1)}s</small></header><div>{run.stepResults.map((result, index) => <span key={result.stepId}><b>{index + 1}</b><strong>{result.name}</strong><small>{result.message}</small><i className={result.status}>{result.status}</i></span>)}</div></article>)}</div>}
  </div>;
}
