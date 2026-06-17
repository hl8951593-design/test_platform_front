# TestAuto Dev Test Platform

TestAuto 是一个面向自动化测试设计、编排、执行、诊断和报告分析的前端项目，使用 React、TypeScript 和 Vite 构建。

## 常用命令

```bash
npm install
npm run dev
npm run docs:check
npm test -- --run
npm run build
```

## 环境配置

后端接口默认地址：

```text
http://127.0.0.1:8000/api/v1
```

可在 `.env` 中覆盖：

```text
VITE_API_BASE_URL=http://example.com/api/v1
VITE_AUTH_REFRESH_PATH=/auth/refresh
```

## 当前重点能力

- HTTP 与 WebSocket 测试用例维护和调试。
- 测试计划、环境配置和可视化编排。
- 可版本化场景组合、断言、响应取值和上下游变量绑定。
- `202 Accepted + SSE` 场景异步执行。
- 按真实后端事件驱动节点状态和连线动画。
- 完整运行请求、响应、断言、错误和变量追踪。

## 技术文档

- [AI 开发入口](AGENTS.md)
- [文档索引](docs/README.md)
- [文档治理规范](docs/documentation-governance.md)
- [前端开发计划](docs/frontend-development-plan.md)
- [场景组合技术架构](docs/scenario-composer-architecture.md)
- [场景实时事件契约](docs/scenario-run-events-contract.md)
- [整体技术架构](docs/technical-architecture.md)
