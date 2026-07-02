# 前端功能逻辑说明

状态：当前实现
最后核验：2026-06-30

本文档记录 TestAuto 前端当前已经实现的核心功能逻辑，作为后续开发、联调和排查问题时的依据。代码以 `src/App.tsx`、`src/api/`、`src/pages/PlansPage.tsx`、`src/pages/ApiPage.tsx`、`src/pages/EnvironmentConfigsPage.tsx`、`src/pages/DefectsPage.tsx`、`src/pages/AgentsPage.tsx` 为主。

## 技术栈与接口约定

| 项目 | 当前实现 |
| --- | --- |
| 前端框架 | React + TypeScript |
| 构建工具 | Vite |
| 测试工具 | Vitest + Testing Library |
| 样式 | 全局 CSS，主要在 `src/styles.css` |
| 后端基础地址 | 默认 `http://127.0.0.1:8000/api/v1` |
| 后端地址配置 | `VITE_API_BASE_URL` |
| 刷新 Token 地址配置 | `VITE_AUTH_REFRESH_PATH`，默认 `/auth/refresh` |

所有需要鉴权的接口应优先通过 `src/api/client.ts` 中的 `requestWithAuth` 调用，不建议在页面组件中直接写 `fetch`。

### TESTAI

页面入口为 `/agents`，可见模块名为 TESTAI，主文件为 `src/pages/AgentsPage.tsx`。该页面按后端 Harness+Loop Agent 目标契约先行接入前端骨架，后端未实现或未返回的数据保持 loading、empty 或 error 状态，不在前端模拟运行结果。

Agent 类型位于 `src/types/agents.ts`，普通 JSON API 统一封装在 `src/api/agents.ts`，SSE fetch stream 和 parser 位于 `src/api/agentStream.ts`。`AgentSkill` 只承载后端 Skill catalog 元数据，前端不读取或展示 `SKILL.md` 正文或 Skill 私有资源，也不依赖后端私有 `triggers`、`guard_unsupported_capability`、`routing_requires_tool`、`routing_required_tool_after_success`、`guard_*` / `routing_*` hints 或 ToolSpec 后端私有执行/修复字段：

| 接口 | 方法 | 说明 |
| --- | --- | --- |
| `/agents/dashboard?project_id={project_id}` | `GET` | 查询当前项目 readiness、checks 和告警摘要 |
| `/agents/skills` | `GET` | 查询 Agent Skill catalog 元数据 `{name,description}`，用于诊断或能力展示 |
| `/agents/runs` | `POST` | 创建 Agent Run，必须携带当前 `project_id`、`conversation_id`、`intent`、`max_iterations` 和 `auto_complete` |
| `/agents/runs/{run_id}` | `GET` | 查询 Run 详情、事件、ToolCall、Approval 和 Migration Block |
| `/agents/runs/{run_id}/events` | `GET` | 订阅 Agent Run SSE 事件 |
| `/agents/runs/{run_id}/cancel` | `POST` | 取消 Run |
| `/agents/runs/{run_id}/resume` | `POST` | 恢复 Run |
| `/agents/runs/{run_id}/reconcile` | `POST` | 触发恢复核对 |
| `/agents/tool-calls/{tool_call_id}` | `GET` | 查询 ToolCall 详情 |
| `/agents/runs/{run_id}/approvals` | `GET` | 查询审批记录 |
| `/agents/tool-calls/{tool_call_id}/approve` | `POST` | 带 CAS 字段批准 ToolCall |
| `/agents/tool-calls/{tool_call_id}/reject` | `POST` | 带 CAS 字段拒绝 ToolCall |
| `/agents/runs/{run_id}/migration-blocks` | `GET` | 查询迁移阻断 |
| `/agents/runs/{run_id}/migration-blocks/{block_id}/resolve` | `POST` | 提交迁移阻断解除 |
| `/agents/runs/{run_id}/context-builds` | `GET` | 查询 ContextBuild 和 required evidence |
| `/agents/runs/{run_id}/loop-observations` | `GET` | 查询 LoopObservation |
| `/agents/memory-usage-events?run_id={run_id}` | `GET` | 查询 Memory 使用证据 |
| `/agents/memory-usage-events/{usage_event_id}/feedback` | `POST` | 提交 Memory feedback |
| `/agents/runs/{run_id}/events/snapshot?after_sequence={seq}` | `GET` | SSE 中断、空流或纯 heartbeat 后补拉事件，使用 `events`、`next_after_sequence` 和 `terminal` 恢复 |
| `/agents/runs/{run_id}/summary` | `GET` | terminal 后校准最终状态、`assistant_message`、`assistant_visible`、模型调用和计数摘要 |
| `/agents/runs/{run_id}/actions` | `GET` | 读取 RunInspector/左侧主操作状态，按 `primary_action_ids` 展示主按钮，使用 `resource_item_ids` 定位 timeline/debug item |
| `/agents/conversations?project_id={project_id}` | `GET` | 服务端 conversation 列表契约；当前页面尚未用它替换本地 history index |
| `/agents/conversations/{conversation_id}/runs?project_id={project_id}` | `GET` | 查询指定 conversation 下的 run 列表；当前页面主要通过 transcript 恢复多轮内容 |
| `/agents/conversations/{conversation_id}/transcript?project_id={project_id}` | `GET` | 打开或刷新历史 conversation 时读取服务端 transcript；失败时保留本地 history index |
| `/agents/conversations/{conversation_id}/export?project_id={project_id}` | `GET` | 导出服务端 conversation 调试包；接口不可用时回退本地已加载快照 |
| `/agents/capabilities` | `GET` | 读取公开 ToolSpec catalog，保留后端 `item_id` 作为行 key/debug/export identity |
| `/agents/runs/{run_id}/runbook` | `GET` | 查询 runbook diagnosis 和 safe actions |
| `/agents/metrics?project_id={project_id}`、`/agents/alerts?project_id={project_id}`、`/agents/release-gates/promotion?project_id={project_id}&target_level=L3` | `GET` | 查询当前项目治理摘要，供右侧 Dashboard/Release Gate 展示 |
| `/agents/release-gates` | `GET` | 全局发布门禁视图，仅平台管理员调用；普通项目用户前端不请求该接口 |

`src/api/agents.ts` 适配当前后端 schema：审批 approve/reject 读取 `AgentApprovalDecisionRead.approval`，reconcile 返回 `AgentRunReconcileRead` 计数摘要并由页面随后刷新 run，migration resolve 读取 `{block,checkpoint_freshness}` 中的 `block`，Memory feedback 发送 `{outcome}` 并接收 `AgentMemoryFeedbackProcessRead`，Dashboard/Alert/Runbook/Release Gate 适配 `name/summary`、`alerts[]`、`run_status/recommendations/runbooks` 和单对象 snapshot/promotion assessment。页面组件不直接复刻这些响应解包规则。

页面采用 Codex 式三栏工作台：左侧为新建对话、本地 conversation history、搜索、状态筛选、重命名、置顶、删除、导出和当前状态摘要；同一 `conversation_id` 下的多轮 run 只占用一条本地历史记录，记录指向该会话最新 run；中央对话区名称为 `testagnet`，底部为目标输入框；右侧 Inspector 默认收起，通过中央线程头部的详情按钮展开，展开后提供 Run、Tool、Approval、Memory、Runbook、Dashboard tabs。桌面端 `/agents` 工作台固定在浏览器视口内，页面外层不产生纵向滚动；长对话、长 JSON 和左侧历史由中央 transcript、折叠块或 history rail 自己滚动。普通工作区只展示标题、状态、循环进度、自动完成、工具名和治理结果等可读信息，不把 `conversation_id`、`run_id`、`runtime_snapshot_id`、hash、sequence 和 `item_id` 等机器标识作为卡片摘要或 Run Summary 展示；这些字段仍作为 API、本地索引、审批提交、timeline/debug 定位和导出数据保留。Agent 回复、后端返回的 `tool_calls`、pending approval、migration block 和必要的 context build 可进入中央对话区域；loop observation 只进入 timeline/debug、Inspector、summary 或导出数据，不作为中央线程卡片展示。当前 run 存在 pending approval 时，composer 上方会出现底部审批确认条，展示待审批工具名、权限/风险摘要和“是/否”按钮，供用户直接批准或拒绝。Composer 的循环上限默认值为 8。中央线程按当前本地 conversation 的 turn 列表渲染，新 prompt 创建的新 run 追加在同一线程底部，不能覆盖上一轮用户目标或 Agent 回复。选中 ToolCall 后会展开右侧并切到 Tool tab，以查看完整输入、输出、权限、错误和 reconcile attempts。Readiness checks 不进入中央对话流，只在顶部 Readiness pill 和右侧 Dashboard tab 展示。`run.*` 生命周期事件只用于刷新 Run 状态和判断终态，不作为对话消息展示。中央线程不展示静态系统引导卡，也不把 dashboard/readiness 权限失败提示作为“状态更新”消息插入对话流。治理摘要请求必须携带当前 `project_id`；未选择项目时不请求项目级治理接口，非管理员用户不请求全局 `/agents/release-gates`。

中央工作线程只把用户可见 assistant 内容渲染成 Agent 回复：`model.delta.payload.content` 按顺序追加，`model.markdown_normalized.payload.content` 在 `replace_content=true` 时替换当前气泡，`model.completed.payload.content` 冻结最终完整回复，`run.completed.result.message` 和 `GET /agents/runs/{run_id}/summary.assistant_message` 作为终态权威回复校准。`model.completed.payload.requested_tool=true` 表示该 content 是内部工具请求预览，不是用户可见 assistant 回复；前端必须 suppress 该事件，继续等待 ToolCall、后续模型回复或终态。`model.delta.payload.content` 可能是多个 token 合并后的微批，前端不假设一个事件等于一个 token。Agent 回复渲染为 GitHub Flavored Markdown，支持段落、标题、无序列表、有序列表、表格、代码围栏、引用、分隔线、粗体和行内代码，不把 ` ``` `、`---`、`1.`、`| 表头 |` 这类块级 Markdown 标记拼进普通段落。高频 SSE delta 会先进入前端缓冲队列，再按 `requestAnimationFrame` 批量提交 React 状态；中央线程自动滚动也按动画帧合并并直接设置 `scrollTop`，避免逐 token 重渲染和 smooth scroll 动画堆叠。

`run.queued`、`run.started`、普通 `run.completed` 等 `run.*` 生命周期事件只作为状态判断、终态校准和侧栏摘要的数据源，不进入中央线程；`run.failed(error_code=agent_run_stale_worker_lost)` 会立即结束“正在思考”，展示后端中断和可重试状态。`tool.*` 事件按 `tool_call_id` 匹配后端返回的 ToolCall，并在同一线程位置以轻量折叠块展示业务化工具名称、执行状态和关键参数摘要；如果 ToolCall 详情尚未 hydrate，页面会先用 `tool.*` 事件生成临时工具调用卡，详情到达后用后端 ToolCall 替换。同一个 `tool_call_id` 的连续 `tool.planned/running/effect_committed/result_observed` 只更新同一张工具卡，不提示重复提交。ToolCall 展开后展示 redacted input/output、权限和恢复信息；ToolCall 折叠块默认收起。`report.read_summary` 的结构化摘要（最近报告、失败样本、状态统计和返回页内用例通过率）属于 ToolCall output，从 ToolCall 详情读取，不升级成新的顶层报告 API。`tool.result_observed` 表示工具结果已经回灌给下一轮模型上下文，UI 继续等待后续 `model.delta` 或 `run.completed`，不会把工具卡本身当成最终 assistant 回复。模型内部 `agent_tool_request` 代码块、包含 `tool_name` 的工具请求 JSON、`requested_tool=true` 的 `model.completed`、`model.tool_request_*`、`model.required_tool_*`（可能携带 `after_tool` 与 `required_tool` 说明漏调用修复）、`context.*`、`loop.*` 和 `memory.*` 都属于 Agent loop 审计事实，不作为普通 Agent 回复或中央事件卡显示。`context.history_compacted`、`context.decision_context_bound` 和 `loop.observed` 只进入 timeline/debug、Inspector、summary 或导出数据；中央线程不展示 `project_id`、`item_id`、`context_build_id` 等后端机器标识，也不提供低层 raw payload 展开。

SSE 使用 `requestEventStreamWithAuth`，带 Bearer Token、`Accept: text/event-stream` 和按 run 独立保存的 `Last-Event-ID`；新 run 不继承上一 run 的 cursor。事件解析兼容 `event:` 字段、heartbeat 和 data 内携带 `event_type`、`item_id`、`model_response_item_id` 的 EventStore 回放格式；`item_id` 只作为 timeline/debug/download identity 和 React key，不作为 SSE cursor。事件流异常中断后最多自动重连 3 次，每次携带当前 run 最后收到的事件序号；如果断线、空流或只有 heartbeat，则通过 `/agents/runs/{run_id}/events/snapshot?after_sequence={seq}` 按 `next_after_sequence` 补拉，并把 `context_compactions` 作为审计/debug 标记。`tool.*` 事件会拉取 ToolCall 详情；`approval.*`、`migration.*`、`context.*`、`loop.*` 和 `memory.*` 事件会刷新对应二级资源；terminal 后优先读取 `/agents/runs/{run_id}/summary` 校准最终状态和 `assistant_message`，并读取 `/actions` 刷新主操作，summary 不可用时回退 Run 详情。

创建 Run 前必须选择项目。前端生成并复用本地 `conversation_id` 支持多轮 prompt；只有点击“新建对话”才生成新的本地 conversation id。后端已经提供服务端 conversation/run list、transcript 和 export 契约，但当前页面历史列表仍保存本地 history index，服务端列表接入是下一阶段工作；本地 history 按 `conversationId || runId` 去重，同一会话继续发送 prompt 时会以最新 run 更新原会话记录，而不是新增一条历史对话。多轮归并以发起本轮请求时的本地 conversation 为准，即使后端创建响应或 Run 详情临时返回了不同 `conversation_id`，当前页面也不会因此拆出新的历史卡片；中央线程同样以该本地 conversation 为边界保留多轮 turn，第二个问题会追加到第一轮问答下方，而不是清空第一轮内容。服务端 transcript 的 `turns[].assistant_message` 只有在 `assistant_visible` 未显式为 `false` 时才会在 API 层合成为可渲染 Agent 回复；`context_compactions` 只进入审计/debug 标记，不生成 assistant 气泡。如果 transcript 只提供 run 摘要，页面合并时保留本地已收到的完整事件和治理资源，避免摘要刷新把上一轮回复清空。左侧导出在有 `conversation_id` 时优先调用服务端 export，保留所有后端 `item_id`；接口失败时才回退本地已加载 events/tool_calls。只有用户显式点击“新建对话”才开始新的本地会话。用户打开或创建某个 run 后，左侧历史对该 active run 优先展示后端详情或 SSE 校准后的实时状态，并把该状态同步回本地 history，避免本地旧 `failed` 状态覆盖正在运行或正在思考的任务。前端不直接调用模型、不绕过权限，也不推断审批或迁移结果。`migration_blocked`、`uncertain`、`approval.superseded` 等高风险状态会以警告或危险语义展示。Approval approve/reject 必须在内部提交 `input_hash`、`runtime_snapshot_id`、`resource_scope_hash`、`approval_lineage_id` 和 `approval_epoch`，但底部审批确认条、审批卡片和普通工作区不把这些 CAS/hash 字段作为用户可见摘要；用户点“是”时调用 approve 后立即触发 run resume，用户点“否”时调用 reject 并提交拒绝原因。RunInspector 和左侧主按钮按 `/actions.primary_action_ids` 展示后端给出的主动作，只用 `enabled` 决定是否可点；`resource_ids` 用于业务详情接口，`resource_item_ids` 用于定位 timeline/debug item，其中 `review_approvals` 高亮目标 ToolCall 而不是 approval 记录自身。Runbook safe actions 以后端返回为准，只将 `resume`、`reconcile` 和 `tool_call_detail` 映射到已存在操作，其他 action 展示为目标契约限制。

Approval 状态合并不能把旧 pending 当作本地权威。页面只在后端 run snapshot 暂时返回空 `approvals` 且当前仍非终态时保留 pending 审批条防闪烁；如果 `/approvals`、run 详情或 transcript 返回同一 approval/tool_call 的非 pending 状态，前端必须覆盖旧状态并移除可点击审批入口，避免对同一审批重复发送 approve/reject 并触发后端 `approval_stale_or_superseded`。

Composer 支持 Enter 直接发送，Shift+Enter 保留换行；Run 创建成功后立即清空输入框，并以本次提交的 intent 固定用户气泡。尚未发送目标时，中央空状态提示为“我们应该做什么”；用户发送消息并创建 Run 后，该空状态提示立即消失。等待后端返回 assistant 可见内容或终态前，中央线程展示“正在思考”动效和耗时计数；工具调用可以先展示为业务化 ToolCall 折叠块，`tool.result_observed` 只作为审计事实更新二级资源，不会单独结束等待态，也不会生成新的中央消息。收到正常 assistant 回复、终态或错误后该等待态消失，线程继续展示真实后端业务结果。

快捷键支持：`Ctrl/Meta + Enter` 发送、`Ctrl/Meta + .` 停止、`Ctrl/Meta + K` 聚焦历史搜索、`Ctrl/Meta + N` 新建本地对话。时间线在新事件、ToolCall、Approval 或 Migration 到达时自动滚动到最新内容。

### 全局列表分页

业务主列表统一使用 `src/components/Pagination.tsx` 提供的分页控件和 `usePagination` 状态逻辑。当前已覆盖接口测试用例、项目、环境、测试计划、计划执行历史、场景列表、执行队列和缺陷列表。

- 表格或卡片主列表默认每页 10 条，环境和场景侧栏默认每页 6 条。
- 标准分页展示当前记录范围、总数、每页条数、页码、上一页和下一页；窄侧栏使用紧凑模式。
- 搜索、状态筛选、请求方式筛选或项目切换后自动返回第一页。
- 删除最后一页的最后一条记录后，当前页自动回退到仍然存在的最后一页。
- 当前接口返回完整数组时使用客户端分页；后端升级为 `page`、`page_size` 和 `total` 后继续复用同一分页控件，仅替换数据加载层。
- 步骤、参数、请求头、变量编辑器及报告指标等局部短列表不分页，避免打断连续编辑和分析。

## 认证与 Token 刷新

### 登录态保存

登录成功后前端会在 `localStorage` 中保存：

| key | 说明 |
| --- | --- |
| `access_token` | 请求受保护接口时使用 |
| `refresh_token` | access token 临近过期时刷新使用 |
| `token_type` | 当前为 `bearer` |
| `auth_user` | 后端返回的当前用户信息 |

### 主动刷新规则

`requestWithAuth` 发起请求前会解析 `access_token` 的 JWT `exp` 字段。当 access token 距离过期不足 5 分钟时，会先调用刷新接口：

```http
POST /auth/refresh
Content-Type: application/json

{
  "refresh_token": "<refresh_token>"
}
```

刷新成功后会更新本地 `access_token`，如果后端同时返回新的 `refresh_token`、`token_type` 或 `user`，也会同步更新。

为了避免同一时间多个接口重复刷新，前端使用单例 `refreshPromise` 合并并发刷新请求。

`src/api/client.ts` 还会对 dashboard、metrics、alerts、release gates、项目列表和环境配置等首屏只读端点复用同一个 in-flight Promise，避免 React StrictMode、重复挂载或父子组件同时触发时重复请求这些稳定摘要数据。该复用只在请求仍处于 in-flight 状态时生效，请求结束后下一次 GET 会重新访问后端；普通业务列表、POST、PUT、PATCH、DELETE、带 body、带 `AbortSignal` 的请求和 SSE 请求保持独立，避免合并用户操作、局部列表加载或流式事件。

### 401 处理规则

任意受保护接口返回 `401` 时，前端会：

1. 读取后端错误信息，默认文案为“登录凭证已过期，请重新登录”。
2. 清除 `access_token`、`refresh_token`、`token_type`、`auth_user`。
3. 派发 `auth:expired` 事件。
4. 跳转到登录页。

因此业务页面不需要单独处理 token 过期跳转，只需要通过统一 API 客户端请求接口。

## 项目与环境选择

顶部栏维护当前项目和当前环境。

| 选择项 | 数据来源 | 影响范围 |
| --- | --- | --- |
| 当前项目 | `/projects` | 环境列表、测试计划、接口用例列表、可视化流程、环境配置页、变量和执行接口 |
| 当前环境 | `/environment-configs?project_id={projectId}` | 测试计划新建/运行默认环境、接口用例过滤、变量展示、用例调试和运行 |

切换项目后，会重新加载该项目下的环境。切换环境后，接口测试用例页会只展示绑定了当前环境的用例。

## 环境配置页

页面入口为 `/environments`，主文件为 `src/pages/EnvironmentConfigsPage.tsx`。

### 核心数据

环境配置使用 `src/api/environmentConfigs.ts` 封装：

| 接口 | 方法 | 说明 |
| --- | --- | --- |
| `/environment-configs?project_id={projectId}` | `GET` | 查询环境列表 |
| `/environment-configs?project_id={projectId}` | `POST` | 新建环境 |
| `/environment-configs/{environmentId}?project_id={projectId}` | `PUT` | 更新环境 |
| `/environment-configs/{environmentId}?project_id={projectId}` | `DELETE` | 删除环境 |
| `/environment-configs/{environmentId}/variables?project_id={projectId}` | `GET` | 查询环境变量 |
| `/environment-configs/{environmentId}/variables?project_id={projectId}` | `POST` | 新增或更新环境变量 |
| `/environment-configs/{environmentId}/variables/{variableId}?project_id={projectId}` | `DELETE` | 删除环境变量 |
| `/environment-configs/{environmentId}/test-cases?project_id={projectId}` | `GET` | 查询当前环境绑定的用例 |

### 页面布局

环境配置页采用三栏展示：

1. 左侧环境列表：显示环境名称和 Base URL，点击只切换当前展示环境。
2. 中间环境卡片：显示环境详情、统计信息，并提供编辑和删除按钮。
3. 右侧详情区：显示当前环境变量和绑定用例。

点击左侧环境列表或中间环境卡片本身，只切换当前环境，不弹出编辑弹窗。只有点击“新建环境”或明确点击编辑按钮时，才打开新增/编辑环境弹窗。

### 环境变量

环境变量用于接口请求中的变量替换，使用 `{{变量名}}` 引用，例如：

```text
Authorization: Bearer {{access_token}}
```

敏感变量表示变量值不应明文展示，通常用于 token、密码、密钥等数据。前端展示敏感变量时会进行脱敏，保存时仍按真实值提交给后端。

变量支持：

- 新增
- 编辑
- 删除
- 敏感变量标记
- 当前环境切换后展示对应环境的变量

## 测试计划页

页面入口为 `/plans`，主文件为 `src/pages/PlansPage.tsx`，前端数据边界封装在 `src/api/plans.ts`。

测试计划定义、调度实例和运行历史均由后端接口维护。页面只调用 `src/api/plans.ts`，由适配层负责 snake_case 响应映射和乐观锁版本。

### 当前功能

| 功能 | 当前实现 |
| --- | --- |
| 计划列表 | 按名称、说明、标签搜索，按状态和触发方式筛选 |
| 计划维护 | 新建、编辑、复制、删除、启用和停用 |
| 执行资产 | 加载当前项目 Scenario，并绑定明确场景版本，可排序和移除 |
| 执行配置 | 多环境绑定、串行/并行、失败停止/继续、重试、超时、通知邮箱和标签 |
| 触发方式 | 手动触发、Cron 定时、Webhook 配置；Cron 模式可选择每天执行时间并自动生成表达式 |
| 调度日历 | 展示后端生成的未来 14 天真实 Cron 调度实例 |
| 手动运行 | 选择计划绑定环境后创建 `pending` 后端运行，并跳转执行历史 |
| 执行历史 | 展示运行状态、目标统计、耗时、环境和操作人，支持删除单条和清空 |
| 导入导出 | 导出当前项目完整计划 JSON；导入后强制归属当前项目并默认停用 |

测试计划必须至少绑定一个环境和一个 Scenario 才能保存。切换项目后会重新请求对应项目计划，后端负责项目隔离、环境归属和场景版本校验。

测试计划完整架构、数据模型、版本控制、调度和执行边界见 `test-plan-architecture.md`。

## 场景组合页

页面入口为 `/scenarios`，主文件为 `src/pages/ScenariosPage.tsx`，前端数据边界封装在 `src/api/scenarios.ts`。

当前支持按项目新建、编辑、复制和软删除场景；引用 HTTP 与 WebSocket 测试用例；通过 AI 智能组合生成场景草稿；加入条件和等待步骤；调整步骤顺序与失败策略；维护请求数据驱动、步骤断言、响应取值和上下游变量绑定；执行单步骤调试并查看结构化响应。

顶部“AI 组合”按钮调用：

```http
POST /ai/skills/scenario-composer/runs
GET /ai/skill-runs/{run_id}/events
GET /ai/skill-runs/{run_id}
```

请求体固定使用 `operation=compose`，并提交 `project_id`、`environment_id` 与 `input`。`input` 包含自然语言 `requirement`、可选 `scenario_name`、候选 `http_test_case_ids` / `websocket_test_case_ids`、`include_bindings`、`include_assertions`、`include_hooks`、`include_datasets`、`include_latest_execution`、`execute_candidates` 和 `max_nodes`。`execute_candidates` 默认关闭；开启时页面要求用户勾选二次确认，因为它会真实调用候选用例接口。

候选 HTTP/WebSocket 用例支持多选、分组全选或清空和排序，已选顺序会原样提交给后端作为编排提示。选择器展示最近执行状态、提取器数量和断言数量。创建 AI Skill Run 后，页面用带鉴权 Header 的 `fetch` 消费 SSE：`model.delta` 文本、`run.*`、`step.*` 和 `tool.*` 事件合并展示在同一条“AI 流式输出”中，工具调用不再拆成独立调用历史，最新返回内容会自动滚动到可见位置；`heartbeat` 只用于维持连接，不作为业务进度展示。若 SSE 中断，页面查询 run 快照恢复最终 `result` 或 `error_message`。`run.completed` 后前端展示“AI 生成结果预览”，单独列出 `warnings`、场景摘要、节点顺序、前后置动作、主用例 config、提取器、变量绑定和断言；提取器、变量绑定和断言在节点卡片中以结构化短行展示，原始复杂配置保留在可展开的 config 详情中；用户点击“确认保存场景”后才调用 `POST /scenarios?project_id={project_id}` 创建正式场景。

场景画布以测试用例节点为基本单位。左侧只添加 HTTP/WebSocket 主测试用例；每张画布用例卡直接提供前置和后置入口，弹窗明确显示绑定的测试用例。前置、后置动作不会成为场景全局阶段，也不能脱离节点存在。删除主测试用例会连同其绑定动作一起删除。画布连线只连接主测试用例节点，节点内部的前置动作、后置动作、响应取值、变量引用和工具信息不参与连线；节点内前置/后置动作按位置汇总到主测试用例卡片底部的分组摘要，标题展示动作数量和状态计数，默认收起，展开后在主卡片内部滚动展示。节点内明细默认折叠，展开后在明细区域滚动展示。

场景响应中的 `environment_name` 会随场景模型保留，用于页面标题、预览和调试记录展示。调试记录自身未返回环境名时，列表标题使用所属场景的 `environment_name` 作为展示兜底，避免已命名环境显示为“未命名环境”。

前后置动作支持执行 HTTP/WebSocket 测试用例、条件判断、等待、随机值、固定 JSON 值和沙箱脚本。随机值可生成整数、字符串或 UUID；固定值保留 JSON 原始类型；脚本声明语言、输入变量、输出变量、代码与超时。脚本区使用 CodeMirror 代码编辑器，提供行号、括号匹配、自动闭合和 Python/JavaScript 语法高亮，并显示 UTF-8 字节计数。自动补全候选限制为当前脚本声明的输入/输出变量、Python 沙箱安全函数和受支持关键字；名称右侧展示“前置节点输入变量”“脚本输出变量”“安全函数”等中文说明，不推荐私有名称、`print` 或其他禁用能力。脚本动作可从检查器标题栏单独调试，调试输入 JSON 只作为本次执行的 `input_values` 提交，不保存到场景配置。

脚本输入只能引用执行位置之前已声明的响应取值或动作输出，界面提供可用变量快捷选择；缺少任一输入时后端不会执行并提示 `Script inputs are unavailable`。前端在保存和运行前校验变量名、输入可用性、`1～60000 ms` 超时、`100 KB` 代码上限、顶层 `return` 以及明显禁用语法，并在编辑器下方就地展示错误。脚本调试允许用户手工提供输入值验证逻辑，但不会放宽保存和整场运行的变量来源校验。输出通过直接赋值而不是 `return` 产生，未赋值输出为 `null`，最终值必须能转换为 JSON。后端继续负责完整沙箱语法、输入/输出各 `1 MB`、超时和安全边界校验；JavaScript 执行依赖服务器安装 Node.js。

响应取值路径允许使用前置变量作为路径片段，例如 `data.items.{{rowIndex}}.id`。HTTP/WebSocket 单步调试展示取值结果时，页面会优先使用最近整场运行返回的前置动作输出，其次使用固定值配置、脚本调试输出或上游响应调试值解析路径模板；没有可用真实值时显示“路径变量未解析”，不把模板当作字面路径查找。

条件和等待步骤不要求用户直接维护 JSON：

- 条件步骤通过判断变量、比较方式、值类型和期望值生成 `expression`。
- 等待步骤通过等待时长和毫秒/秒/分钟单位生成 `duration_ms`。
- 已有常用条件表达式会回填结构化表单；复杂表达式原样保留，页面不展示原始步骤 JSON，用户修改后转换为标准条件配置。
- 表单修改同时更新画布步骤摘要，保存和执行仍使用原有后端配置字段。

### 请求数据驱动

- 中间区域从每个场景步骤的真实请求配置中展开 Path、Header、Query 和 Body 字段。
- JSON Body 按完整路径展开，支持任意深度对象和数组字段，用户无需手写多层路径。
- 数据集是测试记录的容器；一条测试记录包含本次运行涉及的全部请求覆盖值。
- 每条启用测试记录产生一次独立场景运行，同一字段可以在不同记录中输入不同 JSON 类型值。
- 点击数据集列表项后，右侧场景配置区切换为数据集配置，维护名称、启停、测试记录、复制和删除。
- 页面不再展示旧的“附加变量 JSON”维护入口；兼容变量仍由 API 模型保留，不作为主要数据驱动编辑方式。
- “可选请求字段”“已驱动字段”“运行数据组”“请求覆盖字段”“测试记录”等统计入口必须可定位到对应模块；没有独立模块时使用详情弹窗解释和展示数据。

完整数据结构和覆盖顺序见 `scenario-data-driven-contract.md`。

### 单步与整场状态

单步调试结果会直接反馈到画布节点：通过为浅绿色，失败、错误、超时或取消为浅红色，并展示“单步失败 · 耗时”。HTTP 和 WebSocket 调试响应在结果卡内直接预览关键响应字段，并可展开完整响应后转为断言或响应取值；脚本调试使用“调试结果”卡直接预览输出变量映射，仅用于查看本次脚本结果，展开入口用于查看完整大数据。启动整场运行后，SSE 实时状态优先于单步临时状态，避免历史调试颜色覆盖真实执行进度。

### 页面展示原则

- 顶部命令栏粘性展示流程设计、数据驱动、调试记录、场景版本和主要操作。
- 运行是主按钮，保存是次级按钮；复制和删除不与运行争夺视觉焦点。
- 移除与场景标题摘要重复的顶部统计卡，场景数量由左侧列表表达，步骤、数据集和运行时间由场景标题摘要表达。
- 左侧常驻保留主测试用例列表并支持搜索和直接添加；工具、脚本及其他动作从画布测试用例节点进入，弹窗锁定当前节点与前置/后置位置，并支持遮罩、关闭按钮和 Esc 退出。
- 三栏区域各自滚动，左右辅助面板保持等宽，中间画布获得剩余弹性宽度；右侧配置标题在滚动时保持上下文。
- 步骤卡使用状态色条和轻量阴影表达选中、运行、通过、失败和跳过。
- 节点内前置/后置动作使用主测试用例卡片内的紧凑分组承载；主测试用例卡保持最高层级，动作分组不得在主卡片外撑开节点到难以扫描。
- 请求配置默认收起并在标题展示协议摘要，展开后编辑 Path、Header、Query 和 Body；切换步骤后恢复默认收起。
- 单步骤执行收进右侧配置标题栏；执行完成后在配置区展示紧凑响应摘要，不自动打开弹窗，也不展示只读的“引用测试用例”字段。
- 响应摘要展示真实状态、耗时、HTTP 状态码和结构化数据数量；点击“展开”打开完整响应弹窗，弹窗字段可直接转换为取值变量或断言。
- 步骤配置中的“断言”默认收起，折叠标题展示断言数量；切换步骤后恢复默认收起，展开后才能新增和编辑断言。

整场执行采用异步模式：`POST /scenarios/{scenario_id}/execute` 返回 HTTP `202` 和 run 列表，前端随后使用带 Bearer Token 的 `fetch` 订阅 `/scenario-runs/{run_id}/events`。节点状态由 `step_started`、`step_completed`、`step_failed` 和 `step_skipped` 驱动；节点之间的流动动画只由 `transition_started` 驱动，不使用本地定时器模拟执行进度。

事件流中断后前端最多自动重连 3 次，每次携带最后已接收序号作为 `Last-Event-ID`，并按 `run_id + sequence` 忽略重复重放。检测到序号缺口时立即查询运行详情校准画布；服务端返回 `409 EVENT_HISTORY_EXPIRED` 时停止重连并切换到详情恢复。连接中断、恢复、校准和历史过期都会显示可关闭提示。

一次执行产生多个数据集或测试记录 run 时，前端按 `run_id` 分别保存实时进度、运行状态和连接提示。流程设计区显示“当前画布运行”切换器，多数据集或多测试记录使用“数据集 · 测试记录”标识当前观察对象；单数据集单记录只展示数据集名，并以“单条测试记录”作为副标题，避免把记录名称误认为第二个数据集。切换后节点状态、步骤详情和连接提示同步更新。启动响应、事件、运行列表和详情中的 `dataset_id`、`record_id`、`record_name` 都会保留，运行历史因此可以审计同一数据集中的不同测试记录。

运行结束、重连耗尽或事件历史过期后，前端查询 `/scenario-runs/{run_id}` 获取权威详情；非终态运行继续轮询直到结束。运行历史展示实际请求、响应、断言、错误、提取变量和解析后的绑定值。单步调试提取值可以更新上游输出展示，但不会被当作下游已实际使用的绑定值。

场景更新携带当前 `version`，执行接口支持环境、数据集和幂等键。完整实现见 `scenario-composer-architecture.md`，数据驱动见 `scenario-data-driven-contract.md`，实时事件和运行数据结构见 `scenario-run-events-contract.md`、`scenario-run-detail-contract.md` 与 `scenario-variable-tracing-contract.md`。

## 接口测试用例页

页面入口为 `/api`，主文件为 `src/pages/ApiPage.tsx`。

页面统一展示 HTTP 与 WebSocket 两类接口测试用例，但两类用例使用完全独立的后端接口、数据表和执行记录。

### WebSocket 测试用例

WebSocket 用例复用项目环境、环境变量、项目权限以及页面的列表和调试结果展示风格。后端当前未提供
WebSocket AI 生成或 AI 扩展接口，因此前端不展示 WebSocket AI 扩展入口。

新增或编辑 WebSocket 用例时维护：

| 字段 | 说明 |
| --- | --- |
| WebSocket 路径 | 完整 `ws://`、`wss://` 地址可不绑定环境；相对路径必须绑定环境 |
| Headers | 连接握手请求头 |
| 子协议 | 多个子协议使用逗号分隔 |
| 连接超时 | `connect_timeout_ms`，必须大于 0 |
| 接收超时 | `receive_timeout_ms`，必须大于 0 |
| 接收数量 | `receive_count`，执行器接收的消息数量 |
| 发送消息 | `messages` 数组，按顺序发送，类型支持 `text`、`json` |
| 提取器 | 从指定响应消息 JSON 路径提取变量 |
| 断言、响应 | 与 HTTP 用例保持一致的编辑与展示方式 |

WebSocket 后端接口集中封装在 `src/api/apiCases.ts`：

| 接口 | 方法 | 说明 |
| --- | --- | --- |
| `/websocket-test-cases` | `GET` | 查询 WebSocket 用例列表 |
| `/websocket-test-cases` | `POST` | 新增 WebSocket 用例 |
| `/websocket-test-cases/{id}` | `PUT` | 编辑 WebSocket 用例 |
| `/websocket-test-cases/{id}/execute` | `POST` | 执行已保存 WebSocket 用例 |
| `/websocket-test-cases/execute-unsaved` | `POST` | 调试未保存 WebSocket 用例 |
| `/websocket-test-cases/batch-execute` | `POST` | 批量执行 WebSocket 用例 |

页面分别请求 `/test-cases` 和 `/websocket-test-cases`，完成映射后合并展示。

### 数据加载

接口用例列表通过以下接口加载：

```http
GET /test-cases?project_id={projectId}
```

前端会对后端返回字段做兼容映射：

| 前端字段 | 后端兼容字段 |
| --- | --- |
| 用例 ID | `id`、`test_case_id` |
| 用例名称 | `name`、`title` |
| 请求方式 | `method` |
| 路径 | `path`、`url` |
| 状态 | `status` |
| 最近执行状态 | `last_execution_status`、`last_run_status`、`latest_execution_status`、`execution_status`、`last_execution.status`、`latest_execution.status`、`last_result.status` |
| 更新时间 | `updated_at`、`last_execution_time`、`last_executed_at`、`created_at` |
| 单环境绑定 | `environment_id` |
| 多环境绑定 | `environment_ids`、`bound_environment_ids`、`environment_config_ids`、`environments`、`environment_configs` |

如果后端只返回单个 `environment_id`，前端会自动放入 `environmentIds` 中，用于统一处理过滤和展示。

列表中的用例编号来自 `case_no`、`code`、`serial_no` 等展示字段，可能重复，不能作为前端记录身份。React 列表 key、编辑后替换、运行中状态和删除状态统一优先使用“协议类型 + 后端主键”；只有尚无后端主键的临时记录才回退到展示编号。编辑接口返回部分数据且未携带主键或展示编号时，前端必须保留编辑前记录的身份字段，避免误替换其他同编号用例。

### 列表过滤

接口用例列表支持以下过滤：

| 过滤项 | 逻辑 |
| --- | --- |
| 当前环境 | 只展示 `environmentIds` 包含顶部当前环境 ID 的用例 |
| 用例标题 | 按用例名称模糊匹配 |
| 请求方式 | 支持多选，包含 GET、POST、PUT、PATCH、DELETE、HEAD、OPTIONS |
| 状态 | `全部`、`已启用`、`草稿` |

“全部 / 已启用 / 草稿”是真实过滤逻辑，不是静态文案。

### 列表展示

列表当前展示字段：

| 字段 | 说明 |
| --- | --- |
| 用例名称 | 显示用例名称和编号 |
| 接口 | 显示请求方式标签和 path |
| 用例所属环境 | 多环境绑定时展示多个环境名 |
| 状态 | 已启用或草稿 |
| 最近执行状态 | 通过、失败或未执行 |
| 更新时间 | 后端时间格式化后的结果 |
| 操作 | 运行按钮 |

点击表格行进入编辑弹窗，点击运行按钮只运行该条已保存用例。

接口用例列表默认每页展示 10 条。分页基于筛选后的结果计算，总数区域仍展示完整用例数量或筛选命中数量；切换标题、请求方式或状态筛选时返回第一页。

### 多环境绑定

一个用例可以绑定多个环境。新增或编辑用例时，“用例所属环境”使用多选按钮展示当前项目下的环境。

保存时前端会提交：

```json
{
  "environment_id": 1,
  "environment_ids": [1, 2]
}
```

字段含义：

| 字段 | 说明 |
| --- | --- |
| `environment_id` | 当前主环境或调试环境，用于兼容后端旧接口和执行接口 |
| `environment_ids` | 当前用例绑定的所有环境 ID |

列表过滤使用 `environment_ids` 判断是否属于当前环境。执行用例时优先使用顶部当前环境；如果当前环境不在用例绑定环境中，则使用该用例绑定的第一个环境。

### 新增与编辑弹窗

新增/编辑弹窗维护以下内容：

| 区域 | 功能 |
| --- | --- |
| 基础信息 | 用例名称、用例所属环境、状态 |
| 请求行 | 请求方式和 URL/path |
| Params | Query Params |
| Headers | 请求头 |
| Body | JSON、Form Data、x-www-form-urlencoded、Raw Text |
| 断言 | 状态码、响应字段、业务规则等断言 |
| 响应 | 调试结果或已保存响应展示 |

保存前会校验项目、环境、用例名称、请求地址等必要字段。

编辑保存成功后只更新后端主键匹配的当前记录。即使列表中存在相同展示编号，也不得连带覆盖其他用例；刷新前后的列表记录应保持一致。

### GET URL 自动转换 Params

当请求方式为 `GET`，用户在 URL 中输入查询字符串时，例如：

```text
https://app.example.com/api/statistics?start_date=2026-05-31&end_date=2026-06-04
```

前端会自动解析 `?` 后面的查询参数，并转换为 Params 表格：

| Key | Value |
| --- | --- |
| `start_date` | `2026-05-31` |
| `end_date` | `2026-06-04` |

URL 输入框保留去掉查询字符串后的 path/base URL，Params 参与保存和调试提交。

### 调试未保存用例

弹窗中点击“调试”会提交当前编辑内容，不要求先保存：

```http
POST /test-cases/execute-unsaved?project_id={projectId}
```

请求体使用当前表单内容生成，包括：

- `environment_id`
- `environment_ids`
- `method`
- `path`
- `headers`
- `query_params`
- `body_type`
- `body`
- `assertions`
- `extractors`

后端返回的执行结果会保存在弹窗内展示，不会自动覆盖用例定义。

### 调试响应展示

后端返回执行结果后，弹窗使用 Tab 展示：

| Tab | 内容 |
| --- | --- |
| 请求快照 | 后端实际执行的 URL、method、headers、body、body_type 等 |
| 响应头 | `response_snapshot.headers` |
| 响应 Body | 优先展示 `response_snapshot.json`，没有 JSON 时展示 `response_snapshot.body` |
| 断言结果 | `assertion_results` |

WebSocket 执行结果读取 `session_snapshot` 和 `response_snapshot`，接收消息在响应 Body 页签展示；
断言结果汇总显示 `pass`、`notpass` 或“暂无断言结果”。

顶部会展示 HTTP 状态码、执行状态和耗时，例如 `HTTP 200`、`passed`、`2255ms`。

### 运行已保存用例

列表中点击“运行”会调用：

```http
POST /test-cases/{testCaseId}/execute?project_id={projectId}&environment_id={environmentId}
```

运行完成后前端会更新该条用例的最近执行状态和更新时间。

### AI 生成测试用例

接口测试用例页提供“AI生成测试用例”按钮。入口要求当前已经选择项目和环境。

前端优先调用后端 skill runner：

```http
POST /ai/skills/http-test-case/run
```

请求体使用 `operation=generate`，并把表单内容放入 `input`：

```json
{
  "operation": "generate",
  "project_id": "{projectId}",
  "environment_id": "{environmentId}",
  "input": {}
}
```

如果后端部署尚未提供 skill 路由，前端会兼容退回历史接口：

```http
POST /ai/test-cases/generate?project_id={projectId}&environment_id={environmentId}
```

请求体字段：

| 字段 | 说明 |
| --- | --- |
| `interface_text` | 用户粘贴的接口文档、curl、URL、请求参数、响应示例或业务说明 |
| `request_method` | 用户选择的请求方式；选择“自动识别”时不传 |
| `generate_count` | 生成数量，前端限制为 1 到 10 |
| `include_assertions` | 是否要求 AI 生成断言 |
| `extra_requirements` | 用户补充的覆盖范围或生成要求 |

后端 AI 接口只返回测试用例草稿，不直接落库。前端弹窗会展示：

- 生成摘要。
- 生成警告。
- 可勾选的测试用例草稿列表。
- 每条草稿的名称、描述、请求方式和 path。

用户点击“保存所选用例”后，前端会对选中的草稿逐条调用现有新建用例接口：

```http
POST /test-cases?project_id={projectId}
```

保存前前端会补齐并规范化以下字段：

- `environment_id`
- `environment_ids`
- `method`
- `path`
- `headers`
- `query_params`
- `body_type`
- `body`
- `assertions`
- `extractors`

保存成功后，新增用例会插入当前接口用例列表，并继续受当前环境过滤规则约束。

### AI 扩展已有测试用例

接口测试用例列表的每一行在“运行”按钮旁提供“AI扩展”按钮。该功能只对已经保存、拥有后端 ID 的测试用例生效。

前端优先创建可观测的后端 AI Skill Run，和 AI 场景组合使用同一套流式执行展示：

```http
POST /ai/skills/http-test-case/runs
GET /ai/skill-runs/{runId}/events
GET /ai/skill-runs/{runId}
```

创建 run 时使用 `operation=expand`，并通过 `source_id` 传入源测试用例 ID：

```json
{
  "operation": "expand",
  "project_id": "{projectId}",
  "environment_id": "{environmentId}",
  "source_id": "{testCaseId}",
  "input": {}
}
```

`environment_id` 可选；不传时后端使用源用例默认环境或第一个关联环境。运行中页面会消费鉴权 SSE，把 `model.delta`、`run.*`、`step.*` 和 `tool.*` 事件合并展示在同一条“AI 流式输出”中；工具调用不再隐藏在纯等待态里。`run.completed` 后读取 `result` 并展示结构化草稿，若 SSE 中断则查询 run 快照恢复最终 `result` 或 `error_message`。如果后端部署尚未提供 run 路由，前端会兼容退回历史接口：

```http
POST /ai/test-cases/{testCaseId}/expand?project_id={projectId}&environment_id={environmentId}
```

请求体字段：

| 字段 | 说明 |
| --- | --- |
| `requirement` | 用户填写的自然语言扩写要求 |
| `generate_count` | 扩写数量，前端限制为 1 到 10 |
| `expansion_types` | 扩写类型，例如空值、类型错误、缺少参数、额外参数、长度溢出、格式错误 |
| `include_assertions` | 是否要求 AI 生成断言 |

后端返回的是测试用例草稿，不直接落库。前端弹窗会展示：

- 源测试用例名称、请求方式和 path。
- 扩写要求、扩写数量、扩写类型和是否生成断言。
- AI Skill Run 的流式模型输出、工具调用、步骤事件、扩写摘要和 warnings。
- 可勾选的扩展用例草稿列表。
- 每条草稿使用与编辑测试用例弹窗一致的结构化编辑样式展示：顶部维护用例名称、说明、请求方法和 path；下方通过 `Params`、`Headers`、`Body`、`断言` 标签页编辑 Key/Value 行、Body 类型和断言规则。除 JSON Body 自身外，不再要求用户直接编辑整段 JSON 草稿。

用户点击“保存所选用例”后，前端逐条调用现有新建用例接口：

```http
POST /test-cases?project_id={projectId}
```

保存成功后，扩展出的用例会插入当前接口用例列表，并继续受当前环境过滤规则约束。

## 接口用例页中的环境变量

接口测试用例页也支持维护当前环境变量，入口为“新增变量”。

逻辑与环境配置页一致：

- 变量属于顶部当前环境。
- 新增变量后会展示在已有变量列表中。
- 已有变量支持编辑和删除。
- 敏感变量展示时脱敏。
- 变量可在请求参数、Headers、Body 中通过 `{{变量名}}` 引用。

新增或编辑变量调用：

```http
POST /environment-configs/{environmentId}/variables?project_id={projectId}
```

删除变量调用：

```http
DELETE /environment-configs/{environmentId}/variables/{variableId}?project_id={projectId}
```

## 缺陷跟踪页

页面入口为 `/defects`，主文件为 `src/pages/DefectsPage.tsx`，前端数据边界封装在 `src/api/defects.ts`。

缺陷模块用于记录 Bug 和推进 Bug 生命周期。缺陷按当前项目隔离，页面未选择项目时禁止新建，并提示先选择项目。

### 当前功能

| 功能 | 当前实现 |
| --- | --- |
| 缺陷列表 | 只展示标题、状态、紧急程度、类型、更新时间、指派人和提出人，不展示正文、附件、编辑或删除按钮 |
| 缺陷详情 | 点击摘要进入 `/defects/{id}`，读取单条详情并展示正文、附件、状态流转、编辑和删除入口 |
| 新建与编辑 | 新建从列表进入，编辑仅从详情进入；维护标题、指派人、类型、紧急程度、状态、内容和附件 |
| 富文本内容 | 使用富文本编辑框维护 `content_html`，支持加粗、斜体和列表；粘贴截图插入当前光标位置，以 `/__defect_media__/{id}` 相对占位地址持久化，不保存临时图片 URL |
| 正文图片预览 | 详情页双击正文图片打开灯箱；多图按正文顺序使用左右按钮或键盘方向键循环切换，Esc、关闭按钮或遮罩关闭 |
| 图片附件 | “选择图片”添加独立附件；粘贴图片作为正文内嵌媒体且不在附件区重复展示；保存时统一提交 `media_ids`，地址过期后刷新 |
| 状态流转 | 列表三点菜单收纳下一状态，打开菜单时提升当前记录层级以完整覆盖相邻卡片；详情页提供流转按钮，调用 `/defects/{id}/status?project_id={projectId}` |
| 删除缺陷 | 仅在详情页提供，二次确认后调用 `/defects/{id}?project_id={projectId}` 删除 |

缺陷状态包括：新创建、已激活、已确认、已修复、已验证、已关闭和重新激活。前端流转按钮表达推荐流程，最终合法性由后端接口校验。

富文本内容在前端提交和预览前会做基础清洗，移除脚本、事件属性和不安全 URL；服务端仍进行最终 HTML 清洗、附件落库和权限校验。预签名 URL 不进入 `content_html`，正文图片通过占位地址中的媒体 ID 与响应附件匹配后渲染；历史记录若只剩图片 `alt`，则按附件文件名兼容恢复。编辑未修改附件时不传 `media_ids`，修改后提交完整数组，清空时提交 `[]`。完整模块说明见 `defect-tracking-architecture.md`，接口契约见 `../api_docs/api_defects.md` 和 `../api_docs/api_media.md`。

## 样式与交互约定

当前 UI 风格以浅色背景、蓝色主按钮、浅蓝描边卡片、紧凑表格为主。

| 组件 | 约定 |
| --- | --- |
| 状态筛选 | 使用分段按钮样式 |
| 请求方式筛选 | 使用多选下拉，勾选图标居中显示 |
| 环境多选 | 使用环境 chip 按钮，选中态带勾选图标 |
| 环境配置 | 卡片负责展示，弹窗只在新增或编辑时出现 |
| 错误提示 | 表单内错误贴近字段展示，不遮挡主要按钮 |
| 必填标记 | 表单必填项使用独立红色星号标识，不把星号混入普通标签文字 |
| 缺陷编辑弹窗 | 头部和底部操作区固定，中间表单与富文本区域滚动，保存和取消按钮始终可见 |
| 响应展示 | 使用 Tab，不再把请求快照、响应头、响应 Body 和断言堆在同一屏 |
| AI生成测试用例 | 使用弹窗收集接口信息，生成结果以可勾选草稿列表展示，保存所选后才落库 |

## 测试覆盖

当前前端测试覆盖了以下关键行为：

- 登录成功保存 token。
- access token 临近过期时主动刷新。
- 受保护接口返回 401 时清理凭证并跳转登录页。
- 接口用例按标题、请求方式、状态和当前环境过滤。
- 接口用例支持绑定多个环境并提交 `environment_ids`。
- 接口用例页新增、编辑、删除环境变量。
- 调试响应在编辑弹窗中展示。
- GET URL 查询字符串自动转换为 Params。
- 运行已保存用例后更新最近执行状态。
- WebSocket 用例独立加载，并使用协议专属接口新增、调试、保存和运行。

验证命令：

```bash
npm run docs:check
npm test -- --run
npm run build
```

## 后续维护要求

新增或修改以下逻辑时，需要同步更新本文档：

- 认证、Token 刷新、401 处理。
- 项目或环境选择逻辑。
- 环境变量字段、脱敏规则、引用语法。
- 接口测试用例保存、调试、执行接口。
- 用例与环境绑定关系。
- 列表过滤、最近执行状态、响应展示 Tab。
- 后端字段命名或响应结构变化。
- 场景数据集、测试记录、请求覆盖和运行身份变化。
- 单步调试与整场实时状态的视觉语义或优先级变化。
- 命令栏、三栏工作台、左侧主测试用例列表、节点绑定动作弹窗或步骤卡视觉层级变化。
