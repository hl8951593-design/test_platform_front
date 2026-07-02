# Agent Runtime 前端架构

状态：当前实现
最后核验：2026-07-02

本文档记录 `/agents` 页面、Agent 类型、API 适配层和 SSE 事件流的当前实现。后端 Harness Loop Agent Runtime 仍按阶段落地；前端只把已接入的目标契约作为可见能力，后端未返回的数据展示为空态、错误态或目标契约限制，不在本地模拟运行结果。

## 1. 模块定位

Agent Runtime 页面入口为 `/agents`，主文件为 `src/pages/AgentsPage.tsx`。契约类型集中在 `src/types/agents.ts`，普通 JSON API 封装在 `src/api/agents.ts`，SSE fetch stream 与 parser 位于 `src/api/agentStream.ts`。
`AgentSkill` 类型只表示后端 Skill catalog 的 `{name,description}` 元数据；`SKILL.md` 正文、Skill 私有资源、后端私有 `triggers`、`guard_unsupported_capability`、`routing_requires_tool`、`routing_required_tool_after_success` 以及 `guard_*` / `routing_*` hints 是 prompt/routing material，不进入前端可见渲染。`routing_required_tool_after_success` 可由后端私有 `intent_markers` 收窄触发范围，例如只在明确生成/创建/组合/执行场景时强制 `testcase.query_project_cases -> scenario.compose_draft`，而不会因只读问题里出现“是否已有场景”就要求 compose。ToolSpec 后端私有 `backend_handler`、前置工具规则和 `tool_result_repair_guidance` 只用于后端执行分发、顺序校验和工具结果修复闭环，前端不读取或复刻。

页面不是普通聊天页，而是围绕生产级 Agent Run 的可审计事实源展示：

| 区域 | 前端职责 |
| --- | --- |
| 左侧历史 | 展示本地 conversation history、搜索、状态筛选、重命名、置顶、删除、导出、当前状态摘要和治理操作；同一 `conversation_id` 下的多轮 run 合并为一条本地会话记录；后端已提供 conversation list/runs/transcript/export 契约，当前页面仍以本地 history MVP 为主，打开时用 transcript 校准已知会话，导出时优先下载服务端 conversation export，失败后才回退本地已加载快照 |
| 创建 Agent Run | 显式携带当前 `project_id`、本地 `conversation_id`、用户输入 `intent`、`max_iterations` 和 `auto_complete`；composer 循环上限默认值为 8 |
| `testagnet` 对话区 | 按当前本地 conversation 的多轮 turn 展示用户目标、Agent 回复、业务化 ToolCall、Approval、Migration 和必要的 ContextBuild；`tool.*` 可先生成临时工具调用卡，后端 ToolCall 详情到达后替换为完整业务卡；LoopObservation 与低层 Agent loop 审计事件保留给 timeline/debug、Inspector、summary 或导出数据，不作为中央线程卡片展示；新 prompt 创建新 run 后追加到同一线程，不覆盖上一轮；Readiness checks 只在顶部状态和右侧 Dashboard 展示；`run.*` 生命周期事件只用于状态判断和二级资源刷新，不直接展示 |
| 底部 composer | 提交多轮 prompt，复用当前 `conversation_id`；Stop 调用 cancel run；当前 run 有 pending approval 时在输入框上方显示审批确认条，提供“是/否”决策 |
| 右侧 Inspector | 默认收起，通过中央线程头部的详情按钮展开；展开后使用 Run、Tool、Approval、Memory、Runbook、Dashboard tabs 展示选中 run 的治理事实、summary/action state 和 safe actions；Run Summary 展示状态、循环进度、自动完成、terminal/approval/migration/blocking 摘要，并按 `primary_action_ids` 展示后端给出的主动作 |

桌面端 `/agents` 工作台作为视口内应用面板运行：外层页面不产生纵向滚动，中央 transcript、左侧 history rail 和长 JSON 折叠块承担各自内部滚动。页面尺寸通过紧凑栏宽、较低输入区和较短消息间距保证主线程、输入区和当前状态摘要同时可见。

前端历史当前只保存 `{conversationId, runId, itemId, title, intent, status, pinned, updatedAt}` 等本地索引信息，并按 `conversationId || runId` 去重；同一会话中继续发送 prompt 会复用当前本地 `conversation_id` 创建新的 run，但左侧只保留该 conversation 的一条历史记录，记录中的 `runId`、`intent` 和 `status` 更新为最新 run。后端已提供 `GET /agents/conversations?project_id=...`、`GET /agents/conversations/{conversation_id}/runs?project_id=...`、`GET /agents/conversations/{conversation_id}/transcript?project_id=...` 和 export 契约；当前页面尚未用服务端列表替换本地 index，打开或刷新已知 conversation 时用 transcript 做校准，导出已知 `conversation_id` 时调用服务端 export 并保留本地快照兜底。服务端 transcript 返回 `turns[].run`、`assistant_message`、`assistant_visible` 和 `context_compactions`；API 适配层只在 `assistant_visible` 未显式为 `false` 时把 `assistant_message` 合成为 `model.completed` 回复，页面合并 transcript 时只更新元数据或补足缺失 turn，不用摘要清除本地已接收的完整 events、ToolCall、Approval、Migration、ContextBuild 或 LoopObservation。中央 transcript 维护当前本地 conversation 的 turn 列表，每轮 run 的用户目标、Agent 回复和用户可操作治理卡片会按顺序保留在同一个对话场景中；LoopObservation 不进入主线程，只保留给审计/debug/Inspector/summary/export。用户只有点击“新建对话”才会重置并生成新的本地 conversation；如果后端创建或详情响应临时返回了不同的 `conversation_id`，当前工作台仍以发起请求时的本地 conversation 归并多轮历史，避免第二轮问题被拆成新会话。刷新页面后可从本地 run id 调用 `GET /agents/runs/{run_id}` 校准；远端读取失败时保留本地历史并标记不可用。`conversation_id`、`run_id`、`runtime_snapshot_id`、hash、sequence 和 `item_id` 等机器标识只作为 API、本地索引、审批提交、timeline/debug 定位和导出数据使用，普通工作台不把它们作为可见摘要展示。当前已加载 run 的实时 `status` 优先于本地 history index 中的旧状态，并会同步回本地历史，避免用户刚发送目标或重新打开运行中任务时仍看到过期的 `failed` 标签。

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
| `GET` | `/agents/runs/{run_id}/events/snapshot?after_sequence={seq}` | `getAgentRunEventSnapshot` |
| `GET` | `/agents/runs/{run_id}/summary` | `getAgentRunSummary` |
| `GET` | `/agents/runs/{run_id}/actions` | `getAgentRunActions` |
| `GET` | `/agents/conversations/{conversation_id}/transcript?project_id={project_id}` | `getAgentConversationTranscript` |
| `GET` | `/agents/conversations/{conversation_id}/export?project_id={project_id}` | `getAgentConversationExport` |
| `GET` | `/agents/capabilities` | `getAgentCapabilities` |
| `GET` | `/agents/skills` | `getAgentSkills` |
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

`listAgentRuns` 是服务端 run list 的适配入口，但当前页面历史 MVP 尚未依赖该接口；接入服务端 conversation 列表时还需要补齐 conversation/status/page 等查询映射和页面测试。`getAgentCapabilities` 读取公开 ToolSpec catalog，使用后端返回的 `item_id` 作为目录/debug/export 稳定 key，不读取或拼接后端私有 tool 字段；`getAgentSkills` 只读取 Skill catalog 元数据，可用于诊断或能力面板。普通对话仍以 `/agents/runs`、SSE 事件、summary 和 action state 为事实源，前端不依赖 `triggers`、`guard_unsupported_capability`、`routing_requires_tool`、`routing_required_tool_after_success`、`intent_markers`、guard/routing hints、Skill 私有资源、Skill 正文或 ToolSpec 后端私有执行/修复字段。`report.read_summary` 的最近报告、失败样本和统计字段仍通过 `GET /agents/tool-calls/{tool_call_id}` 的 `output_json_redacted` 展开，不新增独立的前端报告摘要类型或 API 事实源。

API 适配层以当前后端响应 shape 为准并保持旧字段兼容：approve/reject 读取 `AgentApprovalDecisionRead.approval`，`reconcileAgentRun` 返回 `AgentRunReconcileRead` 摘要而不是 run snapshot，migration resolve 读取 `AgentMigrationBlockResolveRead.block`，memory feedback 发送 `{outcome}` 并读取 `AgentMemoryFeedbackProcessRead`，dashboard checks 使用 `name/summary` 映射为前端 `key/message`，alerts 使用 snapshot 的 `alerts[]/summary`，runbook 使用 `run_status/recommendations/runbooks[].safe_api_actions`，release gates 和 promotion 可以是单个 snapshot/assessment 对象而不是 `items[]`。

## 3. SSE 与二级资源

SSE 使用 `fetch + ReadableStream`，订阅时发送：

```text
Accept: text/event-stream
Last-Event-ID: <last_event_seq>
Authorization: Bearer <access_token>
```

`Last-Event-ID` 按 run 独立保存，创建或切换到新 run 时不会继承上一 run 的 cursor。订阅异常中断后，页面最多自动重连 3 次，每次继续使用当前 run 的最新 `Last-Event-ID`。Parser 支持：

- 标准 `id:`、`event:`、`data:`。
- `data` 内携带 `event_type`、`event_seq`、`payload_json` 的 EventStore 回放格式。
- heartbeat 注释或 `event: heartbeat`。
- 断包后继续拼接解析。

如果 SSE 断线、流正常关闭但没有业务事件，或连接期间只有 heartbeat，前端调用 `GET /agents/runs/{run_id}/events/snapshot?after_sequence={seq}` 补拉事件。Snapshot 响应按 `events` 追加、按 `next_after_sequence` 更新当前 run cursor，并读取 `context_compactions` 作为审计/debug 标记；`terminal=true` 时继续调用 `GET /agents/runs/{run_id}/summary` 校准最终状态和 assistant 回复，并调用 `/actions` 刷新右侧主动作；summary 不可用时回退到 run detail。

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

`testagnet` 对话区渲染不直接把每个 SSE 包展示成一条消息。尚未发送目标时，空状态标题为“我们应该做什么”；用户发送消息并创建 Run 后，该空状态区域消失。`run.queued`、`run.started`、`run.completed` 等 `run.*` 生命周期事件只用于刷新 run 详情、终态和侧栏摘要，不进入中央 transcript；`run.completed.result.message` 例外，它作为后端权威最终 assistant 回复进入当前 Agent 气泡。用户可见 assistant 内容只认 `model.delta.payload.content`、`model.markdown_normalized.payload.content`、`model.completed.payload.content` 和 `run.completed.result.message`。`model.delta.payload.content` 是按顺序追加的可见文本，可能是多个 token 合并后的微批，不按“一个事件一个 token”处理。`model.markdown_normalized` 且 `replace_content=true` 时替换当前 assistant 气泡；`model.completed` 用于冻结最终完整回复，但 `model.completed.payload.requested_tool=true` 表示该 content 是内部工具请求预览，前端必须把它当作审计事实而不是 Agent 回复。`model.tool_request_*`、`model.required_tool_*`、`context.*` 和 `tool.*` 是 loop 审计或工具事实，不渲染成用户回答。后端只有在明确场景编排 follow-up 意图命中时才会发出 `model.required_tool_missing`；项目上下文、测试资源盘点或“是否已有场景”这类只读问题可以直接以最终 assistant 回复结束，前端不应自行推断缺少 `scenario.compose_draft`。

Agent 回复渲染为 GitHub Flavored Markdown，支持段落、标题、无序列表、有序列表、表格、代码围栏、引用、分隔线、粗体和行内代码；代码围栏、`---` 分隔线、`1.` 有序列表和 `| 表头 |` 表格不得被拼进普通段落。高频 SSE delta 会先进入前端缓冲队列，再按 `requestAnimationFrame` 批量提交 React 状态，避免逐 token 重渲染。中央线程滚动同样按动画帧合并，并直接设置 `scrollTop`，不叠加 smooth scroll 动画。`tool.*` 事件会根据 `tool_call_id` 匹配已 hydrate 的 ToolCall，并把业务化工具名称、状态、关键参数摘要、redacted input、redacted output、权限和恢复信息以内联折叠块放回同一条工作线程；如果 ToolCall 详情尚未 hydrate，前端先从 `tool.*` 事件生成临时工具调用卡，详情到达后替换为完整 ToolCall。ToolCall 折叠块默认收起，同一个 `tool_call_id` 的连续 `tool.planned/running/effect_committed/result_observed` 只更新同一张工具卡，不作为重复提交。`tool.result_observed` 表示工具结果已进入下一轮模型上下文，前端继续保持等待态直到收到 assistant 可见内容或终态。模型内部 `agent_tool_request` 代码块、包含 `tool_name` 的工具请求 JSON、`requested_tool=true` 的 `model.completed`、`model.tool_request_detected`、`model.tool_request_*`、`model.required_tool_*`、`context.*`、`loop.*` 和 `memory.*` 都属于低层 loop 审计事实，不进入中央主线程；`context.history_compacted`、`context.decision_context_bound` 和 `loop.observed` 只用于 timeline/debug、Inspector、summary 或导出。中央线程不展开低层 raw payload，也不把 `project_id`、`item_id`、`context_build_id`、hash 或 sequence 这类机器标识作为用户可见摘要。

前端事件去重优先使用后端返回的 `item_id`，缺失时才退回 `sequence/id + event`；SSE cursor 仍只使用 run 内 `event_seq` / `Last-Event-ID`，不会把 `item_id` 当成回放游标。React key、timeline/debug/download 定位、ToolCall/Approval/Migration/Context/Loop/Memory/Runbook/Dashboard 行 key 也优先使用后端返回的 `item_id`，前端不自行拼接 `agent-*://...`。多个 `model.delta` 事件合并 assistant 气泡时使用 `model_response_item_id` 或 `model_call_id` 识别同一模型回复，不用事件 `item_id` 合并。Run 成功、失败、取消等终态仍以后端详情为准。

loop trace 字段在 `AgentRunEvent.payload` 中通用透传：`iteration_id`、`model_call_id`、`loop_step`、`tool_call_id` 和 `decision_reason`。`model.required_tool_*` 事件还可能携带 `after_tool` 与 `required_tool`，用于说明后端正在按 Skill follow-up 规则修复漏调用。`loop_step` 当前覆盖 `assistant_response`、`tool_planning`、`tool_request_repair`、`required_tool_repair`、`final_summary`、`intent_capability_guard` 和 `tool_execution`。Timeline/Debug 面板不得再用 `model.started` 次数推断“一次用户问题只调用一次 LLM”，而是用 `model_call_id + loop_step` 展示一次 run 内的普通回答、工具规划、工具请求修复、必需工具修复和最终总结阶段。遇到 `run.failed(error_code=agent_run_stale_worker_lost)` 时立即结束“正在思考”，展示后端中断和可重试状态。

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

页面遇到 pending approval 时，composer 上方显示底部审批确认条，只展示待审批工具名、权限/风险摘要和“是/否”按钮，不展示 `approval_id`、`tool_call_id`、hash、snapshot 或 lineage。用户点击“是”后，前端调用 `/agents/tool-calls/{tool_call_id}/approve` 提交 CAS 字段，然后立即调用 `/agents/runs/{run_id}/resume` 让后端继续执行；用户点击“否”后，前端调用 `/reject` 并提交拒绝原因。页面遇到审批失败时提示用户刷新；后端返回 `409` 时语义为审批已过期或上下文已变化。

Approval 是服务端强状态资源。前端可以在后续 run snapshot 暂时省略 `approvals` 且当前 run 尚未 terminal 时短暂保留本地 pending approval，防止审批条闪烁；但一旦 `/approvals`、run snapshot 或 transcript 明确返回同一 `approval_id` / `tool_call_id` 的 `approved`、`rejected`、`expired`、`revoked` 或 `superseded` 状态，必须按服务端状态覆盖旧 pending，并立即移除底部审批条和中央审批卡，避免用户对已处理审批重复提交 approve/reject。

Runbook tab 以后端 `safe_actions` 为按钮来源，只把 `resume`、`reconcile` 和 `tool_call_detail` 映射到当前已存在的前端操作；其他 action 作为目标契约展示为不可执行提示，不调用未声明后端接口。

## 6. 项目边界

创建 Agent Run 必须有当前项目。未选择项目时创建按钮禁用并显示就地提示。页面不允许跨项目创建 Agent Run，也不在页面中推断权限、审批结果、迁移结果或发布门禁。Dashboard、metrics、alerts 和 promotion gate 等项目级治理请求必须显式携带当前 `project_id`；未选择项目时前端不请求这些治理接口。`/agents/release-gates` 是全局治理视图，仅平台管理员调用，普通项目用户前端不请求。

后端仍是 Run、ToolCall、Approval、Migration、ContextBuild、LoopObservation、MemoryUsage、Runbook 和 EventStore 的权威来源。前端不使用本地计时器模拟 run 成功、失败、步骤流转或恢复结果。

## 7. 验证

当前自动化测试覆盖：

- `src/api/agents.test.ts`：创建 run 请求字段、Run 快照映射、ToolCall/Approval/Migration 映射、approval CAS body、dashboard 映射、未来 run list 适配函数。
- `src/api/agentStream.test.ts`：SSE parser、heartbeat、EventStore 回放格式、断包、`Last-Event-ID` header 和 snapshot 补拉映射。
- `src/pages/AgentsPage.test.tsx`：创建 run、本地 history、同一 conversation 多轮 run 合并、中央 transcript 保留多轮用户目标和 Agent 回复、后端返回新 conversation id 时仍归并到当前本地会话、active run 状态覆盖旧 history 状态、底部 approval 是/否交互、approval CAS、Inspector Dashboard、history 搜索/置顶/重命名/删除、缺项目禁用状态、高频 delta 合并渲染、Markdown 表格/代码围栏/有序列表/引用/分隔线渲染、内部工具请求过滤、`model.markdown_normalized replace_content` 替换、`tool.result_observed` 后继续等待、stale worker lost 中断态、run 维度 `Last-Event-ID`，以及 `model.completed` 最终文本去重。

本模块完成前必须运行：

```bash
npm run docs:check
npm test -- --run
npm run build
```
