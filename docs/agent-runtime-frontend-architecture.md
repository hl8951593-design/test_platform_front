# Agent Runtime 前端架构

状态：当前实现
最后核验：2026-06-27

本文档记录 `/agents` 页面、Agent 类型、API 适配层和 SSE 事件流的当前实现。后端 Harness Loop Agent Runtime 仍按阶段落地；前端只把已接入的目标契约作为可见能力，后端未返回的数据展示为空态、错误态或目标契约限制，不在本地模拟运行结果。

## 1. 模块定位

Agent Runtime 页面入口为 `/agents`，主文件为 `src/pages/AgentsPage.tsx`。契约类型集中在 `src/types/agents.ts`，普通 JSON API 封装在 `src/api/agents.ts`，SSE fetch stream 与 parser 位于 `src/api/agentStream.ts`。

页面不是普通聊天页，而是围绕生产级 Agent Run 的可审计事实源展示：

| 区域 | 前端职责 |
| --- | --- |
| 左侧历史 | 展示本地 conversation/run history、搜索、状态筛选、重命名、置顶、删除、导出、当前 run 摘要和治理操作；当前后端没有服务端 conversation 列表，跨设备历史仍是目标契约 |
| 创建 Agent Run | 显式携带当前 `project_id`、本地 `conversation_id`、用户输入 `intent`、`max_iterations` 和 `auto_complete` |
| `testagnet` 对话区 | 展示用户目标、Agent 回复、ToolCall、Approval、Migration、ContextBuild、LoopObservation 和必要的低层事件兜底；Readiness checks 只在顶部状态和右侧 Dashboard 展示；`run.*` 生命周期事件只用于状态判断和二级资源刷新，不直接展示 |
| 底部 composer | 提交多轮 prompt，复用当前 `conversation_id`；Stop 调用 cancel run |
| 右侧 Inspector | 使用 Run、Tool、Approval、Memory、Runbook、Dashboard tabs 展示选中 run 的治理事实和 safe actions |

前端历史只保存 `{conversationId, runId, title, intent, status, pinned, updatedAt}` 等索引信息。刷新页面后可从本地 run id 调用 `GET /agents/runs/{run_id}` 校准；远端读取失败时保留本地历史并标记不可用。本地导出包含当前已加载 run 的 events 和 tool_calls，不等同于服务端全量审计导出。

## 2. API 适配层

页面组件不直接 `fetch` 后端。`src/api/agents.ts` 负责鉴权请求、响应解包、snake_case 到页面使用类型的映射；`src/api/agentStream.ts` 使用 `requestEventStreamWithAuth` 订阅 SSE，避免原生 `EventSource` 无法携带 Authorization header 的限制。

当前封装的目标契约：

| 方法 | 路径 | 前端函数 |
| --- | --- | --- |
| `POST` | `/agents/runs` | `createAgentRun` |
| `GET` | `/agents/runs/{run_id}` | `getAgentRun` |
| `GET` | `/agents/runs/{run_id}/events` | `subscribeAgentRunEvents` |
| `POST` | `/agents/runs/{run_id}/cancel` | `cancelAgentRun` |
| `POST` | `/agents/runs/{run_id}/resume` | `resumeAgentRun` |
| `POST` | `/agents/runs/{run_id}/reconcile` | `reconcileAgentRun` |
| `GET` | `/agents/tool-calls/{tool_call_id}` | `getAgentToolCall` |
| `GET` | `/agents/runs/{run_id}/approvals` | `getAgentApprovals` |
| `POST` | `/agents/tool-calls/{tool_call_id}/approve` | `approveAgentToolCall` |
| `POST` | `/agents/tool-calls/{tool_call_id}/reject` | `rejectAgentToolCall` |
| `GET` | `/agents/runs/{run_id}/migration-blocks` | `getAgentMigrationBlocks` |
| `POST` | `/agents/runs/{run_id}/migration-blocks/{block_id}/resolve` | `resolveAgentMigrationBlock` |
| `GET` | `/agents/runs/{run_id}/context-builds` | `getAgentContextBuilds` |
| `GET` | `/agents/runs/{run_id}/loop-observations` | `getAgentLoopObservations` |
| `GET` | `/agents/memory-usage-events?run_id={run_id}` | `getAgentMemoryUsageEvents` |
| `POST` | `/agents/memory-usage-events/{usage_event_id}/feedback` | `sendAgentMemoryFeedback` |
| `GET` | `/agents/runs/{run_id}/runbook` | `getAgentRunbook` |
| `GET` | `/agents/dashboard?project_id={project_id}` | `getAgentDashboard` |
| `GET` | `/agents/metrics?project_id={project_id}` | `getAgentMetrics` |
| `GET` | `/agents/alerts?project_id={project_id}` | `getAgentAlerts` |
| `GET` | `/agents/release-gates` | `getAgentReleaseGates`，仅平台管理员全局视图 |
| `GET` | `/agents/release-gates/promotion?project_id={project_id}&target_level=L3` | `getAgentReleaseGatePromotion` |

`listAgentRuns` 仍保留为后端未来提供 run 列表后的适配函数，但当前页面历史 MVP 不依赖该接口，也不把服务端 conversation/run list 写成已实现能力。

## 3. SSE 与二级资源

SSE 使用 `fetch + ReadableStream`，订阅时发送：

```text
Accept: text/event-stream
Last-Event-ID: <last_event_seq>
Authorization: Bearer <access_token>
```

订阅异常中断后，页面最多自动重连 3 次，每次继续使用最新 `Last-Event-ID`。Parser 支持：

- 标准 `id:`、`event:`、`data:`。
- `data` 内携带 `event_type`、`event_seq`、`payload_json` 的 EventStore 回放格式。
- heartbeat 注释或 `event: heartbeat`。
- 断包后继续拼接解析。

事件到达后先进入时间线，再按事件前缀 hydrate 二级资源：

| event_type 前缀 | 前端动作 |
| --- | --- |
| `run.*` | 调用 `GET /agents/runs/{run_id}` 校准 run、事件和终态 |
| `tool.*` | 从 payload 读取 `tool_call_id` 并调用 `GET /agents/tool-calls/{tool_call_id}` |
| `approval.*` | 刷新 `GET /agents/runs/{run_id}/approvals` |
| `migration.*` | 刷新 `GET /agents/runs/{run_id}/migration-blocks` |
| `context.*` | 刷新 `GET /agents/runs/{run_id}/context-builds` |
| `loop.*` | 刷新 `GET /agents/runs/{run_id}/loop-observations` |
| `memory.*` | 刷新 `GET /agents/memory-usage-events?run_id={run_id}` |

`testagnet` 对话区渲染不直接把每个 SSE 包展示成一条消息。尚未发送目标时，空状态标题为“我们应该做什么”；用户发送消息并创建 Run 后，该空状态区域消失。`run.queued`、`run.started`、`run.completed` 等 `run.*` 生命周期事件只用于刷新 run 详情、终态和侧栏摘要，不进入中央 transcript。连续的 `assistant.delta`、`assistant.message`、`model.delta` 和 `model.message` 会合并为一条 Agent 回复，保留原始文本顺序和换行，并渲染 Markdown 段落、列表、粗体和行内代码；高频 SSE delta 会先进入前端缓冲队列，再按 `requestAnimationFrame` 批量提交 React 状态，避免逐 token 重渲染。中央线程滚动同样按动画帧合并，并直接设置 `scrollTop`，不叠加 smooth scroll 动画。`tool.*` 事件会根据 `tool_call_id` 匹配已 hydrate 的 ToolCall，并把工具名称、状态、输出预览、redacted input、redacted output、权限和恢复信息以内联折叠块放回同一条工作线程；ToolCall 折叠块默认收起。没有匹配到 `tool_call_id` 的非 `run.*` 低层事件才按事件卡兜底展示，所有低层 payload 都以“原始输出”折叠区呈现并默认收起。

前端事件去重以 `sequence/id + event` 为边界，去重集合与批量渲染缓冲会在切换 Run、重置 conversation 或加载历史快照时同步清理。Run 成功、失败、取消等终态仍以后端详情为准。

## 4. 快捷键与焦点

当前工作台提供以下键盘入口：

| 快捷键 | 行为 |
| --- | --- |
| `Ctrl/Meta + Enter` | 发送当前 prompt 并创建 Agent Run |
| `Ctrl/Meta + .` | 取消当前非终态 Run |
| `Ctrl/Meta + K` | 聚焦本地历史搜索 |
| `Ctrl/Meta + N` | 新建本地 conversation 并聚焦 composer |

## 5. 状态与治理

前端类型覆盖首批 Harness Loop Agent 状态：

| 类型 | 当前枚举 |
| --- | --- |
| `AgentRunStatus` | `queued`、`running`、`paused`、`completed`、`failed`、`cancelled`、`migration_blocked`、`needs_human` |
| `AgentToolCallStatus` | `planned`、`leased`、`running_pre_effect`、`effect_sent`、`uncertain`、`reconciling`、`succeeded`、`failed`、`failed_retryable`、`obsolete`、`needs_migration`、`manual_intervention` |
| `AgentApprovalStatus` | `pending`、`approved`、`rejected`、`expired`、`revoked`、`superseded` |
| `AgentMigrationBlockStatus` | `open`、`resolved`、`cancelled` |

Approval approve/reject 必须提交当前 approval 的 CAS 字段：

```json
{
  "input_hash": "...",
  "runtime_snapshot_id": "...",
  "resource_scope_hash": "...",
  "approval_lineage_id": "...",
  "approval_epoch": 3
}
```

页面遇到审批失败时提示用户刷新；后端返回 `409` 时语义为审批已过期或上下文已变化。

Runbook tab 以后端 `safe_actions` 为按钮来源，只把 `resume`、`reconcile` 和 `tool_call_detail` 映射到当前已存在的前端操作；其他 action 作为目标契约展示为不可执行提示，不调用未声明后端接口。

## 6. 项目边界

创建 Agent Run 必须有当前项目。未选择项目时创建按钮禁用并显示就地提示。页面不允许跨项目创建 Agent Run，也不在页面中推断权限、审批结果、迁移结果或发布门禁。Dashboard、metrics、alerts 和 promotion gate 等项目级治理请求必须显式携带当前 `project_id`；未选择项目时前端不请求这些治理接口。`/agents/release-gates` 是全局治理视图，仅平台管理员调用，普通项目用户前端不请求。

后端仍是 Run、ToolCall、Approval、Migration、ContextBuild、LoopObservation、MemoryUsage、Runbook 和 EventStore 的权威来源。前端不使用本地计时器模拟 run 成功、失败、步骤流转或恢复结果。

## 7. 验证

当前自动化测试覆盖：

- `src/api/agents.test.ts`：创建 run 请求字段、Run 快照映射、ToolCall/Approval/Migration 映射、approval CAS body、dashboard 映射、未来 run list 适配函数。
- `src/api/agentStream.test.ts`：SSE parser、heartbeat、EventStore 回放格式、断包和 `Last-Event-ID` header。
- `src/pages/AgentsPage.test.tsx`：创建 run、本地 history、approval CAS、Inspector Dashboard、history 搜索/置顶/重命名/删除、缺项目禁用状态和高频 delta 合并渲染。

本模块完成前必须运行：

```bash
npm run docs:check
npm test -- --run
npm run build
```
