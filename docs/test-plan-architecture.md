# 测试计划前端技术文档

## 1. 模块定位

测试计划模块入口为 `/plans`，负责把当前项目中的 HTTP 测试用例、WebSocket 测试用例和已保存可视化流程组织为可重复执行的计划，并维护执行环境、触发方式、执行策略和前端执行历史。

当前仓库尚未提供测试计划后端接口契约。为保证页面功能可独立使用，计划定义与计划运行记录暂时按项目保存在浏览器 `localStorage`。当前“手动运行”生成的是前端模拟执行记录，不会真正调用测试用例或流程执行接口。

相关代码：

| 文件 | 职责 |
| --- | --- |
| `src/pages/PlansPage.tsx` | 页面状态、资产加载、列表筛选、编辑弹窗、调度日历、运行弹窗和执行历史 |
| `src/api/plans.ts` | 计划数据模型、本地持久化、复制、启停、模拟运行和导入逻辑 |
| `src/App.tsx` | 向测试计划页传入当前项目、当前环境和项目环境列表 |
| `src/styles.css` | 测试计划页面、弹窗、卡片、日历和历史表格样式 |
| `src/pages/PlansPage.test.tsx` | 测试计划核心交互和项目隔离测试 |

## 2. 当前责任边界

### 2.1 当前前端已实现

- 按当前项目读取和保存测试计划。
- 新建、编辑、复制、删除、启用和停用计划。
- 按名称、说明和标签搜索，按状态和触发方式筛选。
- 并行加载当前项目的 HTTP 用例、WebSocket 用例和可视化流程。
- 为计划选择多个环境和多个执行目标。
- 调整执行目标顺序。
- 配置串行/并行、失败策略、重试、超时、通知邮箱和标签。
- 配置手动、Cron 和 Webhook 触发信息。
- 展示未来 14 天 Cron 日期日历。
- 生成、查看、删除和清空前端模拟执行历史。
- 按项目导入和导出计划 JSON。

### 2.2 当前未实现

- 测试计划后端 CRUD。
- 后端定时调度和 Webhook 实际触发。
- 对执行目标发起真实批量执行。
- 串行/并行、失败策略、重试和超时的真实调度行为。
- 执行进度、节点结果和日志实时展示。
- 后端权限校验、并发控制、幂等和审计。
- 服务端 Cron 校验和下一次执行时间计算。
- 计划删除后的运行记录保留策略。

因此页面展示的执行状态和统计不能作为真实测试结果使用。正式联调时，应由后端执行器返回计划运行结果。

## 3. 页面输入与项目边界

`PlansPage` 从应用壳接收：

| Prop | 类型 | 说明 |
| --- | --- | --- |
| `projectId` | `number \| undefined` | 当前项目 ID，是计划数据和执行资产的隔离边界 |
| `environmentId` | `number \| undefined` | 顶部当前环境，新建计划和手动运行的默认环境 |
| `environments` | `EnvironmentOption[]` | 当前项目环境列表，供计划绑定和运行选择 |
| `onAction` | `ActionHandler` | 向全局 Toast 提交操作反馈 |

项目切换时，页面会：

1. 关闭计划编辑弹窗和运行弹窗。
2. 从当前项目对应的本地存储中重新读取计划和运行历史。
3. 并行加载当前项目的 HTTP 用例、WebSocket 用例和可视化流程。
4. 单个资产接口失败时继续展示其他成功加载的资产。
5. 三类资产全部失败时展示错误提示，但仍允许维护已有计划。

未选择项目时，禁止导入、新建和运行计划，并展示项目选择提示。

## 4. 页面结构

页面包含三个主视图：

| 视图 | 功能 |
| --- | --- |
| 计划列表 | 统计、搜索、筛选、计划卡片和计划操作 |
| 调度日历 | 展示未来 14 天内匹配日期的已启用 Cron 计划 |
| 执行历史 | 展示当前项目的前端模拟运行记录 |

### 4.1 计划列表

统计卡片根据当前项目数据实时计算：

- 总计划数
- 已启用计划数
- 已启用 Cron 计划数
- 当前本地历史中的失败记录数

计划卡片展示计划名称、ID、说明、触发方式、执行模式、标签、执行目标、环境、最近执行时间和更新时间，并提供：

- 启用/停用
- 手动运行
- 编辑
- 复制
- 删除

复制计划时生成新 ID、名称增加“副本”、默认停用，并清除最近运行时间和下一次运行时间。

### 4.2 计划编辑弹窗

编辑弹窗由基础信息、环境、执行目标、已选顺序和执行策略组成。

保存前必须满足：

1. 当前项目存在。
2. 计划名称非空。
3. 至少选择一个环境。
4. 至少选择一个执行目标。
5. Cron 触发时 Cron 表达式非空。
6. Webhook 触发时 Webhook 事件非空。

当前前端未校验邮箱格式，也未完整校验 Cron 表达式语法。正式后端接入后，后端必须重复执行完整校验。

### 4.3 手动运行弹窗

运行弹窗仅展示计划已经绑定的环境。确认运行后：

1. 调用 `src/api/plans.ts` 的 `runPlan`。
2. 创建一条前端模拟执行记录。
3. 更新计划的 `lastRunAt`。
4. 自动切换到执行历史视图。

当前模拟规则：

- 目标名称包含“失败”时，模拟一条失败目标。
- 否则运行状态为 `passed`。
- 模拟耗时为 `max(800ms, 目标数 * 650ms)`。
- 操作人当前固定记录为“当前用户”，尚未使用真实登录用户信息。
- 不会调用 HTTP、WebSocket 或流程执行接口。

此规则只用于前端交互演示和测试，不属于正式业务规则。

## 5. 执行资产加载与快照

页面进入当前项目后并行调用：

| 资产类型 | 数据来源 |
| --- | --- |
| HTTP 测试用例 | `listTestCases(projectId)` |
| WebSocket 测试用例 | `listWebSocketTestCases(projectId)` |
| 可视化流程 | `listFlows(projectId)` |

三类资产统一映射为 `PlanTarget`：

```ts
interface PlanTarget {
  id: string;
  referenceId: string | number;
  kind: "api_case" | "websocket_case" | "flow";
  name: string;
  method?: string;
  path?: string;
}
```

计划中保存的是引用 ID 加展示快照。资产原始名称或路径修改后，已有本地计划不会自动更新快照。后端正式执行时应使用 `kind + referenceId` 获取最新资产定义，并校验资产仍属于当前项目。

## 6. 数据模型

### 6.1 TestPlan

```ts
interface TestPlan {
  id: string;
  projectId: number;
  name: string;
  description: string;
  enabled: boolean;
  triggerType: "manual" | "cron" | "webhook";
  cronExpression: string;
  webhookEvent: string;
  environmentIds: number[];
  targets: PlanTarget[];
  executionMode: "serial" | "parallel";
  failurePolicy: "stop" | "continue";
  retryCount: number;
  timeoutMinutes: number;
  notificationEmails: string[];
  tags: string[];
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  nextRunAt?: string;
}
```

字段说明：

| 字段 | 说明 |
| --- | --- |
| `projectId` | 计划所属项目，导入时强制使用当前项目 |
| `environmentIds` | 计划允许执行的环境列表 |
| `targets` | 有序执行目标列表 |
| `triggerType` | 触发方式配置；当前仅保存配置，不实际调度 |
| `executionMode` | 串行或并行；当前仅保存配置 |
| `failurePolicy` | 失败停止或继续；当前仅保存配置 |
| `retryCount` | 失败重试次数；当前仅保存配置 |
| `timeoutMinutes` | 计划超时分钟数；当前仅保存配置 |
| `notificationEmails` | 通知邮箱；当前仅保存配置 |
| `nextRunAt` | 已预留，当前页面未计算和展示 |

### 6.2 PlanRun

```ts
interface PlanRun {
  id: string;
  planId: string;
  planName: string;
  projectId: number;
  environmentId?: number;
  environmentName?: string;
  status: "passed" | "failed" | "running" | "cancelled";
  trigger: "manual" | "schedule" | "webhook";
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  targetCount: number;
  passedCount: number;
  failedCount: number;
  operator: string;
}
```

当前只生成 `trigger = "manual"` 的记录，且记录是计划级汇总，不包含每个目标的执行明细。

## 7. 本地持久化

本地存储按项目隔离：

| Key | 内容 |
| --- | --- |
| `testauto_plans_project_{projectId}` | 当前项目测试计划数组 |
| `testauto_plan_runs_project_{projectId}` | 当前项目计划运行记录，最多保留 200 条 |

`src/api/plans.ts` 对读取到的计划执行兼容规范化：

- 缺失 ID 时生成 ID。
- 缺失名称时使用“未命名计划”。
- 无效触发类型回退为 `manual`。
- 无效执行模式回退为 `serial`。
- 无效失败策略回退为 `stop`。
- 重试次数最小为 `0`。
- 超时分钟数最小为 `1`，无效值回退为 `30`。
- 导入计划强制归属当前项目并默认停用。

本地存储不是可靠数据库。用户清理浏览器数据、切换浏览器或更换设备后，计划和历史无法恢复。

## 8. Cron 日历能力边界

调度日历只用于前端日期预览，不是完整 Cron 调度器。

当前逻辑：

- 仅展示已启用且 `triggerType = "cron"` 的计划。
- 展示未来 14 天。
- 只解析 Cron 的日、月、星期字段。
- 支持日期字段的固定值、`*`、`*/步长`、范围和逗号列表。
- 不解析分钟和小时字段，不展示具体执行时刻。
- 不支持名称别名、复杂步长范围、时区、特殊字符或秒级 Cron。

后端正式接入后，调度日历应直接使用后端计算的 `next_run_at` 或调度实例列表，避免前后端 Cron 解释不一致。

## 9. 导入导出

导出格式：

```json
{
  "version": "1.0",
  "plans": []
}
```

导入支持：

- 直接计划数组。
- 包含 `plans` 数组的对象。

导入规则：

- 为每条计划生成新 ID。
- 强制使用当前项目 ID。
- 默认停用。
- 重置创建和更新时间。
- 保留引用资产快照、环境 ID 和执行策略。
- 不校验被引用资产或环境是否仍然存在。

后端接入后，导入接口必须校验项目、环境和引用资产权限，并返回逐条导入结果。

## 10. 权限与安全

当前页面只依赖顶部当前项目进行前端数据隔离，未实现操作权限控制。建议后端提供：

| 权限点 | 说明 |
| --- | --- |
| `plan:view` | 查看计划、日历和执行历史 |
| `plan:create` | 新建和导入计划 |
| `plan:update` | 编辑、复制、启用和停用计划 |
| `plan:delete` | 删除计划 |
| `plan:run` | 手动运行计划 |
| `plan:history:delete` | 删除或清空运行记录 |

后端必须校验：

- 用户有权访问计划所属项目。
- 环境属于计划所属项目。
- 所有执行目标属于计划所属项目且用户有引用和执行权限。
- 通知邮箱、Webhook 配置和执行快照中的敏感数据按规则脱敏。

## 11. 建议后端接口契约

以下为前端接入建议，不代表当前后端已经实现。

| 接口 | 方法 | 说明 |
| --- | --- | --- |
| `/test-plans?project_id={projectId}` | `GET` | 查询项目计划列表 |
| `/test-plans?project_id={projectId}` | `POST` | 创建计划 |
| `/test-plans/{planId}?project_id={projectId}` | `GET` | 查询计划详情 |
| `/test-plans/{planId}?project_id={projectId}` | `PUT` | 更新计划 |
| `/test-plans/{planId}?project_id={projectId}` | `DELETE` | 删除计划 |
| `/test-plans/{planId}/enabled?project_id={projectId}` | `PUT` | 启用或停用计划 |
| `/test-plans/{planId}/execute?project_id={projectId}` | `POST` | 手动执行计划 |
| `/test-plan-runs?project_id={projectId}` | `GET` | 查询计划执行历史 |
| `/test-plan-runs/{runId}?project_id={projectId}` | `GET` | 查询运行详情和目标结果 |
| `/test-plans/import?project_id={projectId}` | `POST` | 导入计划 |
| `/test-plans/export?project_id={projectId}` | `GET` | 导出计划 |
| `/test-plans/schedule?project_id={projectId}` | `GET` | 查询指定时间范围的调度实例 |

执行接口建议请求：

```json
{
  "environment_id": 1,
  "idempotency_key": "client-generated-key"
}
```

执行接口建议返回：

```json
{
  "run_id": 1001,
  "status": "queued",
  "plan_id": 10,
  "plan_version": 3,
  "environment_id": 1
}
```

后端应保存不可变计划版本快照，确保运行中的计划不会受到后续编辑影响。

### 11.1 通用响应格式

建议后端所有接口统一返回以下结构，字段使用 `snake_case`：

```json
{
  "code": 0,
  "message": "success",
  "data": {}
}
```

分页列表统一返回：

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "items": [],
    "total": 0,
    "page": 1,
    "page_size": 20
  }
}
```

约束：

- `code = 0` 表示业务成功，HTTP 状态码仍需正确使用。
- ID 可以是数字或字符串，但同一资源类型必须保持一致。
- 所有时间字段使用 ISO 8601，例如 `2026-06-08T08:30:00Z`。
- 可选时间没有值时返回 `null`，不要返回空字符串。
- 列表无数据时返回空数组，不返回 `null`。
- 错误响应至少包含可直接展示的 `message`。

### 11.2 页面初始化依赖数据

测试计划页面进入后需要项目、环境和可执行资产数据。

#### 项目列表

`GET /projects`

前端最少需要：

```json
{
  "items": [
    {
      "id": 1,
      "name": "电商核心服务",
      "description": "核心链路自动化测试",
      "owner_name": "QA 团队",
      "is_active": true,
      "created_at": "2026-06-01T08:00:00Z",
      "updated_at": "2026-06-08T08:00:00Z"
    }
  ]
}
```

#### 项目环境

`GET /environment-configs?project_id={projectId}`

```json
{
  "items": [
    {
      "id": 1,
      "project_id": 1,
      "name": "测试环境",
      "base_url": "https://test.example.com",
      "description": "日常测试环境",
      "is_default": true,
      "is_active": true
    }
  ]
}
```

#### HTTP 和 WebSocket 测试用例

`GET /test-cases?project_id={projectId}`

`GET /websocket-test-cases?project_id={projectId}`

计划编辑弹窗只依赖以下摘要字段：

```json
{
  "items": [
    {
      "id": 11,
      "project_id": 1,
      "name": "创建订单",
      "method": "POST",
      "path": "/orders",
      "description": "创建普通订单",
      "updated_at": "2026-06-08T08:00:00Z"
    }
  ]
}
```

WebSocket 用例的 `method` 可固定返回 `WS`。若列表接口数据较大，建议提供专门的资产摘要接口：

`GET /test-plan-assets?project_id={projectId}&keyword={keyword}`

#### 可视化流程

`GET /flows?project_id={projectId}`

```json
{
  "items": [
    {
      "id": 21,
      "project_id": 1,
      "name": "下单支付完整链路",
      "description": "核心业务回归流程",
      "node_count": 8,
      "updated_at": "2026-06-08T08:00:00Z"
    }
  ]
}
```

### 11.3 测试计划数据结构

推荐后端返回的完整计划结构：

```json
{
  "id": "PLN-1001",
  "project_id": 1,
  "version": 3,
  "name": "核心链路夜间回归",
  "description": "每日检查登录、下单和支付流程",
  "enabled": true,
  "trigger_type": "cron",
  "cron_expression": "0 2 * * *",
  "webhook_event": null,
  "environment_ids": [1, 2],
  "targets": [
    {
      "id": "api_case-11",
      "reference_id": 11,
      "kind": "api_case",
      "name": "创建订单",
      "method": "POST",
      "path": "/orders",
      "sort_order": 1
    },
    {
      "id": "flow-21",
      "reference_id": 21,
      "kind": "flow",
      "name": "下单支付完整链路",
      "method": "FLOW",
      "path": "8 个节点",
      "sort_order": 2
    }
  ],
  "execution_mode": "serial",
  "failure_policy": "stop",
  "retry_count": 1,
  "timeout_minutes": 30,
  "notification_emails": ["qa@example.com"],
  "tags": ["P0", "夜间回归"],
  "created_by": {
    "id": 8,
    "name": "张三"
  },
  "created_at": "2026-06-01T08:00:00Z",
  "updated_at": "2026-06-08T08:00:00Z",
  "last_run_at": "2026-06-08T02:00:00Z",
  "next_run_at": "2026-06-09T02:00:00Z"
}
```

枚举值：

| 字段 | 可选值 |
| --- | --- |
| `trigger_type` | `manual`、`cron`、`webhook` |
| `targets[].kind` | `api_case`、`websocket_case`、`flow` |
| `execution_mode` | `serial`、`parallel` |
| `failure_policy` | `stop`、`continue` |

字段要求：

- `targets` 必须按执行顺序返回，推荐同时返回 `sort_order`。
- `targets[].id` 应为计划目标关系的稳定唯一 ID；不能只使用跨类型可能重复的资产数字 ID。
- `reference_id + kind` 用于执行时定位真实资产。
- `name`、`method` 和 `path` 是展示快照，资产删除后仍可用于运行历史展示。
- `version` 用于并发更新和运行快照。
- `next_run_at` 由后端调度器计算。

创建和更新计划请求体不应接收后端维护字段：

```json
{
  "name": "核心链路夜间回归",
  "description": "每日检查核心链路",
  "enabled": true,
  "trigger_type": "cron",
  "cron_expression": "0 2 * * *",
  "webhook_event": null,
  "environment_ids": [1, 2],
  "targets": [
    {
      "reference_id": 11,
      "kind": "api_case",
      "sort_order": 1
    }
  ],
  "execution_mode": "serial",
  "failure_policy": "stop",
  "retry_count": 1,
  "timeout_minutes": 30,
  "notification_emails": ["qa@example.com"],
  "tags": ["P0"]
}
```

### 11.4 计划列表返回

`GET /test-plans?project_id={projectId}&keyword=&enabled=&trigger_type=&page=1&page_size=20`

列表项建议直接返回完整计划结构，或至少返回页面卡片依赖的字段：

- `id`、`name`、`description`、`enabled`
- `trigger_type`、`cron_expression`、`webhook_event`
- `environment_ids`、`targets`
- `execution_mode`、`tags`
- `updated_at`、`last_run_at`、`next_run_at`

同时建议返回统计数据，避免前端只能对当前分页计算：

```json
{
  "items": [],
  "total": 26,
  "page": 1,
  "page_size": 20,
  "statistics": {
    "total": 26,
    "enabled": 20,
    "scheduled": 8,
    "recent_failed": 2
  }
}
```

### 11.5 执行记录数据结构

计划执行历史列表最少需要：

```json
{
  "id": "RUN-2001",
  "plan_id": "PLN-1001",
  "plan_name": "核心链路夜间回归",
  "plan_version": 3,
  "project_id": 1,
  "environment_id": 1,
  "environment_name": "测试环境",
  "status": "passed",
  "trigger": "schedule",
  "started_at": "2026-06-08T02:00:00Z",
  "finished_at": "2026-06-08T02:01:12Z",
  "duration_ms": 72000,
  "target_count": 6,
  "passed_count": 6,
  "failed_count": 0,
  "operator": {
    "id": 8,
    "name": "张三"
  }
}
```

执行状态建议支持：

`queued`、`running`、`passed`、`failed`、`cancelled`、`timeout`

运行详情建议额外返回每个目标的结果：

```json
{
  "id": "RUN-2001",
  "status": "failed",
  "target_results": [
    {
      "id": "RESULT-1",
      "target_id": "api_case-11",
      "reference_id": 11,
      "kind": "api_case",
      "name": "创建订单",
      "status": "passed",
      "attempt": 1,
      "started_at": "2026-06-08T02:00:00Z",
      "finished_at": "2026-06-08T02:00:03Z",
      "duration_ms": 3000,
      "error_message": null
    }
  ]
}
```

### 11.6 调度日历返回

建议日历直接读取后端调度实例，不由前端解析 Cron：

`GET /test-plans/schedule?project_id={projectId}&start_at={ISO_TIME}&end_at={ISO_TIME}`

```json
{
  "items": [
    {
      "id": "SCHEDULE-1",
      "plan_id": "PLN-1001",
      "plan_name": "核心链路夜间回归",
      "trigger_type": "cron",
      "cron_expression": "0 2 * * *",
      "scheduled_at": "2026-06-09T02:00:00Z",
      "environment_ids": [1, 2],
      "enabled": true
    }
  ]
}
```

### 11.7 后端必须执行的校验

- 计划名称非空，长度和项目内重名规则明确。
- 至少包含一个有效环境和一个有效执行目标。
- 环境和目标均属于当前项目。
- `cron` 触发必须提供合法 Cron 表达式，并明确调度时区。
- `webhook` 触发必须提供事件或后端生成的 Webhook 标识。
- 重试次数、超时和通知邮箱符合服务端限制。
- 更新请求携带并校验计划版本，避免覆盖其他用户修改。
- 手动执行使用幂等键，避免重复提交。
- 执行时保存不可变计划、环境和目标快照。

### 11.8 前后端字段映射

当前 `src/api/plans.ts` 的前端内部模型使用 `camelCase`，正式接入后端时，API 层必须集中完成映射，页面组件不能直接依赖后端字段。

| 后端字段 | 前端字段 |
| --- | --- |
| `project_id` | `projectId` |
| `trigger_type` | `triggerType` |
| `cron_expression` | `cronExpression` |
| `webhook_event` | `webhookEvent` |
| `environment_ids` | `environmentIds` |
| `reference_id` | `referenceId` |
| `execution_mode` | `executionMode` |
| `failure_policy` | `failurePolicy` |
| `retry_count` | `retryCount` |
| `timeout_minutes` | `timeoutMinutes` |
| `notification_emails` | `notificationEmails` |
| `created_at` | `createdAt` |
| `updated_at` | `updatedAt` |
| `last_run_at` | `lastRunAt` |
| `next_run_at` | `nextRunAt` |
| `environment_name` | `environmentName` |
| `duration_ms` | `durationMs` |
| `target_count` | `targetCount` |
| `passed_count` | `passedCount` |
| `failed_count` | `failedCount` |

建议在 `src/api/plans.ts` 中新增 `mapPlan`、`mapPlanRun`、`toPlanPayload`，统一处理字段转换、默认值和异常数据，避免映射逻辑散落在页面中。

## 12. 后端接入迁移方案

正式接入后端时，建议保持 `PlansPage` 的交互结构不变，仅替换 `src/api/plans.ts` 的实现：

1. 将 `listPlans`、`savePlan`、`deletePlan`、`setPlanEnabled` 等改为异步接口调用。
2. 将 `runPlan` 替换为真实执行接口，并返回后端运行 ID。
3. 将 `listPlanRuns` 替换为后端分页查询。
4. 将日历数据改为读取后端调度实例或 `next_run_at`。
5. 页面增加加载、失败、空态和请求竞态保护。
6. 页面增加运行状态轮询、SSE 或 WebSocket 实时更新。
7. 删除本地模拟失败和模拟耗时规则。
8. 为保存、删除、启停和执行增加后端权限错误处理。

## 13. 测试覆盖

`src/pages/PlansPage.test.tsx` 当前覆盖：

- 新建计划。
- 选择真实资产映射结果。
- 本地持久化。
- 搜索过滤。
- 启用和停用。
- 手动模拟运行和执行历史。
- 项目数据隔离。
- Cron 计划在调度日历展示。

当前尚未覆盖：

- 编辑、复制和删除。
- 导入导出。
- 运行历史删除和清空。
- 资产接口部分失败。
- 完整表单校验。
- Cron 日期边界。
- 后端正式接口联调。

修改测试计划模块后至少运行：

```bash
npm test -- --run
npm run build
```

## 14. 开发约束

- 页面不能绕过 `src/api/plans.ts` 直接访问计划本地存储或后端接口。
- 所有计划数据必须显式使用当前 `projectId`。
- 导入数据必须强制归属当前项目，不能信任文件中的 `projectId`。
- 计划执行目标必须保存稳定引用 ID，名称和路径只作为展示快照。
- 前端模拟运行逻辑不得被描述为真实执行结果。
- Cron 前端预览不得被用作实际调度依据。
- 后端接入后必须保留项目权限、环境归属和资产引用的重复校验。
