import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  bindTestCaseEnvironment,
  createEnvironmentConfig,
  deleteEnvironmentConfig,
  deleteEnvironmentVariable,
  getEnvironmentConfig,
  listEnvironmentBoundTestCases,
  listEnvironmentConfigs,
  upsertEnvironmentVariable,
  updateEnvironmentConfig,
  type BackendBoundTestCase,
  type BackendEnvironmentConfig,
  type BackendEnvironmentVariable,
} from "../api/environmentConfigs";
import { Icon } from "../components/Icon";
import type { ActionHandler } from "../types";

interface EnvironmentView {
  id: number;
  name: string;
  baseUrl: string;
  description: string;
  isDefault: boolean;
  owner: string;
  updatedAt: string;
  variableCount: number;
  testCaseCount: number;
  variables: VariableView[];
}

interface VariableView {
  id: number;
  name: string;
  value: string;
  isSecret: boolean;
  updatedAt: string;
}

interface BoundCaseView {
  id: number;
  name: string;
  method: string;
  path: string;
  status: string;
  updatedAt: string;
}

function toNumber(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value === "string" && Number.isFinite(Number(value))) return Number(value);
  return 0;
}

function formatDate(raw: unknown) {
  if (typeof raw !== "string" || !raw) return "-";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function mapVariable(source: BackendEnvironmentVariable): VariableView {
  return {
    id: toNumber(source.id),
    name: source.name ?? "未命名变量",
    value: source.value ?? "",
    isSecret: source.is_secret === true,
    updatedAt: formatDate(source.updated_at ?? source.created_at),
  };
}

function mapEnvironment(source: BackendEnvironmentConfig): EnvironmentView {
  const variables = Array.isArray(source.variables) ? source.variables.map(mapVariable).filter((item) => item.id > 0) : [];
  return {
    id: toNumber(source.id ?? source.environment_id),
    name: source.name ?? "未命名环境",
    baseUrl: source.base_url ?? "",
    description: source.description ?? "",
    isDefault: source.is_default === true,
    owner: source.created_by?.username ?? source.created_by?.account ?? String(source.created_by_id ?? "当前用户"),
    updatedAt: formatDate(source.updated_at ?? source.created_at),
    variableCount: variables.length,
    testCaseCount: typeof source.test_case_count === "number" ? source.test_case_count : 0,
    variables,
  };
}

function mapBoundCase(source: BackendBoundTestCase): BoundCaseView {
  return {
    id: toNumber(source.id ?? source.test_case_id),
    name: source.name ?? source.title ?? "未命名用例",
    method: source.method ?? "GET",
    path: source.path ?? "",
    status: source.last_execution_status ?? "-",
    updatedAt: formatDate(source.last_executed_at ?? source.updated_at),
  };
}

export function EnvironmentConfigsPage({
  onAction,
  onEnvironmentChanged,
  projectId,
}: {
  onAction: ActionHandler;
  onEnvironmentChanged?: (environmentId?: number) => void;
  projectId?: number;
}) {
  const [environments, setEnvironments] = useState<EnvironmentView[]>([]);
  const [activeEnvironmentId, setActiveEnvironmentId] = useState<number | undefined>();
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [editorMode, setEditorMode] = useState<"create" | "edit" | null>(null);
  const [envForm, setEnvForm] = useState({ name: "", baseUrl: "", description: "", isDefault: false });
  const [envFormErrors, setEnvFormErrors] = useState<{ name?: string; baseUrl?: string }>({});
  const [variableForm, setVariableForm] = useState({ name: "", value: "", isSecret: false });
  const [editingVariableId, setEditingVariableId] = useState<number>();
  const [isSavingVariable, setIsSavingVariable] = useState(false);
  const [deletingVariableId, setDeletingVariableId] = useState<number>();
  const [boundCases, setBoundCases] = useState<BoundCaseView[]>([]);
  const [boundCasesLoading, setBoundCasesLoading] = useState(false);
  const [boundCasesError, setBoundCasesError] = useState("");
  const [revealedSecrets, setRevealedSecrets] = useState<Record<number, boolean>>({});
  const activeEnvironment = useMemo(
    () => environments.find((environment) => environment.id === activeEnvironmentId),
    [activeEnvironmentId, environments],
  );

  const loadEnvironments = useCallback(async (preferredId?: number) => {
    if (!projectId) {
      setEnvironments([]);
      setActiveEnvironmentId(undefined);
      setLoadError("请先选择项目，再维护环境配置。");
      return;
    }

    setIsLoading(true);
    setLoadError("");
    try {
      const result = await listEnvironmentConfigs(projectId);
      const nextEnvironments = result.map(mapEnvironment).filter((environment) => environment.id > 0);
      setEnvironments(nextEnvironments);
      setActiveEnvironmentId((current) => {
        if (preferredId && nextEnvironments.some((environment) => environment.id === preferredId)) return preferredId;
        if (current && nextEnvironments.some((environment) => environment.id === current)) return current;
        return nextEnvironments.find((environment) => environment.isDefault)?.id ?? nextEnvironments[0]?.id;
      });
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "环境配置加载失败");
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void loadEnvironments();
  }, [loadEnvironments]);

  useEffect(() => {
    if (!activeEnvironment) {
      setEnvForm({ name: "", baseUrl: "", description: "", isDefault: false });
      setBoundCases([]);
      return;
    }

    setEnvForm({
      name: activeEnvironment.name,
      baseUrl: activeEnvironment.baseUrl,
      description: activeEnvironment.description,
      isDefault: activeEnvironment.isDefault,
    });
  }, [activeEnvironment]);

  useEffect(() => {
    const loadDetail = async () => {
      if (!projectId || !activeEnvironmentId) return;
      setBoundCasesLoading(true);
      setBoundCasesError("");
      try {
        const [detail, cases] = await Promise.all([
          getEnvironmentConfig(projectId, activeEnvironmentId),
          listEnvironmentBoundTestCases(projectId, activeEnvironmentId),
        ]);
        const mappedEnvironment = mapEnvironment(detail);
        setEnvironments((current) =>
          current.map((environment) => (environment.id === mappedEnvironment.id ? mappedEnvironment : environment)),
        );
        setBoundCases(cases.map(mapBoundCase).filter((item) => item.id > 0));
      } catch (error) {
        setBoundCasesError(error instanceof Error ? error.message : "环境详情加载失败");
      } finally {
        setBoundCasesLoading(false);
      }
    };

    void loadDetail();
  }, [activeEnvironmentId, projectId]);

  const startCreate = () => {
    setEnvForm({ name: "", baseUrl: "", description: "", isDefault: environments.length === 0 });
    setEnvFormErrors({});
    setEditorMode("create");
  };

  const selectEnvironment = (environment: EnvironmentView) => {
    setActiveEnvironmentId(environment.id);
    setVariableForm({ name: "", value: "", isSecret: false });
    setEditingVariableId(undefined);
    setRevealedSecrets({});
  };

  const editVariable = (variable: VariableView) => {
    setEditingVariableId(variable.id);
    setVariableForm({ name: variable.name, value: variable.value, isSecret: variable.isSecret });
  };

  const resetVariableForm = () => {
    setEditingVariableId(undefined);
    setVariableForm({ name: "", value: "", isSecret: false });
  };

  const startEdit = (environment: EnvironmentView) => {
    setActiveEnvironmentId(environment.id);
    setEnvForm({
      name: environment.name,
      baseUrl: environment.baseUrl,
      description: environment.description,
      isDefault: environment.isDefault,
    });
    setEnvFormErrors({});
    setEditorMode("edit");
  };

  const saveEnvironment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!projectId) {
      onAction("请先选择项目");
      return;
    }
    const nextErrors = {
      name: envForm.name.trim() ? undefined : "请填写环境名称",
      baseUrl: envForm.baseUrl.trim() ? undefined : "请填写基础地址",
    };
    setEnvFormErrors(nextErrors);
    if (nextErrors.name || nextErrors.baseUrl) {
      onAction("环境名称和基础地址必填");
      return;
    }

    setIsSaving(true);
    try {
      const payload = {
        name: envForm.name.trim(),
        base_url: envForm.baseUrl.trim(),
        description: envForm.description.trim() || null,
        is_default: envForm.isDefault,
      };
      const saved = editorMode === "edit" && activeEnvironment
        ? await updateEnvironmentConfig(projectId, activeEnvironment.id, payload)
        : await createEnvironmentConfig(projectId, payload);
      const mapped = mapEnvironment(saved);
      onAction(`${activeEnvironment ? "保存" : "新建"}环境 ${mapped.name}`);
      onEnvironmentChanged?.(mapped.id);
      await loadEnvironments(mapped.id);
      setEditorMode(null);
    } catch (error) {
      onAction(error instanceof Error ? error.message : "环境保存失败");
    } finally {
      setIsSaving(false);
    }
  };

  const removeEnvironment = async () => {
    if (!projectId || !activeEnvironment) return;
    if (!window.confirm(`确认删除环境 ${activeEnvironment.name}？`)) return;

    try {
      await deleteEnvironmentConfig(projectId, activeEnvironment.id);
      onAction(`删除环境 ${activeEnvironment.name}`);
      onEnvironmentChanged?.();
      await loadEnvironments();
    } catch (error) {
      onAction(error instanceof Error ? error.message : "环境删除失败");
    }
  };

  const removeEnvironmentByCard = async (environment: EnvironmentView) => {
    setActiveEnvironmentId(environment.id);
    if (!projectId) return;
    if (!window.confirm(`确认删除环境 ${environment.name}？`)) return;

    try {
      await deleteEnvironmentConfig(projectId, environment.id);
      onAction(`删除环境 ${environment.name}`);
      onEnvironmentChanged?.();
      await loadEnvironments();
    } catch (error) {
      onAction(error instanceof Error ? error.message : "环境删除失败");
    }
  };

  const saveVariable = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!projectId || !activeEnvironment) {
      onAction("请先选择环境");
      return;
    }
    if (!variableForm.name.trim()) {
      onAction("变量名必填");
      return;
    }

    setIsSavingVariable(true);
    try {
      const saved = await upsertEnvironmentVariable(projectId, activeEnvironment.id, {
        name: variableForm.name.trim(),
        value: variableForm.value,
        is_secret: variableForm.isSecret,
      });
      const mappedVariable = mapVariable(saved);
      setEnvironments((current) => current.map((environment) => {
        if (environment.id !== activeEnvironment.id) return environment;
        const existingIndex = environment.variables.findIndex(
          (item) => item.id === mappedVariable.id || item.name === mappedVariable.name,
        );
        const variables = [...environment.variables];
        if (existingIndex >= 0) variables[existingIndex] = mappedVariable;
        else variables.push(mappedVariable);
        return { ...environment, variableCount: variables.length, variables };
      }));
      onAction(`${editingVariableId ? "更新" : "保存"}变量 ${variableForm.name}`);
      resetVariableForm();
    } catch (error) {
      onAction(error instanceof Error ? error.message : "变量保存失败");
    } finally {
      setIsSavingVariable(false);
    }
  };

  const removeVariable = async (variable: VariableView) => {
    if (!projectId || !activeEnvironment) return;
    setDeletingVariableId(variable.id);
    try {
      await deleteEnvironmentVariable(projectId, activeEnvironment.id, variable.id);
      setEnvironments((current) => current.map((environment) => {
        if (environment.id !== activeEnvironment.id) return environment;
        const variables = environment.variables.filter((item) => item.id !== variable.id);
        return { ...environment, variableCount: variables.length, variables };
      }));
      if (editingVariableId === variable.id) resetVariableForm();
      onAction(`删除变量 ${variable.name}`);
    } catch (error) {
      onAction(error instanceof Error ? error.message : "变量删除失败");
    } finally {
      setDeletingVariableId(undefined);
    }
  };

  const unbindCase = async (testCase: BoundCaseView) => {
    if (!projectId || !activeEnvironment) return;
    try {
      await bindTestCaseEnvironment(projectId, testCase.id, null);
      setBoundCases((current) => current.filter((item) => item.id !== testCase.id));
      onAction(`解绑用例 ${testCase.name}`);
      await loadEnvironments(activeEnvironment.id);
    } catch (error) {
      onAction(error instanceof Error ? error.message : "用例解绑失败");
    }
  };

  return (
    <section className="page environments-page">
      <div className="environment-grid">
        <aside className="environment-list-panel">
          <div className="environment-panel-head">
            <div>
              <h2>环境配置</h2>
              <p>按项目维护 Base URL、变量和默认环境。</p>
            </div>
            <button className="icon-btn" onClick={() => void loadEnvironments()} title="刷新环境" type="button">
              <Icon name="refresh" />
            </button>
          </div>
          <button className="btn primary environment-create-btn" disabled={!projectId} onClick={startCreate} type="button">
            <Icon name="add" />
            新建环境
          </button>

          {isLoading && <EnvironmentState icon="progress_activity" title="正在加载环境" text="正在读取当前项目下的环境配置。" />}
          {!isLoading && loadError && <EnvironmentState icon="error" title="环境加载失败" text={loadError} />}
          {!isLoading && !loadError && environments.length === 0 && (
            <EnvironmentState icon="settings_input_component" title="暂无环境配置" text="新建环境后，可维护变量并绑定到接口测试用例。" />
          )}

          <div className="environment-list">
            {environments.map((environment) => (
              <button
                className={environment.id === activeEnvironment?.id ? "environment-item active" : "environment-item"}
                key={environment.id}
                onClick={() => selectEnvironment(environment)}
                type="button"
              >
                <span className="environment-icon"><Icon name={environment.isDefault ? "star" : "dns"} /></span>
                <span>
                  <strong>{environment.name}</strong>
                  <small>{environment.baseUrl || "未配置基础地址"}</small>
                </span>
                {environment.isDefault && <b>默认</b>}
              </button>
            ))}
          </div>
        </aside>

        <section className="environment-detail-panel">
          <div className="environment-summary">
            <MetricTile icon="dns" label="环境数" value={String(environments.length)} />
            <MetricTile icon="key" label="变量数" value={String(activeEnvironment?.variableCount ?? 0)} />
            <MetricTile icon="api" label="绑定用例" value={String(activeEnvironment?.testCaseCount ?? 0)} />
          </div>

          <div className="environment-card-grid">
            {environments.map((environment) => (
              <button
                className={environment.id === activeEnvironment?.id ? "environment-config-card active" : "environment-config-card"}
                key={environment.id}
                onClick={() => selectEnvironment(environment)}
                type="button"
              >
                <div className="environment-config-card-head">
                  <span className="environment-icon"><Icon name={environment.isDefault ? "star" : "dns"} /></span>
                  <span className="environment-config-card-head-actions">
                    {environment.isDefault && <b>默认</b>}
                    <span className="environment-card-actions">
                      <span
                        className="icon-btn"
                        onClick={(event) => {
                          event.stopPropagation();
                          startEdit(environment);
                        }}
                        title="编辑环境"
                      >
                        <Icon name="edit" />
                      </span>
                      <span
                        className="icon-btn danger"
                        onClick={(event) => {
                          event.stopPropagation();
                          void removeEnvironmentByCard(environment);
                        }}
                        title="删除环境"
                      >
                        <Icon name="delete" />
                      </span>
                    </span>
                  </span>
                </div>
                <strong>{environment.name}</strong>
                <code>{environment.baseUrl || "未配置基础地址"}</code>
                <p>{environment.description || "暂无环境说明"}</p>
                <div className="environment-config-card-meta">
                  <span><Icon name="key" />{environment.variableCount} 变量</span>
                  <span><Icon name="api" />{environment.testCaseCount} 用例</span>
                  <span><Icon name="schedule" />{environment.updatedAt}</span>
                </div>
              </button>
            ))}
            {!isLoading && !loadError && environments.length === 0 && (
              <div className="environment-config-card empty-card">
                <Icon name="settings_input_component" />
                <strong>暂无环境配置</strong>
                <p>新建环境后，可在这里以卡片方式查看 Base URL、变量数和绑定用例数。</p>
              </div>
            )}
          </div>

          {activeEnvironment ? (
            <div className="environment-detail-card">
              <div className="environment-detail-head">
                <div>
                  <span className="eyebrow">当前环境</span>
                  <h3>{activeEnvironment.name}</h3>
                </div>
                <div className="environment-detail-actions">
                  {activeEnvironment.isDefault && <span className="default-badge">默认环境</span>}
                  <button className="btn primary" onClick={() => startEdit(activeEnvironment)} type="button">
                    <Icon name="edit" />
                    编辑环境
                  </button>
                </div>
              </div>
              <div className="environment-info-grid">
                <div>
                  <span>基础地址</span>
                  <strong>{activeEnvironment.baseUrl || "未配置"}</strong>
                </div>
                <div>
                  <span>维护人</span>
                  <strong>{activeEnvironment.owner}</strong>
                </div>
                <div>
                  <span>更新时间</span>
                  <strong>{activeEnvironment.updatedAt}</strong>
                </div>
                <div className="environment-description-card">
                  <span>环境说明</span>
                  <p>{activeEnvironment.description || "暂无说明"}</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="environment-detail-card empty-detail-card">
              <Icon name="settings_input_component" />
              <strong>请选择或新建环境</strong>
              <p>点击左侧环境可查看变量和绑定用例，需要调整环境信息时再点击编辑环境。</p>
              <button className="btn primary" disabled={!projectId} onClick={startCreate} type="button">
                <Icon name="add" />
                新建环境
              </button>
            </div>
          )}

          <form className="environment-form" onSubmit={saveEnvironment}>
            <div className="environment-form-head">
              <div>
                <span className="eyebrow">{activeEnvironment ? "编辑环境" : "新建环境"}</span>
                <h3>{activeEnvironment?.name ?? "创建项目环境"}</h3>
              </div>
              <button className="state-toggle enabled" onClick={() => setEnvForm((current) => ({ ...current, isDefault: !current.isDefault }))} type="button">
                {envForm.isDefault ? "默认环境" : "设为默认"}
              </button>
            </div>
            <div className="environment-form-grid">
              <label>
                <span>环境名称</span>
                <input onChange={(event) => setEnvForm((current) => ({ ...current, name: event.target.value }))} placeholder="例如 uat、pre-prod、prod" value={envForm.name} />
              </label>
              <label>
                <span>基础地址</span>
                <input onChange={(event) => setEnvForm((current) => ({ ...current, baseUrl: event.target.value }))} placeholder="https://uat.example.com" value={envForm.baseUrl} />
              </label>
              <label className="environment-description-field">
                <span>环境说明</span>
                <textarea onChange={(event) => setEnvForm((current) => ({ ...current, description: event.target.value }))} placeholder="补充环境用途、网络说明或维护注意事项" value={envForm.description} />
              </label>
            </div>
            <div className="environment-actions">
              {activeEnvironment && (
                <button className="btn danger" onClick={removeEnvironment} type="button">
                  <Icon name="delete" />
                  删除环境
                </button>
              )}
              <button className="btn primary" disabled={isSaving || !projectId} type="submit">
                <Icon name="save" />
                {isSaving ? "保存中..." : "保存环境"}
              </button>
            </div>
          </form>
        </section>

        <aside className="environment-side-panel">
          <section className="environment-section">
            <div className="environment-section-head">
              <div>
                <h3>环境变量</h3>
                <small>在测试用例中通过 {"{{变量名}}"} 引用</small>
              </div>
              <span>{activeEnvironment?.variableCount ?? 0} 个</span>
            </div>
            <form className="variable-form" onSubmit={saveVariable}>
              <div className="variable-form-title">
                <div>
                  <strong>{editingVariableId ? "编辑变量" : "新增变量"}</strong>
                  <small>{editingVariableId ? "变量名不可修改，可更新变量值与敏感属性" : "变量值会按当前环境隔离保存"}</small>
                </div>
                {editingVariableId && <button className="text-btn" onClick={resetVariableForm} type="button">取消编辑</button>}
              </div>
              <label>
                <span>变量名</span>
                <input
                  disabled={Boolean(editingVariableId)}
                  onChange={(event) => setVariableForm((current) => ({ ...current, name: event.target.value }))}
                  placeholder="例如 access_token"
                  value={variableForm.name}
                />
              </label>
              <label>
                <span>变量值</span>
                <input
                  onChange={(event) => setVariableForm((current) => ({ ...current, value: event.target.value }))}
                  placeholder="请输入变量值"
                  type={variableForm.isSecret ? "password" : "text"}
                  value={variableForm.value}
                />
              </label>
              <div className="variable-form-actions">
                <label className="secret-check">
                  <input checked={variableForm.isSecret} onChange={(event) => setVariableForm((current) => ({ ...current, isSecret: event.target.checked }))} type="checkbox" />
                  作为敏感变量保存
                </label>
                <button className="btn primary" disabled={!activeEnvironment || isSavingVariable} type="submit">
                  <Icon name={isSavingVariable ? "progress_activity" : editingVariableId ? "save" : "add"} />
                  {isSavingVariable ? "保存中..." : editingVariableId ? "保存修改" : "保存变量"}
                </button>
              </div>
            </form>
            <div className="variable-list">
              {(activeEnvironment?.variables ?? []).map((variable) => (
                <div className="variable-row" key={variable.id}>
                  <div className="variable-row-main">
                    <div className="variable-row-title">
                      <strong>{variable.name}</strong>
                      <span className={variable.isSecret ? "variable-type secret" : "variable-type"}>
                        <Icon name={variable.isSecret ? "lock" : "data_object"} />
                        {variable.isSecret ? "敏感" : "普通"}
                      </span>
                    </div>
                    <code>{variable.isSecret && !revealedSecrets[variable.id] ? "••••••••••••" : variable.value || "空值"}</code>
                    <small>更新于 {variable.updatedAt}</small>
                  </div>
                  <div className="variable-row-actions">
                    {variable.isSecret && (
                      <button className="icon-btn" onClick={() => setRevealedSecrets((current) => ({ ...current, [variable.id]: !current[variable.id] }))} title={revealedSecrets[variable.id] ? "隐藏变量值" : "显示变量值"} type="button">
                        <Icon name={revealedSecrets[variable.id] ? "visibility_off" : "visibility"} />
                      </button>
                    )}
                    <button className="icon-btn" onClick={() => editVariable(variable)} title="编辑变量" type="button">
                      <Icon name="edit" />
                    </button>
                    <button
                      className="icon-btn delete-row-btn"
                      disabled={deletingVariableId === variable.id}
                      onClick={() => void removeVariable(variable)}
                      title="删除变量"
                      type="button"
                    >
                      <Icon name={deletingVariableId === variable.id ? "progress_activity" : "delete"} />
                    </button>
                  </div>
                </div>
              ))}
              {activeEnvironment && activeEnvironment.variables.length === 0 && (
                <div className="variable-empty-state">
                  <Icon name="key" />
                  <strong>暂无环境变量</strong>
                  <p>可新增 token、user_id、base_path 等变量，在测试用例中复用。</p>
                </div>
              )}
              {!activeEnvironment && (
                <div className="variable-empty-state">
                  <Icon name="cloud_off" />
                  <strong>请先选择环境</strong>
                  <p>选择或新建环境后即可维护独立变量。</p>
                </div>
              )}
            </div>
          </section>

          <section className="environment-section">
            <div className="environment-section-head">
              <h3>绑定用例</h3>
              <span>{boundCases.length} 条</span>
            </div>
            {boundCasesLoading && <p className="empty-copy">正在加载绑定用例...</p>}
            {!boundCasesLoading && boundCasesError && <p className="field-error">{boundCasesError}</p>}
            {!boundCasesLoading && !boundCasesError && boundCases.length === 0 && <p className="empty-copy">当前环境还没有绑定接口测试用例。</p>}
            <div className="bound-case-list">
              {boundCases.map((testCase) => (
                <div className="bound-case-row" key={testCase.id}>
                  <span className={`method method-${testCase.method}`}>{testCase.method}</span>
                  <div>
                    <strong>{testCase.name}</strong>
                    <small>{testCase.path || "未配置路径"}</small>
                  </div>
                  <button className="icon-btn" onClick={() => void unbindCase(testCase)} title="解绑用例" type="button">
                    <Icon name="link_off" />
                  </button>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </div>
      {editorMode && (
        <div className="modal-backdrop" role="presentation">
          <section aria-modal="true" className="environment-editor-modal" role="dialog">
            <div className="modal-head">
              <div>
                <span className="eyebrow">{editorMode === "create" ? "新增环境配置" : "编辑环境配置"}</span>
                <h3>{editorMode === "create" ? "新建环境" : envForm.name || "编辑环境"}</h3>
              </div>
              <button className="icon-btn" onClick={() => setEditorMode(null)} title="关闭" type="button">
                <Icon name="close" />
              </button>
            </div>
            <form className="environment-form modal-environment-form" onSubmit={saveEnvironment}>
              <div className="environment-form-head">
                <div>
                  <span className="eyebrow">环境信息</span>
                  <h3>{envForm.name || "环境配置"}</h3>
                </div>
                <button className="state-toggle enabled" onClick={() => setEnvForm((current) => ({ ...current, isDefault: !current.isDefault }))} type="button">
                  {envForm.isDefault ? "默认环境" : "设为默认"}
                </button>
              </div>
              <div className="environment-form-grid">
                <label>
                  <span>环境名称</span>
                  <input onChange={(event) => setEnvForm((current) => ({ ...current, name: event.target.value }))} placeholder="例如 uat、pre-prod、prod" value={envForm.name} />
                </label>
                <label>
                  <span>基础地址</span>
                  <input onChange={(event) => setEnvForm((current) => ({ ...current, baseUrl: event.target.value }))} placeholder="https://uat.example.com" value={envForm.baseUrl} />
                </label>
                <label className="environment-description-field">
                  <span>环境说明</span>
                  <textarea onChange={(event) => setEnvForm((current) => ({ ...current, description: event.target.value }))} placeholder="补充环境用途、网络说明或维护注意事项" value={envForm.description} />
                </label>
              </div>
              <div className="environment-actions">
                {editorMode === "edit" && activeEnvironment && (
                  <button className="btn danger" onClick={removeEnvironment} type="button">
                    <Icon name="delete" />
                    删除环境
                  </button>
                )}
                <button className="btn" onClick={() => setEditorMode(null)} type="button">取消</button>
                <button className="btn primary" disabled={isSaving || !projectId} type="submit">
                  <Icon name="save" />
                  {isSaving ? "保存中..." : "保存环境"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </section>
  );
}

function EnvironmentState({ icon, text, title }: { icon: string; text: string; title: string }) {
  return (
    <div className="side-empty">
      <Icon name={icon} />
      <strong>{title}</strong>
      <p>{text}</p>
    </div>
  );
}

function MetricTile({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div className="environment-metric">
      <Icon name={icon} />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
