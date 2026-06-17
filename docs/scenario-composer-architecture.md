# 场景组合前端技术架构

状态：当前实现
最后核验：2026-06-16

## 1. 模块定位

场景组合页面入口为 `/scenarios`。它将当前项目中的 HTTP、WebSocket 用例以及等待、条件步骤组合为可版本化的业务流程，并提供数据集、断言、变量提取、变量绑定、单步调试和整场实时执行能力。

主要文件：

| 文件 | 职责 |
| --- | --- |
| `src/pages/ScenariosPage.tsx` | 场景列表、画布、属性编辑、单步调试、运行历史和实时执行状态 |
| `src/api/scenarios.ts` | 场景 CRUD、执行启动、运行详情、SSE 解析和数据模型转换 |
| `src/api/scenarioContext.ts` | 提取与绑定配置读取、兼容和序列化 |
| `src/api/scenarioStepDebug.ts` | 单步骤调试响应标准化与 JSON 路径取值 |
| `src/api/client.ts` | JSON 请求、Token 刷新和带鉴权的事件流请求 |
| `src/pages/ScenariosPage.test.tsx` | 页面业务闭环和实时动画测试 |
| `src/api/scenarios.test.ts` | API 映射、运行详情和 SSE 协议测试 |

## 2. 数据边界

```text
ScenariosPage
  -> src/api/scenarios.ts
  -> requestWithAuth / requestEventStreamWithAuth
  -> /api/v1/scenarios
  -> /api/v1/scenario-runs
```

- 页面内部使用 camelCase TypeScript 模型。
- 后端请求和响应使用 snake_case。
- 场景、版本、运行记录和事件均以后端为权威数据源。
- 浏览器只保存认证信息，不持久化场景业务数据。

## 3. 场景配置

HTTP 和 WebSocket 步骤使用结构化请求、断言、响应取值和变量绑定编辑器。条件步骤使用“判断变量 + 比较方式 + 值类型 + 期望值”表单，等待步骤使用“等待时长 + 时间单位”表单。页面不展示原始步骤 JSON；提交前统一由 API 层把内部 `configText` 转换为对象。

- 条件表单保存为 `config.expression`，支持常用比较符和文本、数字、布尔值、空值。
- 等待表单保存为非负整数 `config.duration_ms`，毫秒、秒和分钟只属于前端输入单位。
- 可以解析的历史条件表达式会自动回填表单；无法解析的复杂表达式保持原值并展示兼容提示，用户通过结构化表单修改后转换为标准表达式。
- 结构化编辑同步更新步骤卡的摘要，但执行只依赖 `config`。

变量追踪元数据保存在 `_scenario_context`：

```json
{
  "_scenario_context": {
    "extractions": [
      {
        "id": "VAR-1",
        "name": "companyId",
        "path": "data.id",
        "masked": false
      }
    ],
    "bindings": [
      {
        "id": "BIND-1",
        "name": "companyId",
        "source_step_id": "STEP-1",
        "source_extraction_id": "VAR-1",
        "target": "query_params",
        "target_path": "companyId"
      }
    ]
  }
}
```

前端读取旧 camelCase 元数据，但保存时统一写入 snake_case。提取 ID 和绑定 ID 必须稳定，供场景版本、运行结果和画布关系关联。

## 4. 请求数据驱动

数据驱动不再以“一个字段维护多个散列值”为模型，而是以完整测试记录为执行单元：

```ts
interface ScenarioDataset {
  id: string;
  name: string;
  enabled: boolean;
  variablesText: string;
  records: ScenarioDatasetRecord[];
}

interface ScenarioDatasetRecord {
  id: string;
  name: string;
  enabled: boolean;
  requestOverrides: ScenarioRequestOverride[];
}
```

- 页面从步骤请求配置中结构化展开 Path、Header、Query 和任意深度 JSON Body 字段。
- 用户选择字段后，每条记录维护该字段的独立 `value`；值保留 JSON 类型。
- 数据集和记录同时启用时，该记录产生一次独立场景运行。
- 保存统一写入 `records[].request_overrides[].value`。
- 读取时兼容旧的数据集级 `request_overrides`：`values[]` 按索引迁移为多条记录，单个 `value` 迁移为一条记录。
- 右侧检查器是数据集的唯一主要维护入口；旧的独立变量 JSON 编辑入口不再展示。

详细字段和覆盖顺序见 [数据驱动请求覆盖契约](scenario-data-driven-contract.md)。

## 5. 页面定位与详情

- 顶部“数据集”统计卡切换到数据驱动页并定位数据集列表。
- “可选请求字段”和“运行数据组”滚动并高亮对应区域。
- “已驱动字段”和“请求覆盖字段”没有独立页面，使用详情弹窗展示字段位置、原值和记录覆盖情况。
- 点击数据集行后，右侧 `Scenario Config` 切换为 `Dataset Config`。
- “测试记录”统计定位并高亮右侧记录编辑区。

### 视觉与交互层级

场景组合页采用“专业编排工作台”视觉方向，所有视觉调整不得改变原有事件绑定、接口调用和数据模型：

- 顶部命令栏保持粘性，页签、版本、保存和运行操作始终可见。
- “运行场景”是唯一主操作；保存使用次级强调，复制和删除降低视觉权重。
- 统计卡采用紧凑状态条，保留模块定位能力但减少纵向占用。
- 左侧资产区、中间画布和右侧检查器使用统一圆角、阴影、边框和滚动条语义。
- 中间画布使用低对比度纯色背景，步骤卡保持高对比度白色内容面。
- 蓝色只表达选中和编辑，绿色表达通过，红色表达失败，紫色表达变量引用，灰色表达停用或跳过。
- 选中状态不得覆盖执行状态；失败节点在选中时仍保留红色失败语义。
- 右侧配置区使用粘性上下文标题和分组卡片，减少连续表单带来的阅读压力。
- 步骤断言区域统一命名为“断言”，默认收起，只在标题中展示已配置数量；用户主动展开后才显示新增、编辑和删除控件。
- 所有 hover、focus 和运行动画必须支持 `prefers-reduced-motion`。

## 6. 单步骤调试

单步骤调试使用未保存用例执行接口：

- HTTP：`POST /test-cases/execute-unsaved`
- WebSocket：`POST /websocket-test-cases/execute-unsaved`

调试响应由 `normalizeScenarioStepDebug` 统一为：

```ts
interface ScenarioStepDebugResult {
  durationMs: number;
  errorMessage: string;
  sources: Array<{ messageIndex?: number; value: unknown }>;
  status: string;
  statusCode?: string | number;
}
```

调试值只代表当前步骤响应：

- 右侧响应取值优先显示最新单步调试值。
- 上游节点输出和关系连线可显示最新单步调试提取值。
- 下游“实际输入值”仍只来自整场运行的 `resolved_bindings`，不能推断为已经使用了调试值。
- 切换场景或启动整场运行时清除单步调试临时状态。
- 调试通过时节点使用 `debug-passed`；失败、错误、超时或取消时使用 `debug-failed`。
- `debug-failed` 使用浅红背景、红色边框、红色步骤序号和“单步失败 · 耗时”标识。
- 状态优先级为：整场实时状态 > 当前单步执行中 > 最近单步结果 > 默认编辑状态。

## 7. 异步整场执行

### 启动

前端保存最新场景版本后调用：

```http
POST /api/v1/scenarios/{scenario_id}/execute?project_id={project_id}
```

后端返回 `202 Accepted`，响应包含 `execution_id` 和每个数据集对应的 run：

```ts
interface ScenarioRunLaunch {
  executionId: string;
  scenarioId: string;
  scenarioVersion: number;
  status: ScenarioRunStatus;
  createdAt: string;
  runs: ScenarioRunLaunchItem[];
}
```

### SSE 订阅

每个 run 独立订阅：

```http
GET /api/v1/scenario-runs/{run_id}/events?project_id={project_id}
Accept: text/event-stream
Authorization: Bearer <access_token>
```

前端使用 `fetch` 和 `ReadableStream`，而不是原生 `EventSource`，因为事件接口需要 Bearer Header。`requestEventStreamWithAuth` 负责：

- Token 临期刷新。
- Bearer Header。
- `/api/v1/...`、相对路径和完整 URL 解析。
- 401 统一退出登录。
- 无响应流和非 2xx 错误处理。

`subscribeScenarioRunEvents` 负责：

- 按 SSE 空行切分事件。
- 解析 `id`、`event` 和多行 `data`。
- 把 snake_case 事件转换为 `ScenarioRunEvent`。
- 首次连接和重连都发送 `Last-Event-ID`，默认从 `0` 开始。
- 连接异常或非终态流关闭时最多自动重连 3 次，使用递增等待时间。
- 按 `run_id + sequence` 去重服务端重放事件。
- 检测 sequence 缺口并通知页面读取运行详情校准状态。
- 将非 2xx 事件响应保留为带 `status`、业务 `code` 和 `detail_url` 的 `EventStreamRequestError`。

## 8. 真实节点与连线状态

画布不再使用本地定时器模拟执行顺序。

| 后端事件 | 前端行为 |
| --- | --- |
| `step_started` | 当前节点进入运行中呼吸高亮 |
| `step_completed` | 节点进入成功状态 |
| `step_failed` | 节点进入失败或超时状态 |
| `step_skipped` | 节点进入跳过状态 |
| `transition_started` | 只在实际选中的上下游连线上播放流动光点 |
| `run_completed` | 等待最终详情并结束运行态 |
| `run_failed` | 展示失败结果并结束运行态 |

实时状态结构：

```ts
interface ScenarioLiveProgress {
  currentStepIndex?: number;
  transitionTargetIndex?: number;
  stepStatuses: Record<number, ScenarioStepStatus>;
}
```

执行响应中的每个 run 都独立维护：

- `runProgressById[run_id]`：节点与连线实时状态。
- `runStatusById[run_id]`：排队、运行和终态。
- `runNoticeById[run_id]`：重连、恢复、序号校准和历史过期提示。

页面默认选择第一个 run，但会在画布标题下展示“当前画布运行”切换器。多数据集或
同一数据集多测试记录时，每项使用 `dataset_name · record_name` 标识，缺少记录名称时
回退到 `record_id`。单数据集且只有一条启用测试记录时，画布切换器和运行历史只显示
数据集名，并把副标题标为单条测试记录，避免把默认记录名误读为第二个数据集。切换
run 后，画布状态、右侧步骤运行结果和连接提示同时切换，不会混用其他数据记录的事件。
所有 run 仍并行订阅、等待完成并写入运行历史。

## 9. 断线恢复与最终校准

SSE 流结束、重连耗尽、事件序号缺口或历史过期后，前端调用：

```http
GET /api/v1/scenario-runs/{run_id}?project_id={project_id}
```

如果运行仍不是终态，前端每 750ms 查询一次，直到 `passed`、`failed`、`timeout` 或 `cancelled`。运行详情是最终权威数据，包含：

- 步骤状态和耗时。
- 实际请求与响应快照。
- 断言结果。
- `extracted_variables`。
- `resolved_bindings`。
- 错误信息和底层执行 ID。

恢复规则：

- 重连时携带最后已接受的 sequence，服务端重放的数据按 `run_id + sequence` 去重。
- sequence 不连续时立即读取运行详情并重建节点状态，随后继续消费当前事件。
- 服务端返回 `409 EVENT_HISTORY_EXPIRED` 时停止重连，直接使用运行详情恢复。
- 页面展示连接中断、恢复、详情校准和历史过期提示；提示保持可见，直到用户关闭或启动下一次运行。
- 运行详情始终是最终权威数据；如果仍非终态，继续每 750ms 查询直到结束。

## 10. 变量展示规则

- 原始 JSON 类型必须保留，不能统一转为字符串。
- `masked=true` 时固定显示遮罩符，不使用接口中的原始值。
- 提取失败仍显示记录，并展示 `error`。
- 运行值只读取 `extracted_variables` 和 `resolved_bindings`。
- 不从请求模板、响应 output 或上游提取值推断下游实际绑定值。
- 历史运行没有追踪字段时显示无数据，不回填推断。

## 11. 运行历史

列表接口只加载摘要；展开运行时按需请求完整详情。步骤详情展示：

- 实际请求 URL、Headers、Query 和 Body。
- 实际响应状态、Headers、Body 和 WebSocket 消息。
- 断言期望值、实际值和结果。
- 变量提取、绑定和错误。
- 执行 ID、开始时间、结束时间和耗时。

## 12. 安全与权限

- 所有请求显式携带 `project_id`。
- 场景查看权限：`scenario:view`。
- 场景维护权限：`scenario:manage`。
- 场景执行权限：`test:execute`。
- 前端不得把名称、路径或环境 ID 当作归属证明。
- Authorization、Cookie、Token、Password、Secret 和 API Key 必须由后端脱敏。

## 13. 测试要求

场景模块必须覆盖：

- CRUD、版本提交、数据集和步骤排序。
- 深层请求字段展开、多记录编辑、复制、启停和兼容迁移。
- 多数据集、多测试记录 run 切换与实时状态隔离。
- 启动响应、事件和运行详情中的 `record_id`、`record_name` 身份映射。
- 数据集统计入口、区域定位和详情弹窗。
- 命令栏、统计区、三栏工作台和步骤状态的视觉层级。
- 单步骤调试与响应取值。
- 单步失败画布状态和整场状态优先级。
- 断言维护和变量绑定序列化。
- 运行详情映射。
- 异步启动响应映射。
- SSE 鉴权 Header、`Last-Event-ID`、事件分块解析、自动重连、重放去重、序号缺口和 `409` 历史过期处理。
- `step_started` 节点状态与 `transition_started` 连线动画。
- 单步调试值和整场实际值的优先级。

验证命令：

```bash
npm test -- --run
npm run build
```

## 14. 相关契约

- [数据驱动请求覆盖](scenario-data-driven-contract.md)
- [实时运行事件](scenario-run-events-contract.md)
- [运行详情](scenario-run-detail-contract.md)
- [变量追踪](scenario-variable-tracing-contract.md)
- [前端开发计划](frontend-development-plan.md)
