# 场景组合接口

状态：当前接口与目标执行契约
最后核验：2026-06-15

场景将 HTTP/WebSocket 基础用例、等待和条件步骤编排为可版本化的业务流程。基础路径为
`/api/v1`，接口使用 Bearer Token，成功响应统一为 `{code, message, data}`。

## 接口

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| GET/POST | `/scenarios?project_id={id}` | `scenario:view` / `scenario:manage` | 分页查询、创建场景 |
| GET/PUT/DELETE | `/scenarios/{scenario_id}?project_id={id}` | `scenario:view` / `scenario:manage` | 详情、更新、软删除 |
| POST | `/scenarios/{scenario_id}/execute?project_id={id}` | `test:execute` | 返回 `202 Accepted`，创建一组异步场景运行 |
| GET | `/scenario-runs?project_id={id}&scenario_id={id}` | `scenario:view` | 最近 200 条运行 |
| GET/DELETE | `/scenario-runs/{run_id}?project_id={id}` | `scenario:view` / `scenario:manage` | 运行和步骤详情、删除调试记录 |
| GET | `/scenario-runs/{run_id}/events?project_id={id}` | `scenario:view` | Bearer 鉴权 SSE 事件流 |

请求字段同时接受 snake_case 和文档注明的 camelCase 别名；响应统一使用 snake_case。
列表响应结构为 `{items, total, page, page_size}`，`page_size` 最大为 200。

## 场景定义与版本

```json
{
  "name": "登录下单",
  "environmentId": 1,
  "tags": ["P0"],
  "steps": [
    {
      "id": "STEP-1",
      "kind": "api_case",
      "referenceId": 11,
      "name": "登录",
      "method": "POST",
      "path": "/login",
      "configText": "{}",
      "continueOnFailure": false
    }
  ],
  "datasets": [
    {
      "id": "DATA-1",
      "name": "普通用户",
      "enabled": true,
      "variables": {
        "tenant_id": 1001
      },
      "records": [
        {
          "id": "RECORD-1",
          "name": "正常用户",
          "enabled": true,
          "request_overrides": [
            {
              "step_id": "STEP-1",
              "target": "body",
              "path": "account.profile.name",
              "value": "tester"
            }
          ]
        }
      ]
    }
  ]
}
```

更新请求必须携带当前 `version`。版本冲突返回 HTTP `409` 和 `current_version`。
每次更新生成不可变的 `test_scenario_versions` 记录。场景版本保存基础用例执行快照，
后续修改基础用例不会改变旧版本。

### 条件与等待步骤配置

条件和等待步骤继续复用 `steps[].config` 对象，不要求后端新增字段。前端提供结构化表单，
保存时转换为以下执行配置：

```json
[
  {
    "kind": "condition",
    "config": {
      "expression": "{{orderStatus}} != 500"
    }
  },
  {
    "kind": "delay",
    "config": {
      "duration_ms": 5000
    }
  }
]
```

- `condition.expression` 是执行器最终使用的表达式。前端常用表单支持变量、`==`、`!=`、`>`、`>=`、`<`、`<=`、文本、数字、布尔值和空值。
- `delay.duration_ms` 是非负整数毫秒。前端允许用户按毫秒、秒或分钟输入并统一换算。
- 历史复杂表达式必须原样返回。前端不展示原始 JSON 编辑入口；用户使用结构化表单修改后，配置转换为标准条件表达式。
- 后端不得依赖前端专用展示字段；步骤名称和 `path` 摘要不参与条件或等待执行。

## 数据集与测试记录

一个数据集包含多条完整 `records`。数据集和记录都为启用状态时，每条记录产生一个独立 run。
`request_overrides` 按 `step_id + target + path` 定位请求字段，`target` 支持 `path`、
`headers`、`query_params` 和 `body`。深层 Body 路径支持对象段和数组索引。

标准写入结构只使用 `records[].request_overrides[].value`。兼容读取旧数据集级
`request_overrides` 时，可把 `values[]` 的每个索引迁移为一条记录，把单个 `value`
迁移为一条记录；新响应不得继续输出旧结构。

详细覆盖顺序和校验见 `../docs/scenario-data-driven-contract.md`。

## 执行启动

执行请求：

```json
{
  "environmentId": 1,
  "datasetIds": ["DATA-1"],
  "idempotencyKey": "client-generated-key"
}
```

规则是确定的：

- 未传 `datasetIds`：执行全部 `enabled=true` 的数据集。
- 传入非空数组：只执行指定数据集，允许显式选择已停用数据集。
- 传入空数组：不执行任何数据集，返回空运行列表。
- 场景完全没有数据集且未传 `datasetIds`：以空变量执行一次。
- 指定不存在的数据集：返回 HTTP `400`。

成功返回 `202 Accepted`：

```json
{
  "execution_id": "SCENARIO-EXEC-1",
  "scenario_id": "SCENARIO-1",
  "scenario_version": 9,
  "status": "queued",
  "created_at": "2026-06-15T08:00:00.000Z",
  "runs": [
    {
      "run_id": "RUN-1",
      "dataset_id": "DATA-1",
      "dataset_name": "普通用户",
      "record_id": "RECORD-1",
      "record_name": "正常用户",
      "status": "queued",
      "events_url": "/api/v1/scenario-runs/RUN-1/events?project_id=7",
      "detail_url": "/api/v1/scenario-runs/RUN-1?project_id=7"
    }
  ]
}
```

`dataset_id`、`record_id` 和 `record_name` 是多记录数据驱动的必需运行身份字段。
前端会在启动响应、事件、运行列表和详情中映射这些字段，并以“数据集 · 测试记录”
切换画布和展示调试历史。`record_name` 缺失时回退显示稳定的 `record_id`；后端不能
只返回数据集名称，否则同一数据集内的不同输入无法精确审计。

事件顺序、重连和详情字段见：

- `../docs/scenario-run-events-contract.md`
- `../docs/scenario-run-detail-contract.md`
- `../docs/scenario-variable-tracing-contract.md`

前端消费事件流时会携带 `Last-Event-ID` 自动重连，并按 `run_id + sequence`
去重。事件序号出现缺口或接口返回 `409 EVENT_HISTORY_EXPIRED` 时，前端会读取
`detail_url` 对应的运行详情校准画布。历史过期错误既可以直接返回，也可以放在
平台统一响应包裹的 `data` 字段中。

## 环境与幂等

执行环境必须属于当前项目且未删除。没有传执行环境时使用场景绑定环境。

幂等键作用域为当前项目，当前实现不自动过期。每个数据集派生独立键。同一键和相同请求返回
原运行；同一键对应不同场景版本、环境、数据集或计划运行时返回 HTTP `409`。

## 状态与审计

场景运行状态包括 `running`、`passed`、`failed`、`timeout`。步骤还可能为 `skipped`。
关联链如下：

```text
test_plan_runs
  -> test_scenario_runs.plan_run_id
     -> test_case_executions.scenario_run_id
     -> websocket_test_case_executions.scenario_run_id
```

场景快照和变量快照对敏感字段进行掩码。场景版本中的 Authorization、Cookie、Token、
Password、Secret、API Key 等字段使用 `SNAPSHOT_ENCRYPTION_KEY` 加密保存；未配置时使用
`JWT_SECRET_KEY` 派生密钥。生产环境必须配置独立且稳定的加密密钥。

## 错误响应

HTTP 和参数校验错误统一返回：

```json
{
  "code": 409,
  "message": "幂等键已用于不同的场景执行请求",
  "data": "幂等键已用于不同的场景执行请求"
}
```
