import { type ClipboardEvent, type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  deleteDefect,
  listDefects,
  saveDefect,
  transitionDefect,
  type Defect,
  type DefectInput,
  type DefectStatus,
  type DefectType,
  type DefectUrgency,
} from "../api/defects";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Icon } from "../components/Icon";
import { Pagination, usePagination } from "../components/Pagination";
import type { ActionHandler } from "../types";

type DefectEditorMode = "create" | "edit";
type DefectForm = {
  id: string;
  title: string;
  assignee: string;
  type: DefectType;
  urgency: DefectUrgency;
  status: DefectStatus;
  contentHtml: string;
};

const statuses: Array<{ value: DefectStatus; label: string; icon: string }> = [
  { value: "new", label: "新创建", icon: "fiber_new" },
  { value: "active", label: "已激活", icon: "bolt" },
  { value: "confirmed", label: "已确认", icon: "task_alt" },
  { value: "fixed", label: "已修复", icon: "build_circle" },
  { value: "verified", label: "已验证", icon: "verified" },
  { value: "closed", label: "已关闭", icon: "lock" },
  { value: "reopened", label: "重新激活", icon: "restart_alt" },
];

const typeOptions: Array<{ value: DefectType; label: string }> = [
  { value: "functional", label: "功能缺陷" },
  { value: "ui", label: "界面问题" },
  { value: "performance", label: "性能问题" },
  { value: "security", label: "安全问题" },
  { value: "compatibility", label: "兼容问题" },
  { value: "data", label: "数据问题" },
  { value: "other", label: "其他" },
];

const urgencyOptions: Array<{ value: DefectUrgency; label: string }> = [
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
  { value: "critical", label: "紧急" },
];

const transitions: Record<DefectStatus, DefectStatus[]> = {
  new: ["active", "confirmed", "closed"],
  active: ["confirmed", "fixed", "closed"],
  confirmed: ["fixed", "closed"],
  fixed: ["verified", "reopened"],
  verified: ["closed", "reopened"],
  closed: ["reopened"],
  reopened: ["active", "confirmed", "fixed"],
};

const emptyForm = (): DefectForm => ({
  id: "",
  title: "",
  assignee: "",
  type: "functional",
  urgency: "medium",
  status: "new",
  contentHtml: "",
});

function statusLabel(status: DefectStatus) {
  return statuses.find((item) => item.value === status)?.label ?? status;
}

function typeLabel(type: DefectType) {
  return typeOptions.find((item) => item.value === type)?.label ?? type;
}

function urgencyLabel(urgency: DefectUrgency) {
  return urgencyOptions.find((item) => item.value === urgency)?.label ?? urgency;
}

function formatDate(value?: string) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function stripRichText(html: string) {
  const element = document.createElement("div");
  element.innerHTML = html;
  return element.textContent?.trim() ?? "";
}

function sanitizeRichText(html: string) {
  const template = document.createElement("template");
  template.innerHTML = html;
  template.content.querySelectorAll("script,style,iframe,object,embed").forEach((node) => node.remove());
  template.content.querySelectorAll("*").forEach((node) => {
    Array.from(node.attributes).forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim().toLowerCase();
      if (name.startsWith("on") || ((name === "href" || name === "src") && value.startsWith("javascript:"))) {
        node.removeAttribute(attribute.name);
      }
    });
  });
  return template.innerHTML;
}

function formFromDefect(defect: Defect): DefectForm {
  return {
    id: defect.id,
    title: defect.title,
    assignee: defect.assignee,
    type: defect.type,
    urgency: defect.urgency,
    status: defect.status,
    contentHtml: defect.contentHtml,
  };
}

export function DefectsPage({ onAction, projectId }: { onAction: ActionHandler; projectId?: number }) {
  const [defects, setDefects] = useState<Defect[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<DefectStatus | "all">("all");
  const [urgencyFilter, setUrgencyFilter] = useState<DefectUrgency | "all">("all");
  const [editorMode, setEditorMode] = useState<DefectEditorMode | null>(null);
  const [form, setForm] = useState<DefectForm>(() => emptyForm());
  const [formMessage, setFormMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Defect>();
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [transitioningId, setTransitioningId] = useState("");

  const reloadData = useCallback(async () => {
    if (!projectId) {
      setDefects([]);
      setLoadError("");
      return;
    }
    setIsLoading(true);
    setLoadError("");
    try {
      setDefects(await listDefects(projectId));
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "缺陷列表加载失败");
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void reloadData();
    setEditorMode(null);
  }, [reloadData]);

  const filteredDefects = useMemo(() => {
    const query = search.trim().toLowerCase();
    return defects.filter((defect) => {
      if (statusFilter !== "all" && defect.status !== statusFilter) return false;
      if (urgencyFilter !== "all" && defect.urgency !== urgencyFilter) return false;
      return !query || `${defect.title} ${defect.assignee} ${defect.reporter} ${stripRichText(defect.contentHtml)}`.toLowerCase().includes(query);
    });
  }, [defects, search, statusFilter, urgencyFilter]);
  const pagination = usePagination(filteredDefects, 10, `${projectId ?? "none"}:${search}:${statusFilter}:${urgencyFilter}`);

  const stats = useMemo(() => [
    { label: "缺陷总数", value: defects.length, icon: "bug_report", tone: "blue" },
    { label: "待处理", value: defects.filter((item) => ["new", "active", "confirmed", "reopened"].includes(item.status)).length, icon: "pending_actions", tone: "orange" },
    { label: "已修复", value: defects.filter((item) => ["fixed", "verified"].includes(item.status)).length, icon: "build_circle", tone: "green" },
    { label: "紧急", value: defects.filter((item) => item.urgency === "critical").length, icon: "priority_high", tone: "red" },
  ], [defects]);

  const startCreate = () => {
    if (!projectId) {
      onAction("请先选择项目");
      return;
    }
    setForm(emptyForm());
    setFormMessage("");
    setEditorMode("create");
  };

  const startEdit = (defect: Defect) => {
    setForm(formFromDefect(defect));
    setFormMessage("");
    setEditorMode("edit");
  };

  const submitDefect = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!projectId) return setFormMessage("请先选择项目");
    if (!form.title.trim()) return setFormMessage("请输入 Bug 标题");
    if (!stripRichText(form.contentHtml) && !form.contentHtml.includes("<img")) return setFormMessage("请输入 Bug 内容");

    setIsSaving(true);
    try {
      const input: DefectInput = {
        id: form.id,
        title: form.title.trim(),
        assignee: form.assignee.trim(),
        type: form.type,
        urgency: form.urgency,
        status: form.status,
        contentHtml: sanitizeRichText(form.contentHtml),
      };
      const saved = await saveDefect(projectId, input);
      await reloadData();
      setEditorMode(null);
      onAction(`${editorMode === "create" ? "新建" : "保存"}缺陷 ${saved.title}`);
    } catch (error) {
      setFormMessage(error instanceof Error ? error.message : "缺陷保存失败");
    } finally {
      setIsSaving(false);
    }
  };

  const changeStatus = async (defect: Defect, status: DefectStatus) => {
    if (!projectId) return;
    setTransitioningId(defect.id);
    try {
      await transitionDefect(projectId, defect.id, status);
      await reloadData();
      onAction(`${defect.title} 已流转为${statusLabel(status)}`);
    } catch (error) {
      onAction(error instanceof Error ? error.message : "缺陷状态流转失败");
    } finally {
      setTransitioningId("");
    }
  };

  const removeDefect = async () => {
    if (!projectId || !pendingDelete) return;
    setDeleteBusy(true);
    try {
      await deleteDefect(projectId, pendingDelete.id);
      await reloadData();
      onAction(`删除缺陷 ${pendingDelete.title}`);
    } catch (error) {
      onAction(error instanceof Error ? error.message : "缺陷删除失败");
    } finally {
      setDeleteBusy(false);
      setPendingDelete(undefined);
    }
  };

  return (
    <section className="page defects-page">
      <div className="page-toolbar">
        <div className="tabs defects-flow-tabs" aria-label="缺陷流程">
          {statuses.map((status) => (
            <button className={statusFilter === status.value ? "active" : ""} key={status.value} onClick={() => setStatusFilter(statusFilter === status.value ? "all" : status.value)} type="button">
              <Icon name={status.icon} />
              {status.label}
            </button>
          ))}
        </div>
        <button className="btn primary" disabled={!projectId} onClick={startCreate} type="button">
          <Icon name="add" />
          新建缺陷
        </button>
      </div>

      {!projectId && <div className="alert-banner"><Icon name="info" /><div><strong>请先选择项目</strong><p>缺陷按项目隔离，选择项目后可记录和推进 Bug。</p></div></div>}

      <div className="stats-grid compact-stats">
        {stats.map((stat) => (
          <article className={`metric-card tone-${stat.tone}`} key={stat.label}>
            <Icon name={stat.icon} />
            <div><p>{stat.label}</p><strong>{stat.value}</strong></div>
          </article>
        ))}
      </div>

      <div className="filter-bar defect-filter-bar">
        <label className="inline-field"><Icon name="search" /><input onChange={(event) => setSearch(event.target.value)} placeholder="搜索标题、指派人、报告人或内容" value={search} /></label>
        <select aria-label="缺陷状态" onChange={(event) => setStatusFilter(event.target.value as DefectStatus | "all")} value={statusFilter}>
          <option value="all">全部状态</option>
          {statuses.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}
        </select>
        <select aria-label="紧急程度" onChange={(event) => setUrgencyFilter(event.target.value as DefectUrgency | "all")} value={urgencyFilter}>
          <option value="all">全部紧急程度</option>
          {urgencyOptions.map((urgency) => <option key={urgency.value} value={urgency.value}>{urgency.label}</option>)}
        </select>
        <span className="plan-filter-count">{filteredDefects.length} / {defects.length} 个缺陷</span>
      </div>

      <article className="panel defect-list-panel">
        <div className="panel-title">
          <div><h3>缺陷列表</h3><p className="plan-panel-hint">缺陷状态必须通过流程按钮流转，列表展示当前项目内记录。</p></div>
          <button onClick={() => void reloadData()} type="button">刷新</button>
        </div>
        {isLoading && <DefectState icon="progress_activity" title="正在加载缺陷" text="正在读取当前项目下的缺陷记录。" />}
        {!isLoading && loadError && <DefectState icon="error" title="缺陷加载失败" text={loadError} />}
        {!isLoading && !loadError && filteredDefects.length === 0 && (
          <DefectState icon="bug_report" title={defects.length ? "没有匹配的缺陷" : "暂无缺陷记录"} text={defects.length ? "调整搜索或筛选条件后重试。" : "创建缺陷后，可在这里推进 Bug 跟踪流程。"} />
        )}
        {!isLoading && !loadError && filteredDefects.length > 0 && (
          <>
            <div className="defect-list">
              {pagination.pageItems.map((defect) => (
                <DefectCard
                  defect={defect}
                  key={defect.id}
                  onDelete={() => setPendingDelete(defect)}
                  onEdit={() => startEdit(defect)}
                  onTransition={(status) => void changeStatus(defect, status)}
                  transitioning={transitioningId === defect.id}
                />
              ))}
            </div>
            <Pagination itemLabel="个缺陷" onPageChange={pagination.setPage} onPageSizeChange={pagination.setPageSize} page={pagination.page} pageSize={pagination.pageSize} total={filteredDefects.length} />
          </>
        )}
      </article>

      {editorMode && (
        <DefectEditor
          form={form}
          isSaving={isSaving}
          message={formMessage}
          mode={editorMode}
          onChange={setForm}
          onClose={() => setEditorMode(null)}
          onSubmit={submitDefect}
        />
      )}

      {pendingDelete && <ConfirmDialog
        busy={deleteBusy}
        confirmLabel="确认删除"
        description={`缺陷“${pendingDelete.title}”将被删除，此操作无法恢复。`}
        onCancel={() => setPendingDelete(undefined)}
        onConfirm={() => void removeDefect()}
        title="删除缺陷？"
      />}
    </section>
  );
}

function DefectCard({
  defect,
  onDelete,
  onEdit,
  onTransition,
  transitioning,
}: {
  defect: Defect;
  onDelete: () => void;
  onEdit: () => void;
  onTransition: (status: DefectStatus) => void;
  transitioning: boolean;
}) {
  const nextStatuses = transitions[defect.status];
  return (
    <article className={`defect-card urgency-${defect.urgency}`}>
      <div className="defect-card-main">
        <div className="defect-card-head">
          <span className={`status defect-status-${defect.status}`}>{statusLabel(defect.status)}</span>
          <span className={`defect-urgency urgency-${defect.urgency}`}>{urgencyLabel(defect.urgency)}</span>
          <span>{typeLabel(defect.type)}</span>
        </div>
        <h4>{defect.title}</h4>
        <div className="defect-content-preview" dangerouslySetInnerHTML={{ __html: sanitizeRichText(defect.contentHtml) || "暂无内容" }} />
        <div className="defect-meta">
          <span><Icon name="person" />指派给 {defect.assignee || "未指派"}</span>
          <span><Icon name="edit_note" />报告人 {defect.reporter}</span>
          <span><Icon name="schedule" />更新于 {formatDate(defect.updatedAt)}</span>
        </div>
      </div>
      <div className="defect-card-side">
        <div className="defect-transition-actions">
          {nextStatuses.map((status) => (
            <button disabled={transitioning} key={status} onClick={() => onTransition(status)} type="button">
              <Icon name={transitioning ? "progress_activity" : "arrow_forward"} />
              {statusLabel(status)}
            </button>
          ))}
        </div>
        <div className="defect-row-actions">
          <button className="btn" onClick={onEdit} type="button"><Icon name="edit" />编辑</button>
          <button className="btn danger" onClick={onDelete} type="button"><Icon name="delete" />删除</button>
        </div>
      </div>
    </article>
  );
}

function DefectEditor({
  form,
  isSaving,
  message,
  mode,
  onChange,
  onClose,
  onSubmit,
}: {
  form: DefectForm;
  isSaving: boolean;
  message: string;
  mode: DefectEditorMode;
  onChange: (form: DefectForm) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const editorRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const patch = <K extends keyof DefectForm>(key: K, value: DefectForm[K]) => onChange({ ...form, [key]: value });

  useEffect(() => {
    if (editorRef.current && editorRef.current.innerHTML !== form.contentHtml) {
      editorRef.current.innerHTML = form.contentHtml;
    }
  }, [form.id, form.contentHtml]);

  const applyFormat = (command: string) => {
    editorRef.current?.focus();
    document.execCommand(command);
    patch("contentHtml", sanitizeRichText(editorRef.current?.innerHTML ?? ""));
  };

  const insertImage = (src: string) => {
    editorRef.current?.focus();
    document.execCommand("insertImage", false, src);
    patch("contentHtml", sanitizeRichText(editorRef.current?.innerHTML ?? ""));
  };

  const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
    const files = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith("image/"));
    if (files.length === 0) return;
    event.preventDefault();
    files.forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") insertImage(reader.result);
      };
      reader.readAsDataURL(file);
    });
  };

  const handleImageFile = (file?: File) => {
    if (!file || !file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") insertImage(reader.result);
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <form aria-modal="true" className="defect-editor-modal" onSubmit={onSubmit} role="dialog">
        <input accept="image/*" hidden onChange={(event) => handleImageFile(event.target.files?.[0])} ref={imageInputRef} type="file" />
        <div className="modal-head">
          <div>
            <span className="eyebrow">{mode === "create" ? "新建缺陷" : "编辑缺陷"}</span>
            <h3>{mode === "create" ? "记录 Bug" : form.title || "编辑 Bug"}</h3>
            <p>维护标题、指派人、类型、紧急程度和富文本内容。</p>
          </div>
          <button className="icon-btn" onClick={onClose} title="关闭" type="button"><Icon name="close" /></button>
        </div>
        <div className="defect-editor-body">
          <div className="defect-editor-grid">
            <label className="plan-field"><span>Bug 标题 <span aria-hidden="true" className="required-mark">*</span></span><input onChange={(event) => patch("title", event.target.value)} placeholder="例如：支付成功后订单状态未同步" value={form.title} /></label>
            <label className="plan-field"><span>指派人</span><input onChange={(event) => patch("assignee", event.target.value)} placeholder="请输入处理人" value={form.assignee} /></label>
            <label className="plan-field"><span>Bug 类型</span><select onChange={(event) => patch("type", event.target.value as DefectType)} value={form.type}>{typeOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
            <label className="plan-field"><span>紧急程度</span><select onChange={(event) => patch("urgency", event.target.value as DefectUrgency)} value={form.urgency}>{urgencyOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
            <label className="plan-field"><span>当前状态</span><select onChange={(event) => patch("status", event.target.value as DefectStatus)} value={form.status}>{statuses.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
            <section className="defect-rich-field">
              <div className="defect-rich-label">Bug 内容 <span aria-hidden="true" className="required-mark">*</span></div>
              <div className="defect-rich-toolbar" aria-label="富文本工具栏">
                <button onClick={() => applyFormat("bold")} title="加粗" type="button"><Icon name="format_bold" /></button>
                <button onClick={() => applyFormat("italic")} title="斜体" type="button"><Icon name="format_italic" /></button>
                <button onClick={() => applyFormat("insertUnorderedList")} title="项目符号列表" type="button"><Icon name="format_list_bulleted" /></button>
                <button onClick={() => imageInputRef.current?.click()} title="插入图片" type="button"><Icon name="image" /></button>
              </div>
              <div
                aria-label="Bug 内容"
                className="defect-rich-editor"
                contentEditable
                data-placeholder="请输入复现步骤、实际结果、期望结果；可直接粘贴截图。"
                onInput={(event) => patch("contentHtml", sanitizeRichText(event.currentTarget.innerHTML))}
                onPaste={handlePaste}
                ref={editorRef}
                role="textbox"
                suppressContentEditableWarning
              />
            </section>
          </div>
          {message && <p className="plan-form-message">{message}</p>}
        </div>
        <div className="modal-actions defect-editor-actions">
          <span>{stripRichText(form.contentHtml).length} 字</span>
          <button className="btn" onClick={onClose} type="button">取消</button>
          <button className="btn primary" disabled={isSaving} type="submit"><Icon name={isSaving ? "progress_activity" : "save"} />{isSaving ? "保存中..." : "保存缺陷"}</button>
        </div>
      </form>
    </div>
  );
}

function DefectState({ icon, text, title }: { icon: string; text: string; title: string }) {
  return (
    <div className={icon === "error" ? "list-state error" : "list-state empty"}>
      <span className="list-state-icon"><Icon name={icon} /></span>
      <h4>{title}</h4>
      <p>{text}</p>
    </div>
  );
}
