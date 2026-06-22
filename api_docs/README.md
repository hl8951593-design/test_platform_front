# API 文档索引

状态：接口文档入口
最后核验：2026-06-17

`api_docs/` 中只有 `api_*.md` 是按模块维护的接口契约。架构参考和开发记录用于解释历史背景，不得覆盖当前接口文档、前端 contract、类型和测试。

## 当前接口契约

| 文档 | 模块 |
| --- | --- |
| [api_auth.md](api_auth.md) | 认证与 Token |
| [api_project_permissions.md](api_project_permissions.md) | 项目与权限 |
| [api_environment_configs.md](api_environment_configs.md) | 环境和变量 |
| [api_test_cases.md](api_test_cases.md) | HTTP 测试用例 |
| [api_test_case_multi_environment.md](api_test_case_multi_environment.md) | HTTP 用例多环境补充契约 |
| [api_websocket_test_cases.md](api_websocket_test_cases.md) | WebSocket 测试用例 |
| [api_scenarios.md](api_scenarios.md) | 场景、数据集、异步运行和运行详情 |
| [api_test_plans.md](api_test_plans.md) | 测试计划、调度和运行历史 |
| [api_visual_flows.md](api_visual_flows.md) | 可视化流程 |
| [api_defects.md](api_defects.md) | 缺陷跟踪 |
| [api_media.md](api_media.md) | 缺陷图片媒体存储 |
| [api_ai.md](api_ai.md) | AI 数据源 |
| [visual_flow_schema.json](visual_flow_schema.json) | FlowDefinition JSON Schema |

## 架构参考

| 文档 | 状态 |
| --- | --- |
| [technical_architecture.md](technical_architecture.md) | 后端总体参考设计；需结合当前接口和实际后端仓库核验 |
| [ai_deepseek_technical_guide.md](ai_deepseek_technical_guide.md) | DeepSeek 能力设计参考，不是平台接口契约 |

## 历史开发记录

以下文档保留历史决策和实施背景，但不是当前完成状态或开发计划的权威来源：

- [development_technical_notes.md](development_technical_notes.md)
- [development_ai_notes.md](development_ai_notes.md)
- [development_multi_environment_notes.md](development_multi_environment_notes.md)

当前前端计划以 [frontend-development-plan.md](../docs/frontend-development-plan.md) 为准；跨模块架构以 [technical-architecture.md](../docs/technical-architecture.md) 为准。
