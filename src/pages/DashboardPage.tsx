import { ActionButton, IconButton } from "../components/Buttons";
import { Icon } from "../components/Icon";
import { dashboardStats, recentRuns } from "../data/mock";
import type { ActionHandler } from "../types";

export function DashboardPage({ onAction }: { onAction: ActionHandler }) {
  return (
    <section className="page page-dashboard">
      <div className="hero-strip">
        <div>
          <p className="eyebrow">AI Test Operations</p>
          <h2>今日自动化测试态势稳定，支付链路需重点观察</h2>
          <span>主干回归通过率 98.2%，失败集中在头像上传和支付回调超时。</span>
        </div>
        <div className="hero-actions">
          <ActionButton action={{ icon: "psychology", label: "AI 诊断" }} onAction={onAction} />
          <ActionButton action={{ icon: "play_arrow", label: "立即执行", primary: true }} onAction={onAction} />
        </div>
      </div>
      <div className="stats-grid">
        {dashboardStats.map((stat) => (
          <article className={`metric-card tone-${stat.tone}`} key={stat.label}>
            <Icon name={stat.icon} />
            <div>
              <p>{stat.label}</p>
              <strong>{stat.value}</strong>
              <span>{stat.delta}</span>
            </div>
          </article>
        ))}
      </div>
      <div className="dashboard-grid">
        <article className="panel chart-panel">
          <PanelTitle title="执行趋势" action="导出" onAction={onAction} />
          <div className="bar-chart">
            {[68, 52, 84, 74, 95, 62, 88, 78, 92, 71, 86, 97].map((height, index) => (
              <span key={index} style={{ height: `${height}%` }} />
            ))}
          </div>
          <div className="chart-axis">
            <span>00:00</span>
            <span>06:00</span>
            <span>12:00</span>
            <span>18:00</span>
            <span>24:00</span>
          </div>
        </article>
        <article className="panel ai-panel">
          <PanelTitle title="AI 智能诊断" action="查看详情" onAction={onAction} />
          <div className="ai-orb">
            <Icon name="auto_awesome" />
          </div>
          <h3>检测到 3 个高相关失败</h3>
          <p>失败样本集中在文件上传链路，建议优先检查对象存储签名时效和网关超时配置。</p>
          <button className="ghost-link" onClick={() => onAction("生成修复建议")} type="button">
            生成修复建议
          </button>
        </article>
      </div>
      <article className="panel">
        <PanelTitle title="最近执行记录" action="查看全部" onAction={onAction} />
        <table className="data-table">
          <thead>
            <tr>
              <th>Run ID</th>
              <th>任务名称</th>
              <th>状态</th>
              <th>用例</th>
              <th>耗时</th>
              <th>时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {recentRuns.map((run) => (
              <tr key={run[0]}>
                {run.map((item, index) => (
                  <td key={`${run[0]}-${item}`}>
                    {index === 2 ? <span className={`status status-${item}`}>{item}</span> : item}
                  </td>
                ))}
                <td>
                  <IconButton icon="visibility" label={`查看 ${run[0]}`} onAction={onAction} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </article>
    </section>
  );
}

function PanelTitle({ title, action, onAction }: { title: string; action: string; onAction: ActionHandler }) {
  return (
    <div className="panel-title">
      <h3>{title}</h3>
      <button onClick={() => onAction(action)} type="button">
        {action}
      </button>
    </div>
  );
}
