# 文档索引

所有开发者和 AI 在修改业务代码前，应先阅读 [文档治理与 AI 开发规范](documentation-governance.md)。根目录 [AGENTS.md](../AGENTS.md) 是 AI 开发的强制入口。

## 计划与总览

| 文档 | 说明 |
| --- | --- |
| [documentation-governance.md](documentation-governance.md) | 文档分层、权威来源、术语、同步矩阵和 AI 开发流程 |
| [frontend-development-plan.md](frontend-development-plan.md) | 前端当前完成状态、质量基线、优先级和后续开发计划 |
| [technical-architecture.md](technical-architecture.md) | 项目整体技术架构、模块关系、权限与数据边界 |
| [frontend-feature-logic.md](frontend-feature-logic.md) | 当前页面功能、业务流程和交互逻辑 |
| [frontend-performance.md](frontend-performance.md) | 性能、请求竞态和前端维护约定 |

## 业务模块

| 文档 | 说明 |
| --- | --- |
| [scenario-composer-architecture.md](scenario-composer-architecture.md) | 场景组合、单步调试、变量关系、异步执行和实时动画架构 |
| [test-plan-architecture.md](test-plan-architecture.md) | 测试计划数据模型、版本、调度和执行边界 |
| [visual-flow-architecture.md](visual-flow-architecture.md) | 可视化编排节点、连线、变量关系和执行模型 |
| [defect-tracking-architecture.md](defect-tracking-architecture.md) | 缺陷记录、富文本内容和 Bug 状态流转流程 |
| [../api_docs/api_environment_configs.md](../api_docs/api_environment_configs.md) | 环境配置接口与数据关系 |

## 场景执行契约

| 文档 | 说明 |
| --- | --- |
| [scenario-data-driven-contract.md](scenario-data-driven-contract.md) | 数据集、测试记录、请求覆盖、深层 JSON 路径和兼容规则 |
| [scenario-run-events-contract.md](scenario-run-events-contract.md) | `202` 异步启动、SSE 事件、顺序号、重连和状态机 |
| [scenario-run-detail-contract.md](scenario-run-detail-contract.md) | 运行列表与完整步骤详情结构 |
| [scenario-variable-tracing-contract.md](scenario-variable-tracing-contract.md) | 提取变量、绑定变量、原始类型和遮罩规则 |

## 后端与 Schema

| 文档 | 说明 |
| --- | --- |
| [../api_docs/README.md](../api_docs/README.md) | 后端接口契约、架构参考和历史开发记录的权威边界 |
| [../api_docs/api_scenarios.md](../api_docs/api_scenarios.md) | 场景、数据集、异步执行和运行详情接口 |
| [../api_docs/api_test_plans.md](../api_docs/api_test_plans.md) | 测试计划、调度和运行历史接口 |
| [../api_docs/api_visual_flows.md](../api_docs/api_visual_flows.md) | 可视化编排后端接口 |
| [../api_docs/api_defects.md](../api_docs/api_defects.md) | 缺陷跟踪、状态流转和富文本内容接口 |
| [../api_docs/visual_flow_schema.json](../api_docs/visual_flow_schema.json) | FlowDefinition JSON Schema |

功能变更应优先同步模块技术文档和 `frontend-feature-logic.md`；架构、权限或数据归属变化还需同步 `technical-architecture.md`；未完成工作更新到 `frontend-development-plan.md`。提交前运行 `npm run docs:check`。
