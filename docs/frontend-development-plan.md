# 前端开发计划

状态：当前计划
最后核验：2026-06-27

## 1. 当前目标

前端当前阶段的目标是把 TestAuto 从页面原型推进为可联调、可验证、可持续维护的自动化测试平台。开发优先级按以下原则排序：

1. 核心业务数据必须来自真实后端接口。
2. 执行状态和运行结果必须以服务端记录为准，前端不模拟成功、失败或步骤进度。
3. 场景、计划、流程和用例必须遵守项目、环境和版本边界。
4. 新增能力必须同步更新类型、接口封装、页面测试和技术文档。

## 2. 已完成

### 基础能力

- React 19、TypeScript、Vite 和 Vitest 工程基础。
- Bearer Token 鉴权、Token 主动刷新和认证失效通知。
- 项目与环境切换、真实环境配置、接口用例资产加载。
- HTTP 和 WebSocket 测试用例维护与单用例调试。
- 场景脚本节点使用 CodeMirror 编辑 Python/JavaScript，支持前置变量选择、语言高亮、字节计数，以及变量名、输入来源、超时、代码上限、顶层 `return` 和常见沙箱禁用语法的保存/运行前校验。
- 接口用例列表使用“协议类型 + 后端主键”作为稳定记录身份，修复重复展示编号导致编辑后多行被同时替换的问题，并覆盖部分更新响应不返回主键的场景。
- HTTP 和 WebSocket 用例新增/编辑器统一使用“响应”术语，准确表达实际调试结果和已保存响应。
- 建立全局分页组件并接入接口用例、项目、环境、测试计划、计划执行历史、场景和执行队列主列表；支持每页条数、筛选重置和删除后的页码回退。
- 新增缺陷跟踪模块，支持摘要列表、独立详情路由、按项目记录 Bug、维护富文本与图片附件、筛选分页和状态流转；粘贴截图以内嵌媒体形式插入正文光标位置，详情正文支持双击灯箱预览和多图切换，独立选择的图片保留在附件区；编辑、删除集中在详情页，列表状态操作收纳到三点菜单。
- 新增 Agent Runtime 前端工作台：`/agents` 路由、`src/types/agents.ts` 契约类型、`src/api/agents.ts` 普通 API 封装、`src/api/agentStream.ts` SSE fetch parser、本地 conversation/run history、创建 Agent Run、Codex 式三栏工作线程、右侧 Run/Tool/Approval/Memory/Runbook/Dashboard Inspector、ToolCall 详情 hydration、approval CAS 提交、Migration/Context/Loop/Memory 二级资源刷新、Runbook safe actions 到 `resume`、`reconcile`、`tool_call_detail` 的前端映射、SSE 断线自动重连、history 搜索/重命名/置顶/删除/导出、快捷键和 readiness checks 展示。中央线程已合并连续 assistant/model delta 为单条 Agent 回复，并按 `tool_call_id` 把工具调用、输入、输出和权限信息内联回对话流。当前后端未提供服务端 conversation/run list，跨设备历史仍是目标契约，本地 history 仅作为 MVP index。

### 测试计划

- 计划 CRUD、启停、手动运行、调度预览和运行历史。
- 计划绑定场景版本、环境、失败策略和通知配置。

### 可视化编排

- 流程节点与连线编辑、保存、校验和试运行。
- 节点引用接口用例及上下游数据关系展示。

### 场景组合

- 场景 CRUD、版本控制、复制、软删除和数据集维护。
- 场景画布改为测试用例节点；左侧添加主测试用例，节点卡直接添加只绑定该用例的前置/后置动作。前置或测试用例失败后仍执行该节点全部后置清理动作。
- 数据驱动按场景步骤展开 Path、Header、Query 和任意深度 JSON Body 请求字段。
- 一个数据集维护多条完整测试记录，每条启用记录保存独立请求覆盖值并产生一次场景运行。
- 数据集、请求覆盖字段和测试记录支持模块内定位或详情弹窗。
- HTTP、WebSocket、等待和条件步骤编排。
- 条件和等待步骤提供结构化配置表单，常用判断和等待时长无需编写 JSON；步骤配置页不再展示原始高级 JSON。
- 单步骤调试、响应树展开、搜索、响应取值和断言维护。
- 单步骤调试失败时画布节点显示浅红底色、红色边框和失败耗时；整场实时状态优先于临时调试状态。
- 场景组合页完成专业编排工作台视觉升级：紧凑粘性命令栏、左侧主测试用例列表、节点绑定动作弹窗、收窄场景导航、扩大编排画布、步骤状态层级和右侧配置分组；请求配置默认折叠，单步执行收进检查器标题栏，执行结果先展示紧凑响应摘要并由用户按需展开弹窗，移除只读的引用测试用例展示。
- 步骤配置将“通过标准”统一为“断言”，并默认折叠断言编辑区，通过摘要展示配置数量。
- `_scenario_context.extractions` 与 `_scenario_context.bindings` 显式配置。
- 画布展示上下游变量关系、运行提取值和实际绑定值。
- 运行记录按需加载完整请求、响应、断言、错误和变量追踪。
- 异步执行接口 `202 Accepted` 接入。
- 使用带 Bearer Token 的 `fetch` 流式订阅 SSE。
- 使用 `step_started` 驱动节点运行状态。
- 使用 `transition_started` 驱动真实节点连线动画。
- 支持完成、失败、超时、跳过和断线后的详情恢复。
- SSE 连接中断后自动重连并携带最后收到的 `Last-Event-ID`，按 `run_id + sequence` 去重重放事件。
- 事件序号出现缺口或服务端返回事件历史过期 `409` 时，自动读取运行详情校准画布，并展示可关闭的连接状态提示。
- 多数据集、多测试记录执行时按 `run_id` 隔离实时状态，画布提供“数据集 · 测试记录”切换器并同步步骤状态、连接提示和最终详情。
- 启动响应、实时事件和运行详情映射 `dataset_id`、`record_id`、`record_name`，运行历史可独立定位同一数据集中的每条测试记录。

### 文档工程

- 建立 `AGENTS.md` 作为 AI 开发强制入口。
- 建立文档分层、状态、统一术语和同步矩阵。
- 增加 `npm run docs:check`，检查本地链接、核心索引和场景关键契约。

## 3. 当前质量基线

- 全量测试和生产构建必须在交付前重新运行，结果以当次命令输出为准，不在文档中长期维护易失真的固定数量。
- 构建检查：`tsc -b && vite build` 通过。
- 场景模块包含 API 契约测试、页面交互测试和 SSE 事件解析测试。
- 新代码不得重新引入基于固定计时器模拟场景执行进度的逻辑。

## 4. 下一阶段计划

### P0：运行控制

- 接入场景运行取消接口。
- 展示 `queued`、`cancelled` 和取消中的状态。
- 防止重复点击产生无意义的新幂等键。

### P1：场景编辑器

- 持续核验破坏性的 `nodes[]` 契约和执行器联调：前端已支持随机数、固定 JSON 值和与后端沙箱限制对齐的 Python/JavaScript 代码编辑器；部署侧仍需确认 Node.js 可用性，并持续覆盖后端字段校验、变量作用域、失败策略、资源限制、安全权限、脱敏、SSE 节点定位、运行详情及存量数据一次性迁移。
- 将超长的 `ScenariosPage.tsx` 拆分为画布、属性栏、运行历史和响应树模块。
- 抽离场景实时执行状态为独立 Hook。
- 抽离 SSE 解析器并补充重连、分块和错误响应测试。
- 为数据记录增加批量粘贴、CSV/JSON 导入、列级校验和大数据量分页或虚拟滚动。
- 为变量重命名提供引用同步和冲突检查。

### P1：运行诊断

- 在节点上展示步骤开始时间、实时耗时和最终耗时。
- 展示失败步骤的错误码和断言摘要。
- 支持从步骤运行记录跳转到底层 HTTP/WebSocket 执行详情。
- 对大响应、截断响应和敏感字段遮罩给出明确标识。

### P2：平台一致性

- 统一场景组合与可视化编排的节点状态、颜色和动画语义。
- 统一执行中心、测试计划和场景运行的状态枚举。
- 建立通用的运行详情组件和 JSON 快照组件。
- 将测试报告中的“生成缺陷”入口接入缺陷创建弹窗或后端预填接口。
- 补充无障碍键盘操作和窄屏布局。
- 为场景工作台增加可折叠侧栏、可调整栏宽和紧凑/详细步骤密度切换。

### P1：Agent Runtime 联调

- 随后端 Phase 1 联调 `/agents/runs`、`/agents/runs/{run_id}` 和 `/agents/runs/{run_id}/events`，确认 EventStore sequence、SSE replay、终态校准和 Run status 映射。
- 随后端 Phase 2/3 联调 `GET /agents/tool-calls/{tool_call_id}`、ToolCall redacted input/output、required permissions、reconcile attempts、BackendEffectCapability 和 recovery decision。
- 随后端 Phase 4 联调 approve/reject 的 CAS body、stale、superseded、epoch conflict 和 409 错误态。
- 随后端 Phase 5 联调 ContextBuild、LoopObservation、Memory usage feedback 和高风险 Memory-only 提示。
- 随后端 Phase 6 联调 migration resolve 后的 Freshness Gate、readiness dashboard、metrics、alerts、release gates、Runbook safe action 权限隐藏和后端结果语义。
- 等后端新增服务端 conversation/run list 契约后，再把本地 history index 升级为跨设备历史，并替换当前本地导出的有限快照。
- 抽拆 `src/pages/AgentsPage.tsx` 为 `src/components/agent/` 组件族，降低后续联调和专项测试维护成本。

## 5. 开发完成标准

一项前端功能只有同时满足以下条件才视为完成：

- 真实接口或明确的前端数据源已经接入。
- 类型定义与 snake_case/camelCase 映射完整。
- loading、empty、error、success 和中断状态均有处理。
- 至少包含关键业务路径的自动化测试。
- `npm test -- --run` 和 `npm run build` 通过。
- `npm run docs:check` 通过。
- 对应技术文档和接口契约已更新。

## 6. 相关文档

- [场景组合前端架构](scenario-composer-architecture.md)
- [数据驱动请求覆盖契约](scenario-data-driven-contract.md)
- [场景实时事件契约](scenario-run-events-contract.md)
- [场景运行详情契约](scenario-run-detail-contract.md)
- [场景变量追踪契约](scenario-variable-tracing-contract.md)
- [整体技术架构](technical-architecture.md)
- [缺陷跟踪前端架构](defect-tracking-architecture.md)
