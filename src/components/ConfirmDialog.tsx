import { useEffect, useRef } from "react";
import { Icon } from "./Icon";

export function ConfirmDialog({
  busy = false,
  cancelLabel = "取消",
  confirmLabel = "确认",
  description,
  onCancel,
  onConfirm,
  title,
}: {
  busy?: boolean;
  cancelLabel?: string;
  confirmLabel?: string;
  description: string;
  onCancel: () => void;
  onConfirm: () => void;
  title: string;
}) {
  const cancelButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [busy, onCancel]);

  return <div className="modal-backdrop confirm-backdrop" onMouseDown={(event) => {
    if (event.target === event.currentTarget && !busy) onCancel();
  }} role="presentation">
    <section aria-describedby="confirm-dialog-description" aria-labelledby="confirm-dialog-title" aria-modal="true" className="confirm-dialog" role="alertdialog">
      <div className="confirm-dialog-icon"><Icon name="warning" /></div>
      <div className="confirm-dialog-copy">
        <h3 id="confirm-dialog-title">{title}</h3>
        <p id="confirm-dialog-description">{description}</p>
      </div>
      <div className="confirm-dialog-actions">
        <button className="btn" disabled={busy} onClick={onCancel} ref={cancelButtonRef} type="button">{cancelLabel}</button>
        <button className={busy ? "btn danger loading" : "btn danger"} disabled={busy} onClick={onConfirm} type="button">
          <Icon name={busy ? "progress_activity" : "delete"} />{busy ? "处理中" : confirmLabel}
        </button>
      </div>
    </section>
  </div>;
}
