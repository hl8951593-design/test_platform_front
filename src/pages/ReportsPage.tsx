import { ActionButton } from "../components/Buttons";
import { Icon } from "../components/Icon";
import type { ActionHandler } from "../types";

export function ReportsPage({ onAction }: { onAction: ActionHandler }) {
  return (
    <section className="page page-reports">
      <div className="alert-banner">
        <Icon name="warning" />
        <div>
          <strong>发现 5 个高优先级失败聚类</strong>
          <span>支付回调超时、头像上传签名过期、订单状态同步延迟需要立即关注。</span>
        </div>
        <ActionButton action={{ icon: "bug_report", label: "生成缺陷", primary: true }} onAction={onAction} />
      </div>
      <div className="stats-grid">
        {[
          ["通过率", "94.8%", "trending_up"],
          ["失败用例", "42", "error"],
          ["平均耗时", "1m 36s", "timer"],
          ["阻塞缺陷", "7", "priority_high"],
        ].map(([label, value, icon]) => (
          <article className="metric-card" key={label}><Icon name={icon} /><div><p>{label}</p><strong>{value}</strong><span>较昨日改善 3.2%</span></div></article>
        ))}
      </div>
      <div className="report-grid">
        <article className="panel cluster-panel">
          <div className="panel-title"><h3>失败聚类分析</h3><button onClick={() => onAction("查看聚类")} type="button">展开</button></div>
          {["支付回调超时", "上传签名过期", "库存扣减冲突"].map((item, index) => (
            <div className="cluster-row" key={item}>
              <span>{item}</span>
              <div className="progress"><i style={{ width: `${88 - index * 18}%` }} /></div>
              <strong>{18 - index * 4}</strong>
            </div>
          ))}
        </article>
        <article className="panel">
          <div className="panel-title"><h3>慢用例排行</h3><button onClick={() => onAction("导出排行")} type="button">导出</button></div>
          {["支付网关三方回调", "订单创建后置校验", "报表聚合查询", "优惠券叠加计算"].map((item, index) => (
            <div className="rank-row" key={item}><b>{index + 1}</b><span>{item}</span><strong>{(3.8 - index * 0.5).toFixed(1)}s</strong></div>
          ))}
        </article>
        <article className="panel heatmap-panel">
          <div className="panel-title"><h3>稳定性热力图</h3><button onClick={() => onAction("切换维度")} type="button">模块</button></div>
          <div className="heatmap">{Array.from({ length: 35 }, (_, index) => <span className={`heat-${index % 5}`} key={index} />)}</div>
        </article>
        <article className="panel recommendation-panel">
          <Icon name="auto_awesome" />
          <h3>AI 建议</h3>
          <p>建议先修复支付回调重试策略，再补充订单状态同步的幂等断言。可自动生成 12 条回归用例。</p>
          <ActionButton action={{ icon: "add_task", label: "生成补充用例", primary: true }} onAction={onAction} />
        </article>
      </div>
    </section>
  );
}
