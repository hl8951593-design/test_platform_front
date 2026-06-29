# Agent Codex 风格前端原型

状态：原型方案
最后核验：2026-06-27

本文档面向另一个 React 19 + Vite + TypeScript 前端项目实现 `/agents` 页面。原型严格以当前后端 `/api/v1/agents/*`、两份 Harness Loop Agent 文档中的 `Required ... contract` 块和现有前端技术文档为边界，不假设未声明接口已经存在。

## 1. 原型目标

`/agents` 页面提供类似 Codex 的 Agent 工作台：

- 支持多轮对话：同一个 `conversation_id` 下连续创建多个 Agent Run。
- 支持流式传输：通过 `GET /agents/runs/{run_id}/events` 消费 SSE 事件流，并用 `Last-Event-ID` 续播。
- 支持工具调用与工具输出：从事件中的 `tool_call_id` 进入 `GET /agents/tool-calls/{tool_call_id}` 详情。
- 支持审批、取消、恢复、reconcile、migration block resolve。
- 支持历史对话：当前后端没有 run/conversation 列表接口，前端只能先维护本地 history index；跨设备历史需要后端新增契约后再实现。
- 支持右侧环境/运行信息面板：展示项目、分支、运行状态、readiness、runbook、snapshot、memory usage。

参考图的信息架构来自 Codex 当前工作页：中间对话时间线、工具调用折叠块、右侧环境信息、底部 composer。

## 2. 页面结构

```text
/agents
┌──────────────────────────────────────────────────────────────────────────────┐
│ App 顶栏：项目选择 / 环境选择 / 用户 / 全局通知                              │
├───────────────┬──────────────────────────────────────────────┬───────────────┤
│ 会话与运行列表 │ Agent Transcript                             │ Run Inspector │
│               │                                              │               │
│ + 新会话       │  User prompt                                 │ Run summary   │
│ 搜索           │  Assistant/Agent status                       │ Snapshot      │
│ pinned filters │  Event Timeline                               │ Tool details  │
│ conversation   │  ToolCall card / output                       │ Approvals     │
│ run history    │  Approval card                                │ Memory        │
│ local drafts   │  Migration block card                         │ Runbook       │
│               │                                              │ Dashboard     │
├───────────────┴──────────────────────────────────────────────┴───────────────┤
│ Composer: prompt textarea / max_iterations / auto_complete / send / stop     │
└──────────────────────────────────────────────────────────────────────────────┘
```

布局规则：

- 默认三栏：左 280px，中间自适应，右 360px。
- 窄屏合并为：左侧抽屉、主时间线、右侧详情抽屉。
- 不做营销页，不做卡片套卡片；工作台以密集但清晰的信息操作为主。
- 工具调用、审批、migration、runbook 都是时间线内的折叠 item，右侧显示选中项详情。

## 3. 核心组件

| 组件 | 建议文件 | 职责 |
| --- | --- | --- |
| `AgentPage` | `src/pages/AgentPage.tsx` | 路由页、整体布局、当前 conversation/run 状态 |
| `AgentRunSidebar` | `src/components/agent/AgentRunSidebar.tsx` | 本地会话历史、run 状态、搜索、恢复入口 |
| `AgentTranscript` | `src/components/agent/AgentTranscript.tsx` | 事件流渲染、自动滚动、断线提示 |
| `AgentComposer` | `src/components/agent/AgentComposer.tsx` | 输入 prompt、创建 run、取消当前 run |
| `AgentEventItem` | `src/components/agent/AgentEventItem.tsx` | `AgentEventRead` 统一渲染入口 |
| `ToolCallCard` | `src/components/agent/ToolCallCard.tsx` | 工具计划、运行、输出、错误、审批状态 |
| `ApprovalCard` | `src/components/agent/ApprovalCard.tsx` | 展示 pending approval，并触发 approve/reject |
| `MigrationBlockCard` | `src/components/agent/MigrationBlockCard.tsx` | 展示 migration block 和 resolve 动作 |
| `ContextBuildCard` | `src/components/agent/ContextBuildCard.tsx` | 展示 context degradation、required evidence |
| `LoopObservationCard` | `src/components/agent/LoopObservationCard.tsx` | 展示 root cause、stop reasons、mitigation |
| `RunInspector` | `src/components/agent/RunInspector.tsx` | 右侧详情面板与 tabs |
| `RunbookPanel` | `src/components/agent/RunbookPanel.tsx` | runbook diagnosis 和 safe actions |
| `AgentDashboardPanel` | `src/components/agent/AgentDashboardPanel.tsx` | readiness、metrics、alerts、release gate 摘要 |

## 4. 页面状态模型

建议新增 `src/api/agents.ts` 和 `src/types/agents.ts`。

```ts
type AgentConnectionState =
  | "idle"
  | "connecting"
  | "streaming"
  | "reconnecting"
  | "closed"
  | "error";

type AgentThreadState = {
  conversationId: string;
  activeRunId: string | null;
  runsById: Record<string, AgentRunRead>;
  eventsByRunId: Record<string, AgentEventRead[]>;
  toolCallsById: Record<string, AgentToolCallRead>;
  contextBuildsByRunId: Record<string, AgentContextBuildRead[]>;
  loopObservationsByRunId: Record<string, AgentLoopObservationRead[]>;
  approvalsByRunId: Record<string, AgentApprovalRead[]>;
  migrationBlocksByRunId: Record<string, AgentMigrationBlockRead[]>;
  selectedInspector:
    | { type: "run"; id: string }
    | { type: "tool_call"; id: string }
    | { type: "context_build"; id: string }
    | { type: "loop_observation"; id: string }
    | { type: "approval"; id: string }
    | { type: "migration_block"; id: string }
    | null;
};
```

历史会话说明：

- 当前后端 `AgentRunRead` 有 `conversation_id`，支持前端把多轮 run 归入一个 conversation。
- 当前后端没有 `GET /agents/runs` 或 `GET /agents/conversations`，无法从服务端恢复完整历史列表。
- MVP：前端在 localStorage 保存 `{conversationId, runIds, title, lastRunStatus, updatedAt}`，每个 run 通过 `GET /agents/runs/{run_id}` 校准。
- 正式跨设备历史：需要后端新增列表契约后再接入，文档中不得把未存在接口写成已实现。

## 5. 流式传输原型

后端事件流：

```text
GET /api/v1/agents/runs/{run_id}/events
Header: Last-Event-ID: <last_event_seq>
Response: text/event-stream
```

SSE item：

```text
id: 3
event: run.completed
data: {"schema_version":1,"run_id":"...","project_id":10,"event_seq":3,"event_type":"run.completed",...}
```

前端实现注意：

- 原生 `EventSource` 不能设置 `Authorization` header。当前前端技术文档要求复用 `requestWithAuth` 和鉴权头，因此推荐用 `fetch + ReadableStream + SSE parser` 实现，而不是直接 `new EventSource()`。
- 每个 run 维护 `lastEventSeq`，断线后用 `Last-Event-ID` 继续拉。
- 当 run 进入 `completed`、`failed`、`cancelled` 这类 terminal 状态，并且事件序号追上 `last_event_sequence` 后关闭流。
- 事件到达时先追加 `AgentEventRead`，再按 `event_type` 触发二级资源 hydration。

事件到 UI 的映射：

| event_type 前缀 | 时间线展示 | 二级请求 |
| --- | --- | --- |
| `run.*` | Run 状态、开始、完成、取消 | `GET /agents/runs/{run_id}` |
| `tool.*` | ToolCall card | 事件含 `tool_call_id` 时调用 `GET /agents/tool-calls/{tool_call_id}` |
| `context.*` | ContextBuild card 或提示 | `GET /agents/runs/{run_id}/context-builds` |
| `loop.*` | LoopObservation card | `GET /agents/runs/{run_id}/loop-observations` |
| `approval.*` | Approval card | `GET /agents/runs/{run_id}/approvals` |
| `migration.*` | Migration block card | `GET /agents/runs/{run_id}/migration-blocks` |

## 6. 关键交互

### 6.1 新建对话

1. 用户点击左侧“新会话”。
2. 前端生成 `conversation_id`，清空当前 active run。
3. 用户在 composer 输入 prompt。
4. 调用 `POST /agents/runs`：

```json
{
  "project_id": 10,
  "conversation_id": "agent-conv-local-...",
  "intent": "请帮我生成测试计划",
  "max_iterations": 8,
  "auto_complete": false
}
```

5. 成功后保存 run 到本地 history，打开事件流。

### 6.2 多轮继续

1. 保持当前 `conversation_id`。
2. 每次发送新 prompt 都创建新的 Agent Run。
3. 时间线展示为多个 turn：User prompt -> Run timeline -> result。
4. 因当前后端未提供 message 存储，用户 prompt 需要随 run history 本地保存；服务端权威字段是 `AgentRunRead.intent`。

### 6.3 工具调用和输出

1. 时间线收到 `tool.planned`、`tool.running`、`tool.completed`、`tool.failed` 等事件。
2. 从 payload 读取 `tool_call_id`。
3. 调用 `GET /agents/tool-calls/{tool_call_id}`。
4. `ToolCallCard` 展示：
   - `tool_name`
   - `status`
   - `input_json_redacted`
   - `output_json_redacted`
   - `required_permissions_json`
   - `current_approval`
   - `recent_reconcile_attempts`
   - `error_code` / `error_message`

### 6.4 人工审批

1. Run 或 ToolCall 出现 pending approval。
2. 调用 `GET /agents/runs/{run_id}/approvals`。
3. `ApprovalCard` 显示 CAS 字段：`input_hash`、`runtime_snapshot_id`、`resource_scope_hash`、`approval_lineage_id`、`approval_epoch`。
4. approve/reject 必须提交当前 approval 的 CAS 字段，不能只提交 reason。

### 6.5 恢复和治理

| 操作 | 接口 | UI 入口 |
| --- | --- | --- |
| Cancel run | `POST /agents/runs/{run_id}/cancel` | composer Stop、RunInspector |
| Resume run | `POST /agents/runs/{run_id}/resume` | RunInspector、Runbook safe action |
| Reconcile run | `POST /agents/runs/{run_id}/reconcile` | ToolCall card、Runbook safe action |
| Resolve migration block | `POST /agents/runs/{run_id}/migration-blocks/{block_id}/resolve` | MigrationBlockCard |
| Diagnose run | `GET /agents/runs/{run_id}/runbook` | RunInspector Runbook tab |

## 7. 视觉风格

设计基调：安静、密集、工作台式。避免大 hero、装饰渐变和营销布局。

| 区域 | 风格 |
| --- | --- |
| 左侧栏 | 低对比列表，状态点、更新时间、搜索 |
| 时间线 | 宽度约 760px，事件自然流式堆叠，工具调用为可折叠灰底块 |
| 工具块 | header 显示 icon、工具名、状态、耗时；body 默认折叠 output |
| 右侧栏 | tabs：Run、Tool、Approval、Memory、Runbook、Dashboard |
| Composer | 底部固定，多行输入，右侧 Send/Stop，附加 max iteration 和 auto complete 控件 |

状态色建议：

| 状态 | 颜色语义 |
| --- | --- |
| running / streaming | blue |
| needs_human / pending approval | amber |
| migration_blocked / failed / P0 alert | red |
| completed / pass | green |
| cancelled / obsolete | neutral |

## 8. 原型验收清单

- 能从空白会话创建 run。
- 能展示 run.queued、run.started、run.completed 等事件。
- 能在断线后按 Last-Event-ID 继续接收事件。
- 能点击 tool card 拉取 ToolCall 详情。
- 能展示 approval 并提交 approve/reject CAS 请求。
- 能展示 context build 和 loop observation。
- 能查看 runbook diagnosis、dashboard、metrics、alerts。
- 历史列表明确标注 MVP 为本地历史，不冒充服务端历史。
- 所有字段名使用后端 snake_case，不在前端私自改名。
