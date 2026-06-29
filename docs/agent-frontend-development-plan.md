# Agent Codex 风格前端开发计划

状态：开发方案
最后核验：2026-06-27

适用前端技术栈：React 19、Vite、TypeScript、Vitest、Testing Library、CSS。接口基础路径通过 `VITE_API_BASE_URL` 配置，默认 `/api/v1`。

## 1. 开发边界

本计划只设计和指导前端实现，不在当前后端仓库创建 React 工程。前端工程应按现有约定放置：

| 文件 | 说明 |
| --- | --- |
| `src/api/agents.ts` | 普通 JSON API 封装 |
| `src/api/agentStream.ts` | SSE fetch stream 封装 |
| `src/types/agents.ts` | Agent 后端契约类型 |
| `src/pages/AgentPage.tsx` | `/agents` 页面 |
| `src/components/agent/` | Agent 专用组件 |
| `src/pages/AgentPage.test.tsx` | 页面测试 |
| `src/api/agents.test.ts` | API 封装测试 |
| `src/api/agentStream.test.ts` | SSE parser 测试 |

## 2. 里程碑

### P0 - 契约类型与 API 封装

目标：所有后端接口先进入类型和 API 层，页面不直接拼接路径。

任务：

1. 新增 `src/types/agents.ts`，按 `docs/api_agent_frontend_contract.md` 定义类型。
2. 新增 `src/api/agents.ts`，封装 run、tool call、approval、context build、loop observation、memory、dashboard、runbook、release gate。
3. 新增 `src/api/agentStream.ts`，用 `fetch + ReadableStream` 解析 SSE。
4. API 返回统一使用 `ApiEnvelope<T>`。
5. 编写 API 路径和 SSE parser 单元测试。

验收：

- API 测试覆盖所有前端会调用的 `/agents/*` 路径。
- SSE parser 支持 `id`、`event`、`data`、heartbeat、断包。
- `Last-Event-ID` 可通过 header 传入。

### P1 - Agent 工作台骨架

目标：实现 Codex 风格三栏工作台。

任务：

1. 在路由中启用 `/agents`。
2. 左侧 `AgentRunSidebar` 支持新会话、本地历史、搜索、状态筛选。
3. 中间 `AgentTranscript` 支持事件时间线。
4. 右侧 `RunInspector` 支持 Run、Tool、Approval、Memory、Runbook、Dashboard tabs。
5. 底部 `AgentComposer` 支持 prompt、max_iterations、auto_complete、send/stop。

验收：

- 空态、加载、错误、无权限、断线、终态都可见。
- 窄屏左/右栏可折叠。
- 不依赖 mock 字段，字段名来自后端契约。

### P2 - Run 创建与流式事件

目标：从用户 prompt 创建 run，并实时展示事件。

任务：

1. `POST /agents/runs` 创建 run。
2. 保存 `{conversationId, runId, intent, updatedAt}` 到本地 history。
3. 连接 `GET /agents/runs/{run_id}/events`。
4. 事件到达后追加到 `eventsByRunId`。
5. terminal 状态后调用 `GET /agents/runs/{run_id}` 校准最终状态。
6. 断线后用 `Last-Event-ID` 重连。

验收：

- 可连续发送多轮 prompt，复用 `conversation_id`。
- 可以 stop 当前 run。
- 可以刷新页面后从本地 run id 恢复当前 run。

### P3 - ToolCall、Approval、Migration

目标：展示并操作 Agent 的工具调用和人工确认流程。

任务：

1. 事件中发现 `tool_call_id` 后请求 `GET /agents/tool-calls/{tool_call_id}`。
2. ToolCall card 展示输入、输出、策略、权限、错误和 reconcile attempts。
3. `GET /agents/runs/{run_id}/approvals` 展示 pending approvals。
4. approve/reject 提交 CAS 字段。
5. `GET /agents/runs/{run_id}/migration-blocks` 展示阻断项。
6. `POST /agents/runs/{run_id}/migration-blocks/{block_id}/resolve` 支持解决阻断。

验收：

- approve/reject 409 时提示“审批已过期或上下文已变化”。
- ToolCall 输出默认折叠，用户可展开查看 redacted output。
- migration block resolve 后自动 refresh run、context、events。

### P4 - Context、Loop、Memory

目标：展示 Agent 决策上下文、循环观察和 Memory 证据。

任务：

1. `GET /agents/runs/{run_id}/context-builds` 展示 context degradation、required evidence。
2. `GET /agents/runs/{run_id}/loop-observations` 展示 root cause、causal chain、mitigation。
3. `GET /agents/memory-usage-events?run_id={run_id}` 展示本 run Memory 使用。
4. 支持 memory feedback：`POST /agents/memory-usage-events/{usage_event_id}/feedback`。
5. Profile catalog 用于说明 Memory 策略，不在普通用户路径里默认编辑。

验收：

- ContextBuild 和 LoopObservation 可从 timeline 跳转到右侧详情。
- Memory usage 可标记 useful / misleading / stale。
- 高风险动作只依赖 Memory 时需要明显风险提示。

### P5 - Runbook、Dashboard、Release Gate

目标：把后端治理能力变成可执行建议。

任务：

1. `GET /agents/runs/{run_id}/runbook` 展示 diagnosis 和 recommendations。
2. Runbook safe actions 映射到已有前端操作：resume、reconcile、context rebuild、migration block、tool call detail。
3. `GET /agents/dashboard` 展示 readiness。
4. `GET /agents/metrics`、`GET /agents/alerts` 展示监控摘要。
5. `GET /agents/release-gates`、`GET /agents/release-gates/promotion` 展示上线门禁。

验收：

- P0/P1 alerts 在右侧面板明显显示。
- safe action 只调用后端 OpenAPI 已存在路径。
- 无权限 admin 接口不展示操作按钮。

### P6 - 历史会话和体验收口

目标：完成类似 Codex 的历史对话体验。

任务：

1. 本地 conversation history 支持重命名、删除、置顶、搜索。
2. run id 校准失败时保留本地历史但标记“远端不可用”。
3. 导出当前 conversation 的事件和 tool output。
4. 支持键盘快捷键：新会话、发送、停止、搜索、打开 command palette。
5. 增加无障碍标签和焦点管理。

限制：

- 当前后端没有服务端 conversation/run list。跨设备历史不是当前可实现能力。
- 若要服务端历史，需要新增后端契约，例如 `GET /agents/conversations`、`GET /agents/conversations/{conversation_id}/runs`，在后端文档和测试完成前前端不得调用。

## 3. 页面测试计划

| 测试 | 覆盖 |
| --- | --- |
| `agents.test.ts` | API 路径、method、body、query |
| `agentStream.test.ts` | SSE parser、Last-Event-ID、abort、heartbeat |
| `AgentPage.test.tsx` | 创建 run、事件到 UI、stop、重连 |
| `ToolCallCard.test.tsx` | 输出展开、错误、审批状态 |
| `ApprovalCard.test.tsx` | CAS 字段、approve/reject、409 |
| `RunInspector.test.tsx` | tabs、runbook、dashboard |
| `history.test.ts` | localStorage conversation index |

## 4. 文档同步要求

实现时需要同步更新前端项目中的：

- `AGENTS.md`
- `docs/documentation-governance.md`
- 现有 TestAuto 技术文档的 Agent 运行章节
- API 封装说明
- 测试基线

变更完成标准：

- 前端字段与 `docs/api_agent_frontend_contract.md` 一致。
- 未实现的服务端历史能力必须标注为限制，不能写成已完成。
- 所有新增页面、组件、API 和权限规则都有文档记录。

## 5. 风险和处理

| 风险 | 处理 |
| --- | --- |
| EventSource 无法带 Authorization | 使用 `fetch + ReadableStream` |
| 后端缺少服务端历史列表 | MVP 用本地 history，正式版等待后端契约 |
| SSE 事件与最终 run 状态短暂不一致 | terminal 后用 `GET /agents/runs/{run_id}` 校准 |
| ToolCall 输出大或敏感 | 默认折叠，只展示 redacted 字段 |
| approval CAS 冲突 | 明确提示 stale，刷新 approvals/tool call |
| admin-only 接口误展示 | 根据 403 和用户权限隐藏或禁用 |

## 6. 建议开发顺序

1. `types/agents.ts`
2. `api/agents.ts`
3. `api/agentStream.ts`
4. `AgentPage` 三栏布局
5. Run create + SSE timeline
6. ToolCall details
7. Approval / Migration operations
8. ContextBuild / LoopObservation / Memory
9. Runbook / Dashboard / Release Gate
10. 本地历史和体验 polish
