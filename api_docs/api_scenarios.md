# 场景组合接口

状态：破坏性目标契约（前端已切换，后端需同步实现）
最后核验：2026-06-19

场景将 HTTP/WebSocket 基础用例、等待和条件步骤编排为可版本化的业务流程。基础路径为
`/api/v1`，接口使用 Bearer Token，成功响应统一为 `{code, message, data}`。

## 接口

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| GET/POST | `/scenarios?project_id={id}` | `scenario:view` / `scenario:manage` | 分页查询、创建场景 |
| GET/PUT/DELETE | `/scenarios/{scenario_id}?project_id={id}` | `scenario:view` / `scenario:manage` | 详情、更新、软删除 |
| POST | `/scenarios/{scenario_id}/execute?project_id={id}` | `test:execute` | 返回 `202 Accepted`，创建一组异步场景运行 |
| POST | `/scenarios/actions/script/execute-unsaved?project_id={id}` | `test:execute` | 使用当前未保存脚本配置和调试输入执行一次沙箱脚本 |
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
  "nodes": [
    {
      "name": "登录",
      "id": "NODE-1",
      "before_actions": [
        { "id": "ACTION-1", "kind": "random", "name": "生成订单号", "config": { "type": "uuid", "output": "orderNo" }, "continue_on_failure": false }
      ],
      "test_case": {
        "id": "STEP-1", "kind": "api_case", "reference_id": 11, "name": "登录", "method": "POST", "path": "/login", "config": {}, "continue_on_failure": false
      },
      "after_actions": [
        { "id": "ACTION-2", "kind": "script", "name": "清理登录态", "config": { "language": "python", "code": "result = {}", "inputs": ["token"], "outputs": ["result"], "timeout_ms": 10000 }, "continue_on_failure": true }
      ]
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

响应中的 `environment_name` 是展示字段，前端会保存在场景模型中，并在调试记录自身未返回环境名时作为标题兜底；创建或更新场景时仍只提交 `environment_id`。

### 测试用例节点与绑定动作

场景的基本编排单位改为 `nodes[]`。每个节点必须有且只有一个 `test_case`，并可包含有序的 `before_actions[]` 和 `after_actions[]`。动作的位置由容器表达，不再提交 `steps` 或 `execution_phase`。

- 执行顺序为节点顺序；单节点内部固定为 `before_actions -> test_case -> after_actions`。
- 前置动作失败且 `continue_on_failure=false` 时跳过该节点剩余前置动作和 `test_case`，但仍进入该节点后置动作。
- 测试用例失败后仍执行本节点全部后置动作；单个后置动作失败不阻止其余后置动作。
- 动作仅能读取执行到当前位置时可见的场景变量，并通过 `config.output` 或 `config.outputs` 声明写入变量；JSON 值保留原始类型。
- `kind` 第一批为 `api_case`、`websocket_case`、`condition`、`delay`、`random`、`fixed_value`、`script`。主 `test_case` 只允许前两类；其余类型用于前置或后置动作。
- `script` 必须在后端受限沙箱执行，使用语言白名单、超时、资源限额和输入/输出变量白名单，禁止文件、进程和默认网络访问。

这是破坏性升级：后端不读取旧 `steps/execution_phase`，前端也不发送旧结构。已有场景必须在发布前通过一次性迁移转换为 `nodes`，无法可靠迁移的数据应阻止上线或明确清理，不能在运行时双写或猜测。

更新请求必须携带当前 `version`。版本冲突返回 HTTP `409` 和 `current_version`。
每次更新生成不可变的 `test_scenario_versions` 记录。场景版本保存基础用例执行快照，
后续修改基础用例不会改变旧版本。

### 内置动作配置

所有动作使用各自的 `config` 对象。前端提供结构化表单，
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
  },
  { "kind": "random", "config": { "type": "integer", "min": 1, "max": 100, "output": "randomValue" } },
  { "kind": "fixed_value", "config": { "output": "enabled", "value": true } },
  { "kind": "script", "config": { "language": "javascript", "code": "result = { ok: true };", "inputs": ["token"], "outputs": ["result"], "timeout_ms": 10000 } }
  }
]
```

- `condition.expression` 是执行器最终使用的表达式。前端常用表单支持变量、`==`、`!=`、`>`、`>=`、`<`、`<=`、文本、数字、布尔值和空值。
- `delay.duration_ms` 是非负整数毫秒。前端允许用户按毫秒、秒或分钟输入并统一换算。
- `random.type` 支持 `integer`、`string`、`uuid`；整数校验 `min <= max`，字符串长度必须为正整数。
- `fixed_value.value` 接受任意 JSON 值并保留类型，`output` 必须是合法变量名。
- `script.language` 支持 `python`、`javascript`；JavaScript 运行要求服务器安装 Node.js。`code` 最大 `100 KB`，输入和输出数据分别最大 `1 MB`，`timeout_ms` 是 `1～60000` 的整数，输入和输出名称必须是对应语言的合法变量名。
- `script.inputs[]` 中的每个变量必须在当前执行位置由前置节点提供；任一输入不可用时不执行脚本并返回 `Script inputs are unavailable`。脚本在顶层执行，不能使用顶层 `return`，而是直接给 `script.outputs[]` 声明的变量赋值；未赋值的输出为 `null`，输出值必须可转换为 JSON。
- Python 支持变量赋值、`if/else`、`for/while`、列表/字典/元组、数值和字符串运算、下标、比较和布尔运算，以及 `abs`、`bool`、`dict`、`enumerate`、`float`、`int`、`len`、`list`、`max`、`min`、`range`、`round`、`sorted`、`str`、`sum`、`tuple`、`zip`。禁止 `import`、函数/类、`lambda`、属性访问、文件/网络/数据库、第三方库、`print`、`try/except`、`with`、`raise`、`eval/exec` 和 `__xxx__` 私有名称。
- JavaScript 同样不能访问 Node.js 模块、文件系统或网络。前端只做即时的常见错误检查，后端必须再次执行完整语法、安全、资源和 JSON 序列化校验。
- 历史复杂表达式必须原样返回。前端不展示原始 JSON 编辑入口；用户使用结构化表单修改后，配置转换为标准条件表达式。
- 后端不得依赖前端专用展示字段；步骤名称和 `path` 摘要不参与条件或等待执行。

### 脚本动作调试

脚本动作支持在场景保存前单独调试。前端提交当前编辑器内容、声明输入输出和本次调试输入值：

```http
POST /api/v1/scenarios/actions/script/execute-unsaved?project_id=7
```

```json
{
  "environment_id": 1,
  "language": "python",
  "code": "result = {\"ok\": companyId != 1}",
  "inputs": ["companyId"],
  "outputs": ["result"],
  "timeout_ms": 10000,
  "input_values": {
    "companyId": 9527
  }
}
```

`input_values` 只用于本次调试，不写入场景版本。保存和整场运行仍要求 `inputs[]`
来自执行位置之前已经声明的变量；调试允许用户手工提供输入值来验证脚本逻辑。
后端必须复用正式脚本沙箱的语言白名单、禁用能力、超时、资源限额和 JSON 序列化校验。

响应可以直接返回输出映射，也可以放在 `response_snapshot.outputs`、`response_snapshot.json`
或 `outputs` 中：

```json
{
  "status": "passed",
  "duration_ms": 24,
  "outputs": {
    "result": {
      "ok": true
    }
  },
  "error_message": ""
}
```

### AI 智能场景组合

智能场景组合通过 AI skill 统一入口提供：

```http
POST /api/v1/ai/skills/scenario-composer/runs
GET /api/v1/ai/skill-runs/{run_id}/events
GET /api/v1/ai/skill-runs/{run_id}
```

请求体：

```json
{
  "operation": "compose",
  "project_id": 1,
  "environment_id": 2,
  "input": {
    "requirement": "组合登录后查询用户详情的主链路",
    "scenario_name": "用户详情主链路",
    "http_test_case_ids": [1001, 1002],
    "websocket_test_case_ids": [],
    "include_bindings": true,
    "include_assertions": true,
    "include_hooks": true,
    "include_datasets": false,
    "include_latest_execution": true,
    "execute_candidates": false,
    "max_nodes": 10
  }
}
```

创建 run 后前端订阅 SSE 事件，展示 `model.delta` 累加文本以及 `tool.*`、`step.*` 执行轨迹。`run.completed` 的 `payload.result.scenario` 是结构兼容场景创建请求的草稿，不直接保存；如果 SSE 中断，前端通过 run 快照读取最终 `result` 或 `error_message`。前端必须先展示预览，由用户检查 `warnings`、节点顺序、前后置动作、主用例 config、提取器、变量绑定和断言；用户确认后再调用 `/scenarios?project_id={id}` 保存。`execute_candidates` 默认应为 `false`，开启前需要二次确认，因为候选用例会真实执行并可能产生业务副作用。

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

节点内动作事件及运行详情必须返回 `node_id`、`action_id`、`action_position`（`before|main|after`）和 `action_index`；`step_id/step_index` 可继续作为整次运行的扁平定位，但不能代替节点归属字段。

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
