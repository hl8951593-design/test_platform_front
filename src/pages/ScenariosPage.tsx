import { ActionButton } from "../components/Buttons";
import { Icon } from "../components/Icon";
import { scenarioSteps } from "../data/mock";
import type { ActionHandler } from "../types";

export function ScenariosPage({ onAction }: { onAction: ActionHandler }) {
  return (
    <section className="page page-scenarios">
      <div className="scenario-shell">
        <aside className="component-library">
          <h3>组件库</h3>
          {["HTTP 请求", "SQL 校验", "等待事件", "条件分支", "变量提取"].map((item) => (
            <button key={item} onClick={() => onAction(`拖入 ${item}`)} type="button">
              <Icon name={item === "HTTP 请求" ? "api" : "extension"} />
              <span>{item}</span>
            </button>
          ))}
          <h3>接口库</h3>
          {["登录", "购物车", "库存", "优惠券"].map((item) => <button key={item} onClick={() => onAction(item)} type="button">{item}</button>)}
        </aside>
        <main className="scenario-board">
          <div className="page-toolbar">
            <div className="tabs"><button className="active" type="button">流程设计</button><button type="button">数据驱动</button><button type="button">调试记录</button></div>
            <ActionButton action={{ icon: "play_arrow", label: "运行场景", primary: true }} onAction={onAction} />
          </div>
          <div className="step-lane">
            {scenarioSteps.map((step, index) => (
              <article className={step.active ? "scenario-step active" : "scenario-step"} key={step.title}>
                <span className="step-index">{index + 1}</span>
                <b>{step.method}</b>
                <strong>{step.title}</strong>
                <code>{step.path}</code>
                {step.token && <small>输出变量：{step.token}</small>}
              </article>
            ))}
          </div>
        </main>
        <aside className="config-panel">
          <h3>参数配置</h3>
          <label>请求名称<input defaultValue="获取购物车" /></label>
          <label>Path 参数<input defaultValue="user_id={{auth.userId}}" /></label>
          <label>Body 编辑器<textarea defaultValue={"{\n  \"skuId\": \"SKU-9081\",\n  \"quantity\": 2\n}"} /></label>
          <ActionButton action={{ icon: "save", label: "保存配置", primary: true }} onAction={onAction} />
        </aside>
      </div>
    </section>
  );
}
