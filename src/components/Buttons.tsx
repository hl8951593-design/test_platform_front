import { Icon } from "./Icon";
import type { ActionHandler, ActionSpec } from "../types";

export function ActionButton({ action, onAction }: { action: ActionSpec; onAction: ActionHandler }) {
  return (
    <button className={action.primary ? "btn primary" : "btn"} onClick={() => onAction(action.label)} type="button">
      <Icon name={action.icon} />
      {action.label}
    </button>
  );
}

export function IconButton({ icon, label, onAction }: { icon: string; label: string; onAction: ActionHandler }) {
  return (
    <button className="icon-btn" onClick={() => onAction(label)} title={label} type="button">
      <Icon name={icon} />
    </button>
  );
}
