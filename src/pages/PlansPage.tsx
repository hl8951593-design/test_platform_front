import { ActionButton, IconButton } from "../components/Buttons";
import { Icon } from "../components/Icon";
import { planStats, plans } from "../data/mock";
import type { ActionHandler } from "../types";

export function PlansPage({ onAction }: { onAction: ActionHandler }) {
  return (
    <section className="page page-plans">
      <div className="page-toolbar">
        <div className="tabs">
          <button className="active" onClick={() => onAction("计划列表")} type="button">计划列表</button>
          <button onClick={() => onAction("调度日历")} type="button">调度日历</button>
          <button onClick={() => onAction("执行历史")} type="button">执行历史</button>
        </div>
        <ActionButton action={{ icon: "add", label: "新建计划", primary: true }} onAction={onAction} />
      </div>
      <div className="stats-grid compact-stats">
        {planStats.map((stat) => (
          <article className={`metric-card tone-${stat.tone}`} key={stat.label}>
            <Icon name={stat.icon} />
            <div>
              <p>{stat.label}</p>
              <strong>{stat.value}</strong>
            </div>
          </article>
        ))}
      </div>
      <article className="panel">
        <div className="panel-title">
          <h3>计划编排</h3>
          <button onClick={() => onAction("导出计划")} type="button">导出</button>
        </div>
        <div className="plan-list">
          {plans.map((plan) => (
            <article className={plan.danger ? "plan-card danger" : "plan-card"} key={plan.id}>
              <div>
                <div className="plan-heading">
                  <strong>{plan.name}</strong>
                  <span>{plan.id}</span>
                </div>
                <p>{plan.desc}</p>
                <div className="tag-row">
                  <span>{plan.trigger}</span>
                  {plan.meta && <span>{plan.meta}</span>}
                  {plan.envs.map((env) => <span key={env}>{env}</span>)}
                </div>
              </div>
              <div className="pipeline">
                {plan.steps.map((step, index) => (
                  <span key={`${plan.id}-${index}`}>{Array.isArray(step) ? step.join(" + ") : step}</span>
                ))}
              </div>
              <div className="plan-side">
                <strong>{plan.next}</strong>
                <small>{plan.sub || "手动确认后执行"}</small>
                <label className="switch">
                  <input checked={plan.enabled} onChange={() => onAction(`${plan.name} 状态切换`)} type="checkbox" />
                  <i />
                </label>
                <IconButton icon="more_vert" label={`更多 ${plan.name}`} onAction={onAction} />
              </div>
            </article>
          ))}
        </div>
      </article>
    </section>
  );
}
