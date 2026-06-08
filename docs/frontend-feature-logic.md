# 前端功能逻辑说明

本文档记录 TestAuto 前端当前已经实现的核心功能逻辑，作为后续开发、联调和排查问题时的依据。代码以 `src/App.tsx`、`src/api/`、`src/pages/ApiPage.tsx`、`src/pages/EnvironmentConfigsPage.tsx` 为主。

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
| 当前项目 | `/projects` | 环境列表、接口用例列表、环境配置页、变量、执行接口 |
| 当前环境 | `/environment-configs?project_id={projectId}` | 接口用例过滤、变量展示、用例调试和运行 |

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
| 断言、示例响应 | 与 HTTP 用例保持一致的编辑与展示方式 |

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
| 示例响应 | 调试或样例响应展示 |

保存前会校验项目、环境、用例名称、请求地址等必要字段。

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

前端调用：

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

前端调用：

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
- AI 返回的扩写摘要、warnings。
- 可勾选的扩展用例草稿列表。
- 每条草稿的 Params、Headers、Body 和断言摘要。

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

## 样式与交互约定

当前 UI 风格以浅色背景、蓝色主按钮、浅蓝描边卡片、紧凑表格为主。

| 组件 | 约定 |
| --- | --- |
| 状态筛选 | 使用分段按钮样式 |
| 请求方式筛选 | 使用多选下拉，勾选图标居中显示 |
| 环境多选 | 使用环境 chip 按钮，选中态带勾选图标 |
| 环境配置 | 卡片负责展示，弹窗只在新增或编辑时出现 |
| 错误提示 | 表单内错误贴近字段展示，不遮挡主要按钮 |
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
npm test -- --runInBand
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
