# 测试计划前端技术文档

## 1. 模块定位

测试计划入口为 `/plans`。计划只绑定当前项目中已经保存的 Scenario 版本，不直接绑定 HTTP、WebSocket 用例或可视化 Flow。

相关代码：

| 文件 | 职责 |
| --- | --- |
| `src/pages/PlansPage.tsx` | 列表、筛选、编辑、调度日历、手动运行和运行历史 |
| `src/api/plans.ts` | 请求响应映射、CRUD、启停、执行、调度、导入导出和运行历史 |
| `src/api/scenarios.ts` | 为计划编辑器提供可绑定的 Scenario |
| `src/pages/PlansPage.test.tsx` | 计划核心业务闭环测试 |

## 2. 数据流

```text
PlansPage
  -> listPlans / listPlanRuns / listPlanSchedule
  -> listScenarios
  -> 页面内部 camelCase 模型
  -> src/api/plans.ts 转换为后端 snake_case
  -> /api/v1/test-plans 与 /api/v1/test-plan-runs
```

所有请求显式携带 `project_id`。页面不保存计划业务数据到浏览器。

## 3. 页面能力

- 查询、新建、编辑、复制和软删除计划。
- 启用或停用计划。
- 按名称、说明、标签、状态和触发方式筛选。
- 绑定一个或多个环境。
- 从当前项目 Scenario 列表选择执行目标并调整顺序。
- 配置手动、Cron 和 Webhook 触发。
- 配置时区、串行/并行、失败策略、重试、超时和通知邮箱。
- 查询后端生成的未来调度实例。
- 创建手动运行并查看、删除或清空运行历史。
- 调用后端接口导入和导出计划。

## 4. 版本控制

`TestPlan.version` 来自后端。更新计划和启停计划时必须携带当前版本：

```text
读取 plan.version
-> 提交 PUT
-> 成功后使用响应中的新 version
-> HTTP 409 时向用户展示后端冲突信息
```

计划目标包含 `scenarioVersion`。创建时绑定场景当前版本；后续编辑非目标字段不会自动升级场景版本。

## 5. 手动执行

运行弹窗只展示计划已经绑定的环境。确认后调用：

```text
POST /test-plans/{planId}/execute?project_id={projectId}
```

请求包含 `environment_id` 和前端生成的唯一 `idempotency_key`。后端返回 HTTP `202` 和 `pending` 运行，页面随后刷新运行历史。

当前页面不会持续轮询运行状态。需要重新加载页面或重新进入模块获取最新的 `running`、`passed`、`failed` 或 `timeout` 状态。

## 6. 调度日历

日历数据来自 `/test-plans/schedule`，不在前端解析 Cron 表达式。后端返回的调度实例是唯一展示依据。

## 7. 导入导出

- 导入调用 `POST /test-plans/import?project_id={projectId}`。
- 导出调用 `GET /test-plans/export?project_id={projectId}`。
- 页面只负责读取或下载 JSON，项目归属、目标版本和环境有效性由后端校验。

## 8. 安全与权限

后端权限包括 `plan:view`、`plan:create`、`plan:update`、`plan:delete`、`plan:run` 和 `plan:history:delete`。执行时还需要 `test:execute`。

前端不能把按钮隐藏当作权限校验，也不能绕过 `src/api/plans.ts` 直接调用计划接口。

## 9. 测试覆盖

页面测试覆盖：

- 绑定 Scenario 创建计划。
- 保存场景版本信息。
- 启停计划。
- 创建 `pending` 手动运行。
- 项目切换后的数据隔离。
- 使用后端调度实例展示日历。

验证命令：

```bash
npm test -- --run
npm run build
```
