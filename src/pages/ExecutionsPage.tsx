import { ActionButton } from "../components/Buttons";
import { Icon } from "../components/Icon";
import { Pagination, usePagination } from "../components/Pagination";
import { executionRows } from "../data/mock";
import type { ActionHandler } from "../types";

export function ExecutionsPage({ onAction }: { onAction: ActionHandler }) {
  const pagination = usePagination(executionRows, 10, "queue");
  return (
    <section className="page page-executions">
      <div className="execution-command">
        <ActionButton action={{ icon: "play_arrow", label: "启动执行", primary: true }} onAction={onAction} />
        <ActionButton action={{ icon: "pause", label: "暂停队列" }} onAction={onAction} />
        <ActionButton action={{ icon: "stop", label: "终止失败任务" }} onAction={onAction} />
      </div>
      <div className="execution-shell">
        <aside className="case-tree">
          <h3>用例树</h3>
          {["核心链路回归", "支付网关", "用户中心", "订单服务", "报表服务"].map((item, index) => (
            <button className={index === 1 ? "active" : ""} key={item} onClick={() => onAction(item)} type="button">
              <Icon name={index === 1 ? "folder_open" : "folder"} />
              <span>{item}</span>
            </button>
          ))}
        </aside>
        <main className="queue-panel panel">
          <div className="panel-title"><h3>执行队列</h3><button onClick={() => onAction("刷新队列")} type="button">刷新</button></div>
          <table className="data-table">
            <thead><tr><th>ID</th><th>状态</th><th>用例</th><th>标识</th></tr></thead>
            <tbody>
              {pagination.pageItems.map((row) => (
                <tr key={row[0]}>{row.map((item, index) => <td key={item}>{index === 1 ? <span className={`status status-${item}`}>{item}</span> : item}</td>)}</tr>
              ))}
            </tbody>
          </table>
          <Pagination itemLabel="条任务" onPageChange={pagination.setPage} onPageSizeChange={pagination.setPageSize} page={pagination.page} pageSize={pagination.pageSize} total={executionRows.length} />
        </main>
        <aside className="log-panel">
          <h3>Streaming Logs</h3>
          <pre>{'[14:28:15] Runner allocated: worker-03\n[14:28:16] POST /user/avatar started\n[14:28:17] S3 signature expired\n[14:28:17] Assertion failed: expected 200 got 403\n[14:28:18] Capturing failure snapshot...'}</pre>
          <div className="ai-diagnosis">
            <Icon name="psychology" />
            <strong>AI 失败诊断</strong>
            <p>疑似上传签名 TTL 配置过短，与网关重试后产生时间漂移有关。</p>
            <button onClick={() => onAction("生成缺陷")} type="button">生成缺陷</button>
          </div>
        </aside>
      </div>
    </section>
  );
}
