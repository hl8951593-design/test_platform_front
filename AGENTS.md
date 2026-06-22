# TestAuto AI 开发入口

本文件是 AI 编码代理和新开发者进入仓库时的第一阅读入口。任何实现都必须先理解现有架构和契约，再修改代码。

## 开始前必读

1. 阅读 [文档索引](docs/README.md) 和 [文档治理规范](docs/documentation-governance.md)。
2. 涉及页面、组件或视觉交互时，阅读 [前端 UI 风格规范](docs/style.md)。
3. 阅读本次改动对应的模块文档；场景相关改动至少阅读：
   - [场景组合前端架构](docs/scenario-composer-architecture.md)
   - [数据驱动请求覆盖契约](docs/scenario-data-driven-contract.md)
   - [场景接口契约](api_docs/api_scenarios.md)
4. 检查 `git status --short`，保留并兼容已有工作区改动。
5. 先读类型、API 适配层和测试，再决定页面状态与后端字段。

## 架构边界

- 页面组件通过 `src/api/` 访问后端，不在页面中重复实现鉴权、响应解包或 snake_case/camelCase 转换。
- 项目是主要数据隔离边界；环境、场景、计划、流程和测试用例请求必须显式携带当前项目上下文。
- 场景定义、版本、运行记录和 SSE 事件以后端为权威数据源。
- 运行进度只能来自真实事件或运行详情，禁止使用本地计时器模拟成功、失败或步骤流转。
- JSON 值必须保留原始类型；敏感值由后端脱敏，前端不得通过其他快照推断原值。
- 数据驱动的基本执行单元是“测试记录”：一个数据集包含多条 `records`，每条启用记录产生一次独立场景运行。

## 文档同步矩阵

| 变更类型 | 必须同步 |
| --- | --- |
| 视觉语言、组件样式、交互反馈 | `docs/style.md`、模块架构文档；行为变化时同步 `docs/frontend-feature-logic.md` |
| 页面功能、交互、状态优先级 | 模块架构文档、`docs/frontend-feature-logic.md` |
| TypeScript 数据模型或序列化 | 模块架构文档、对应 contract、API 文档 |
| 接口路径、字段、状态码、错误语义 | `api_docs/` 对应文档、前端 contract |
| 权限、数据归属、跨模块关系 | `docs/technical-architecture.md` |
| 已完成能力、遗留风险、优先级 | `docs/frontend-development-plan.md` |
| 新增或重命名文档 | `docs/README.md`、必要时根 `README.md` |

## 完成标准

- 修改包含必要的 loading、empty、error、success、disabled 和中断状态。
- 关键业务路径有自动化测试，契约映射有 API 层测试。
- 运行 `npm run docs:check`、`npm test -- --run` 和 `npm run build`。
- 文档描述当前实现；尚未完成的设计必须明确标为“目标契约”或写入开发计划，不能写成已完成。
