import { type ClipboardEvent, type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  deleteDefectImage,
  deleteDefect,
  getDefect,
  listDefects,
  refreshDefectImageUrl,
  saveDefect,
  transitionDefect,
  uploadDefectImage,
  type Defect,
  type DefectAttachment,
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
  attachments: DefectAttachment[];
  inlineMediaIds: number[];
  attachmentsChanged: boolean;
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
  attachments: [],
  inlineMediaIds: [],
  attachmentsChanged: false,
});

function getDefectIdFromPath() {
  const [, section, defectId] = window.location.pathname.split("/");
  return section?.toLowerCase() === "defects" ? decodeURIComponent(defectId ?? "") : "";
}

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

const inlineMediaSrcPrefix = "/__defect_media__/";

function mediaIdFromImage(image: HTMLImageElement) {
  const dataMediaId = Number(image.dataset.mediaId);
  if (Number.isInteger(dataMediaId) && dataMediaId > 0) return dataMediaId;
  const match = image.getAttribute("src")?.match(/^\/__defect_media__\/(\d+)$/);
  const srcMediaId = Number(match?.[1]);
  return Number.isInteger(srcMediaId) && srcMediaId > 0 ? srcMediaId : undefined;
}

function inlineMediaIds(html: string, attachments: DefectAttachment[] = []) {
  const template = document.createElement("template");
  template.innerHTML = sanitizeRichText(html);
  const usedIds = new Set<number>();
  template.content.querySelectorAll<HTMLImageElement>("img").forEach((image) => {
    let mediaId = mediaIdFromImage(image);
    if (!mediaId && !image.getAttribute("src") && image.alt) {
      mediaId = attachments.find((attachment) => attachment.originalFilename === image.alt && !usedIds.has(attachment.id))?.id;
    }
    if (mediaId) usedIds.add(mediaId);
  });
  return [...usedIds];
}

function serializeRichText(html: string) {
  const template = document.createElement("template");
  template.innerHTML = sanitizeRichText(html);
  template.content.querySelectorAll<HTMLImageElement>("img").forEach((image) => {
    const mediaId = mediaIdFromImage(image);
    if (!mediaId) return;
    image.dataset.mediaId = String(mediaId);
    image.setAttribute("src", `${inlineMediaSrcPrefix}${mediaId}`);
  });
  return template.innerHTML;
}

function canonicalizeRichText(html: string, attachments: DefectAttachment[]) {
  const template = document.createElement("template");
  template.innerHTML = sanitizeRichText(html);
  const usedIds = new Set<number>();
  template.content.querySelectorAll<HTMLImageElement>("img").forEach((image) => {
    let mediaId = mediaIdFromImage(image);
    if (!mediaId && !image.getAttribute("src") && image.alt) {
      mediaId = attachments.find((attachment) => attachment.originalFilename === image.alt && !usedIds.has(attachment.id))?.id;
    }
    if (!mediaId) return;
    usedIds.add(mediaId);
    image.dataset.mediaId = String(mediaId);
    image.setAttribute("src", `${inlineMediaSrcPrefix}${mediaId}`);
  });
  return serializeRichText(template.innerHTML);
}

function renderRichText(html: string, attachments: DefectAttachment[]) {
  const template = document.createElement("template");
  template.innerHTML = canonicalizeRichText(html, attachments);
  const attachmentById = new Map(attachments.map((attachment) => [attachment.id, attachment]));
  template.content.querySelectorAll<HTMLImageElement>("img").forEach((image) => {
    const attachment = attachmentById.get(mediaIdFromImage(image) ?? 0);
    if (attachment) {
      image.src = attachment.downloadUrl;
      image.alt = image.alt || attachment.originalFilename;
    }
  });
  template.content.querySelectorAll<HTMLImageElement>("img").forEach((image, index) => {
    image.dataset.previewIndex = String(index);
    image.title = "双击预览";
  });
  return template.innerHTML;
}

function formFromDefect(defect: Defect): DefectForm {
  const contentHtml = canonicalizeRichText(defect.contentHtml, defect.attachments);
  return {
    id: defect.id,
    title: defect.title,
    assignee: defect.assignee,
    type: defect.type,
    urgency: defect.urgency,
    status: defect.status,
    contentHtml,
    attachments: defect.attachments,
    inlineMediaIds: inlineMediaIds(contentHtml),
    attachmentsChanged: false,
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
  const [isUploading, setIsUploading] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Defect>();
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [transitioningId, setTransitioningId] = useState("");
  const [selectedDefectId, setSelectedDefectId] = useState(() => getDefectIdFromPath());
  const [detailDefect, setDetailDefect] = useState<Defect>();
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");

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

  useEffect(() => {
    const syncDetailPath = () => setSelectedDefectId(getDefectIdFromPath());
    window.addEventListener("popstate", syncDetailPath);
    return () => window.removeEventListener("popstate", syncDetailPath);
  }, []);

  const loadDetail = useCallback(async (defectId: string) => {
    if (!projectId) return;
    setDetailLoading(true);
    setDetailError("");
    try {
      setDetailDefect(await getDefect(projectId, defectId));
    } catch (error) {
      setDetailDefect(undefined);
      setDetailError(error instanceof Error ? error.message : "缺陷详情加载失败");
    } finally {
      setDetailLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (!selectedDefectId) {
      setDetailDefect(undefined);
      setDetailError("");
      return;
    }
    void loadDetail(selectedDefectId);
  }, [loadDetail, selectedDefectId]);

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

  const openDetail = (defectId: string) => {
    window.history.pushState(null, "", `/defects/${defectId}`);
    setSelectedDefectId(defectId);
  };

  const closeDetail = () => {
    window.history.pushState(null, "", "/defects");
    setSelectedDefectId("");
    setEditorMode(null);
  };

  const submitDefect = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!projectId) return setFormMessage("请先选择项目");
    if (isUploading) return setFormMessage("图片正在上传或删除，请稍候");
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
        contentHtml: serializeRichText(form.contentHtml),
        mediaIds: (editorMode === "create" && form.attachments.length > 0) || form.attachmentsChanged
          ? form.attachments
            .filter((attachment) => !form.inlineMediaIds.includes(attachment.id) || inlineMediaIds(form.contentHtml).includes(attachment.id))
            .map((attachment) => attachment.id)
          : undefined,
      };
      const saved = await saveDefect(projectId, input);
      await reloadData();
      if (selectedDefectId === saved.id) setDetailDefect(saved);
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
      if (selectedDefectId === defect.id) await loadDetail(defect.id);
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
      if (selectedDefectId === pendingDelete.id) closeDetail();
      onAction(`删除缺陷 ${pendingDelete.title}`);
    } catch (error) {
      onAction(error instanceof Error ? error.message : "缺陷删除失败");
    } finally {
      setDeleteBusy(false);
      setPendingDelete(undefined);
    }
  };

  const handleAttachmentDeleted = (mediaId: number) => {
    setDefects((current) => current.map((defect) => defect.id === form.id
      ? { ...defect, attachments: defect.attachments.filter((attachment) => attachment.id !== mediaId) }
      : defect));
    setDetailDefect((current) => current?.id === form.id
      ? { ...current, attachments: current.attachments.filter((attachment) => attachment.id !== mediaId) }
      : current);
  };

  const editor = editorMode && projectId ? (
    <DefectEditor
      form={form}
      isSaving={isSaving}
      isUploading={isUploading}
      message={formMessage}
      mode={editorMode}
      onChange={setForm}
      onClose={() => setEditorMode(null)}
      onAttachmentDeleted={handleAttachmentDeleted}
      onMessage={setFormMessage}
      onSubmit={submitDefect}
      projectId={projectId}
      setIsUploading={setIsUploading}
    />
  ) : null;

  const deleteDialog = pendingDelete ? (
    <ConfirmDialog
      busy={deleteBusy}
      confirmLabel="确认删除"
      description={`缺陷“${pendingDelete.title}”将被删除，此操作无法恢复。`}
      onCancel={() => setPendingDelete(undefined)}
      onConfirm={() => void removeDefect()}
      title="删除缺陷？"
    />
  ) : null;

  if (selectedDefectId) {
    return (
      <section className="page defect-detail-page">
        <button className="defect-detail-back" onClick={closeDetail} type="button">
          <Icon name="arrow_back" />返回缺陷列表
        </button>
        {detailLoading && <DefectState icon="progress_activity" title="正在加载缺陷详情" text="正在读取缺陷内容与附件。" />}
        {!detailLoading && detailError && <DefectState icon="error" title="缺陷详情加载失败" text={detailError} />}
        {!detailLoading && !detailError && detailDefect && (
          <DefectDetail
            defect={detailDefect}
            onDelete={() => setPendingDelete(detailDefect)}
            onEdit={() => startEdit(detailDefect)}
            onTransition={(status) => void changeStatus(detailDefect, status)}
            transitioning={transitioningId === detailDefect.id}
          />
        )}
        {editor}
        {deleteDialog}
      </section>
    );
  }

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
                  onOpen={() => openDetail(defect.id)}
                  onTransition={(status) => void changeStatus(defect, status)}
                  transitioning={transitioningId === defect.id}
                />
              ))}
            </div>
            <Pagination itemLabel="个缺陷" onPageChange={pagination.setPage} onPageSizeChange={pagination.setPageSize} page={pagination.page} pageSize={pagination.pageSize} total={filteredDefects.length} />
          </>
        )}
      </article>

      {editor}
      {deleteDialog}
    </section>
  );
}

function DefectCard({
  defect,
  onOpen,
  onTransition,
  transitioning,
}: {
  defect: Defect;
  onOpen: () => void;
  onTransition: (status: DefectStatus) => void;
  transitioning: boolean;
}) {
  return (
    <article
      className={`defect-card defect-summary-card urgency-${defect.urgency}`}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") onOpen();
      }}
      role="link"
      tabIndex={0}
    >
      <div className="defect-summary-main">
        <h4>{defect.title}</h4>
        <div className="defect-card-head">
          <span className={`status defect-status-${defect.status}`}>{statusLabel(defect.status)}</span>
          <span className={`defect-urgency urgency-${defect.urgency}`}>{urgencyLabel(defect.urgency)}</span>
          <span>{typeLabel(defect.type)}</span>
        </div>
        <div className="defect-meta">
          <span><Icon name="schedule" />{formatDate(defect.updatedAt)}</span>
          <span><Icon name="person" />指派：{defect.assignee || "未指派"}</span>
          <span><Icon name="edit_note" />提出：{defect.reporter}</span>
        </div>
      </div>
      <DefectStatusMenu defect={defect} onTransition={onTransition} transitioning={transitioning} />
    </article>
  );
}

function DefectStatusMenu({
  defect,
  onTransition,
  transitioning,
}: {
  defect: Defect;
  onTransition: (status: DefectStatus) => void;
  transitioning: boolean;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div className={`defect-status-menu${open ? " open" : ""}`} onClick={(event) => event.stopPropagation()} ref={menuRef}>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`流转“${defect.title}”状态`}
        className="defect-more-button"
        disabled={transitioning}
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <Icon name={transitioning ? "progress_activity" : "more_horiz"} />
      </button>
      {open && (
        <div className="defect-status-dropdown" role="menu">
          <strong>流转状态</strong>
          {transitions[defect.status].map((status) => (
            <button
              key={status}
              onClick={() => {
                setOpen(false);
                onTransition(status);
              }}
              role="menuitem"
              type="button"
            >
              <Icon name="arrow_forward" />{statusLabel(status)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function DefectDetail({
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
  const embeddedIds = inlineMediaIds(defect.contentHtml, defect.attachments);
  const standaloneAttachments = defect.attachments.filter((attachment) => !embeddedIds.includes(attachment.id));
  return (
    <article className="defect-detail-panel">
      <header className="defect-detail-header">
        <div>
          <div className="defect-card-head">
            <span className={`status defect-status-${defect.status}`}>{statusLabel(defect.status)}</span>
            <span className={`defect-urgency urgency-${defect.urgency}`}>{urgencyLabel(defect.urgency)}</span>
            <span>{typeLabel(defect.type)}</span>
          </div>
          <h2>{defect.title}</h2>
          <div className="defect-meta">
            <span><Icon name="schedule" />更新于 {formatDate(defect.updatedAt)}</span>
            <span><Icon name="person" />指派给 {defect.assignee || "未指派"}</span>
            <span><Icon name="edit_note" />提出人 {defect.reporter}</span>
          </div>
        </div>
        <div className="defect-detail-actions">
          <button className="btn" onClick={onEdit} type="button"><Icon name="edit" />编辑缺陷</button>
          <button className="btn danger" onClick={onDelete} type="button"><Icon name="delete" />删除缺陷</button>
        </div>
      </header>
      <section className="defect-detail-section">
        <h3>缺陷内容</h3>
        <RichTextContent attachments={defect.attachments} className="defect-detail-content" html={defect.contentHtml} projectId={defect.projectId} />
      </section>
      {standaloneAttachments.length > 0 && <section className="defect-detail-section">
        <h3>图片附件</h3>
        <div className="defect-detail-attachments">
          {standaloneAttachments.map((attachment) => (
            <AttachmentImage attachment={attachment} key={attachment.id} projectId={defect.projectId} />
          ))}
        </div>
      </section>}
      <section className="defect-detail-section">
        <h3>状态流转</h3>
        <div className="defect-detail-transitions">
          {transitions[defect.status].map((status) => (
            <button className="btn" disabled={transitioning} key={status} onClick={() => onTransition(status)} type="button">
              <Icon name={transitioning ? "progress_activity" : "arrow_forward"} />流转为{statusLabel(status)}
            </button>
          ))}
        </div>
      </section>
    </article>
  );
}

function DefectEditor({
  form,
  isSaving,
  isUploading,
  message,
  mode,
  onChange,
  onClose,
  onAttachmentDeleted,
  onMessage,
  onSubmit,
  projectId,
  setIsUploading,
}: {
  form: DefectForm;
  isSaving: boolean;
  isUploading: boolean;
  message: string;
  mode: DefectEditorMode;
  onChange: (form: DefectForm) => void;
  onClose: () => void;
  onAttachmentDeleted: (mediaId: number) => void;
  onMessage: (message: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  projectId: number;
  setIsUploading: (busy: boolean) => void;
}) {
  const editorRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const patch = <K extends keyof DefectForm>(key: K, value: DefectForm[K]) => onChange({ ...form, [key]: value });
  const standaloneAttachments = form.attachments.filter((attachment) => !form.inlineMediaIds.includes(attachment.id));

  useEffect(() => {
    if (editorRef.current && serializeRichText(editorRef.current.innerHTML) !== form.contentHtml) {
      editorRef.current.innerHTML = renderRichText(form.contentHtml, form.attachments);
    }
  }, [form.id, form.contentHtml, form.attachments]);

  const updateContent = (html: string) => {
    const contentHtml = serializeRichText(html);
    const nextEmbeddedIds = inlineMediaIds(contentHtml);
    onChange({
      ...form,
      contentHtml,
      attachmentsChanged: form.attachmentsChanged || form.inlineMediaIds.some((id) => !nextEmbeddedIds.includes(id)),
    });
  };

  const applyFormat = (command: string) => {
    editorRef.current?.focus();
    document.execCommand(command);
    updateContent(editorRef.current?.innerHTML ?? "");
  };

  const uploadImages = async (files: File[], insertionRange?: Range) => {
    const images = files.filter((file) => file.type.startsWith("image/"));
    if (images.length === 0 || isUploading) return;
    setIsUploading(true);
    onMessage("");
    const uploaded: DefectAttachment[] = [];
    try {
      for (const file of images) uploaded.push(await uploadDefectImage(projectId, file));
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "图片上传失败");
    } finally {
      if (uploaded.length > 0) {
        if (insertionRange && editorRef.current) {
          const fragment = document.createDocumentFragment();
          uploaded.forEach((attachment) => {
            const image = document.createElement("img");
            image.dataset.mediaId = String(attachment.id);
            image.alt = attachment.originalFilename;
            image.src = attachment.downloadUrl;
            fragment.append(image, document.createElement("br"));
          });
          insertionRange.deleteContents();
          insertionRange.insertNode(fragment);
        }
        const contentHtml = insertionRange && editorRef.current
          ? serializeRichText(editorRef.current.innerHTML)
          : form.contentHtml;
        onChange({
          ...form,
          contentHtml,
          attachments: [...form.attachments, ...uploaded],
          inlineMediaIds: insertionRange ? [...form.inlineMediaIds, ...uploaded.map((attachment) => attachment.id)] : form.inlineMediaIds,
          attachmentsChanged: true,
        });
      }
      setIsUploading(false);
      if (imageInputRef.current) imageInputRef.current.value = "";
    }
  };

  const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
    const files = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith("image/"));
    if (files.length === 0) return;
    event.preventDefault();
    const range = document.getSelection()?.rangeCount ? document.getSelection()?.getRangeAt(0).cloneRange() : document.createRange();
    if (!range || !editorRef.current) return;
    if (!editorRef.current.contains(range.commonAncestorContainer)) {
      range.selectNodeContents(editorRef.current);
      range.collapse(false);
    }
    void uploadImages(files, range);
  };

  const removeAttachment = async (attachment: DefectAttachment) => {
    if (isUploading) return;
    setIsUploading(true);
    onMessage("");
    try {
      await deleteDefectImage(projectId, attachment.id);
      onChange({
        ...form,
        attachments: form.attachments.filter((item) => item.id !== attachment.id),
        attachmentsChanged: true,
      });
      onAttachmentDeleted(attachment.id);
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "附件删除失败");
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <form aria-modal="true" className="defect-editor-modal" onSubmit={onSubmit} role="dialog">
        <input accept="image/png,image/jpeg,image/gif,image/webp" hidden multiple onChange={(event) => void uploadImages(Array.from(event.target.files ?? []))} ref={imageInputRef} type="file" />
        <div className="modal-head">
          <div>
            <span className="eyebrow">{mode === "create" ? "新建缺陷" : "编辑缺陷"}</span>
            <h3>{mode === "create" ? "记录 Bug" : form.title || "编辑 Bug"}</h3>
            <p>维护标题、指派人、类型、紧急程度、富文本内容和图片附件。</p>
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
              </div>
              <div
                aria-label="Bug 内容"
                className="defect-rich-editor"
                contentEditable
                data-placeholder="请输入复现步骤、实际结果和期望结果；粘贴截图会插入当前光标位置。"
                onInput={(event) => updateContent(event.currentTarget.innerHTML)}
                onPaste={handlePaste}
                ref={editorRef}
                role="textbox"
                suppressContentEditableWarning
              />
            </section>
            <section className="defect-attachment-field">
              <div className="defect-attachment-head">
                <div>
                  <strong>图片附件</strong>
                  <span>PNG、JPEG、GIF 或 WebP，单张最大 10 MiB</span>
                </div>
                <button className="btn" disabled={isUploading} onClick={() => imageInputRef.current?.click()} type="button">
                  <Icon name={isUploading ? "progress_activity" : "add_photo_alternate"} />
                  {isUploading ? "处理中..." : "选择图片"}
                </button>
              </div>
              {standaloneAttachments.length > 0 ? (
                <div className="defect-attachment-gallery editable" aria-label="已选图片附件">
                  {standaloneAttachments.map((attachment) => (
                    <div className="defect-attachment-item" key={attachment.id}>
                      <AttachmentImage attachment={attachment} projectId={projectId} />
                      <div className="defect-attachment-caption">
                        <span title={attachment.originalFilename}>{attachment.originalFilename}</span>
                        <button disabled={isUploading} onClick={() => void removeAttachment(attachment)} title="删除附件" type="button"><Icon name="delete" /></button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : <p className="defect-attachment-empty">暂无独立附件；“选择图片”添加到附件区，粘贴截图会直接插入正文。</p>}
            </section>
          </div>
          {message && <p className="plan-form-message">{message}</p>}
        </div>
        <div className="modal-actions defect-editor-actions">
          <span>{stripRichText(form.contentHtml).length} 字</span>
          <button className="btn" onClick={onClose} type="button">取消</button>
          <button className="btn primary" disabled={isSaving || isUploading} type="submit"><Icon name={isSaving || isUploading ? "progress_activity" : "save"} />{isSaving ? "保存中..." : isUploading ? "图片处理中..." : "保存缺陷"}</button>
        </div>
      </form>
    </div>
  );
}

function AttachmentImage({ attachment, projectId }: { attachment: DefectAttachment; projectId: number }) {
  const [src, setSrc] = useState(attachment.downloadUrl);
  const [refreshAttempted, setRefreshAttempted] = useState(false);

  useEffect(() => {
    setSrc(attachment.downloadUrl);
    setRefreshAttempted(false);
  }, [attachment.downloadUrl]);

  const refreshUrl = async () => {
    if (refreshAttempted) return;
    setRefreshAttempted(true);
    try {
      const url = await refreshDefectImageUrl(projectId, attachment.id);
      if (url) setSrc(`${url}#refreshed=${Date.now()}`);
    } catch {
      // The broken-image state remains visible; the next list reload gets a fresh URL.
    }
  };

  return <img alt={attachment.originalFilename} loading="lazy" onError={() => void refreshUrl()} src={src} />;
}

function RichTextContent({ attachments, className, html, projectId }: { attachments: DefectAttachment[]; className: string; html: string; projectId: number }) {
  const [urls, setUrls] = useState(() => new Map(attachments.map((attachment) => [attachment.id, attachment.downloadUrl])));
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  useEffect(() => {
    setUrls(new Map(attachments.map((attachment) => [attachment.id, attachment.downloadUrl])));
  }, [attachments]);

  const renderedHtml = useMemo(() => renderRichText(html, attachments.map((attachment) => ({
    ...attachment,
    downloadUrl: urls.get(attachment.id) ?? attachment.downloadUrl,
  }))), [attachments, html, urls]);
  const previewImages = useMemo(() => {
    const template = document.createElement("template");
    template.innerHTML = renderedHtml;
    return Array.from(template.content.querySelectorAll<HTMLImageElement>("img")).map((image) => ({
      alt: image.alt || "正文图片",
      src: image.getAttribute("src") ?? "",
    })).filter((image) => image.src);
  }, [renderedHtml]);

  const refreshInlineImage = async (target: EventTarget | null) => {
    if (!(target instanceof HTMLImageElement)) return;
    const mediaId = Number(target.dataset.mediaId);
    if (!Number.isInteger(mediaId) || mediaId <= 0) return;
    try {
      const url = await refreshDefectImageUrl(projectId, mediaId);
      if (url) setUrls((current) => new Map(current).set(mediaId, `${url}#refreshed=${Date.now()}`));
    } catch {
      // Keep the broken image visible; a later detail reload can request a new URL.
    }
  };

  const openPreviewFromTarget = (target: EventTarget | null) => {
    const image = target instanceof Element ? target.closest("img") : null;
    if (!image) return;
    const index = Number(image.getAttribute("data-preview-index"));
    if (Number.isInteger(index) && previewImages[index]) setPreviewIndex(index);
  };

  return <>
    <div
      className={className}
      dangerouslySetInnerHTML={{ __html: renderedHtml || "暂无内容" }}
      onClick={(event) => {
        if (event.detail >= 2) openPreviewFromTarget(event.target);
      }}
      onDoubleClick={(event) => openPreviewFromTarget(event.target)}
      onError={(event) => void refreshInlineImage(event.target)}
    />
    {previewIndex !== null && previewImages[previewIndex] && (
      <ImageLightbox images={previewImages} index={previewIndex} onChange={setPreviewIndex} onClose={() => setPreviewIndex(null)} />
    )}
  </>;
}

function ImageLightbox({ images, index, onChange, onClose }: {
  images: Array<{ alt: string; src: string }>;
  index: number;
  onChange: (index: number) => void;
  onClose: () => void;
}) {
  const move = (offset: number) => onChange((index + offset + images.length) % images.length);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowLeft" && images.length > 1) move(-1);
      if (event.key === "ArrowRight" && images.length > 1) move(1);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [images.length, index, onClose]);

  const current = images[index];
  return (
    <div className="defect-image-lightbox" onMouseDown={onClose} role="presentation">
      <section aria-label="图片预览" aria-modal="true" className="defect-image-lightbox-dialog" onMouseDown={(event) => event.stopPropagation()} role="dialog">
        <header>
          <div>
            <strong>{current.alt}</strong>
            <span>{index + 1} / {images.length}</span>
          </div>
          <button aria-label="关闭图片预览" className="icon-btn" onClick={onClose} type="button"><Icon name="close" /></button>
        </header>
        <div className="defect-image-lightbox-stage">
          {images.length > 1 && <button aria-label="上一张图片" className="defect-image-lightbox-nav previous" onClick={() => move(-1)} type="button"><Icon name="chevron_left" /></button>}
          <img alt={current.alt} src={current.src} />
          {images.length > 1 && <button aria-label="下一张图片" className="defect-image-lightbox-nav next" onClick={() => move(1)} type="button"><Icon name="chevron_right" /></button>}
        </div>
      </section>
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
