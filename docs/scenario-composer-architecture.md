# 场景组合前端技术文档

## 1. 模块定位

场景组合入口为 `/scenarios`，用于把当前项目中的 HTTP 和 WebSocket 测试用例编排为可版本化业务场景，并支持条件、等待、数据集和步骤失败策略。

相关代码：

| 文件 | 职责 |
| --- | --- |
| `src/pages/ScenariosPage.tsx` | 场景列表、编排画布、数据集、属性和运行历史 |
| `src/api/scenarios.ts` | 请求响应映射、CRUD、复制、删除、执行和运行详情 |
| `src/pages/ScenariosPage.test.tsx` | 场景核心业务闭环测试 |

## 2. 数据流

```text
ScenariosPage
  -> listScenarios / getScenario / listScenarioRuns
  -> 页面内部 camelCase 模型
  -> src/api/scenarios.ts 转换为后端 snake_case
  -> /api/v1/scenarios 与 /api/v1/scenario-runs
```

场景业务数据由后端数据库保存，浏览器不再保存场景定义或模拟运行记录。

## 3. 页面能力

- 按项目查询、新建、编辑、复制和软删除场景。
- 加载当前项目 HTTP 与 WebSocket 测试用例。
- 添加用例、条件和等待步骤。
- 调整步骤顺序和失败后是否继续。
- 编辑步骤配置 JSON。
- 维护执行环境、标签和多组数据集变量。
- 保存场景不可变版本。
- 调用后端真实执行接口并展示运行与步骤结果。

## 4. 数据模型

`TestScenario` 主要字段：

```ts
interface TestScenario {
  id: string;
  projectId: number;
  version: number;
  name: string;
  description: string;
  environmentId?: number;
  tags: string[];
  steps: ScenarioStep[];
  datasets: ScenarioDataset[];
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
}
```

页面以 `configText` 和 `variablesText` 编辑 JSON 字符串；API 层在提交前解析为后端要求的 `config` 和 `variables` 对象。

## 5. 保存与版本控制

新建场景调用 `POST /scenarios`。已保存场景调用 `PUT /scenarios/{scenarioId}`，并携带当前 `version`。

HTTP `409` 表示编辑期间场景已被其他请求更新。前端展示后端错误信息，不覆盖服务端新版本。

保存前校验：

- 场景名称非空。
- 至少包含一个步骤。
- 已选择执行环境。
- 步骤配置和数据集变量必须是 JSON 对象。

项目、环境和引用用例归属由后端再次校验。

## 6. 执行与运行详情

页面保存最新场景版本后调用：

```text
POST /scenarios/{scenarioId}/execute?project_id={projectId}
```

请求包含环境和唯一幂等键。未显式传数据集列表时，后端执行全部启用数据集；每个数据集生成独立运行。

执行完成后，页面调用 `/scenario-runs/{runId}` 获取步骤详情。运行状态支持 `running`、`passed`、`failed` 和 `timeout`，步骤还支持 `skipped`。

后端当前没有场景运行删除接口，因此前端不提供“清空调试记录”操作。

## 7. 安全与数据边界

- 所有请求显式携带当前 `project_id`。
- 场景查看需要 `scenario:view`。
- 场景创建、更新和删除需要 `scenario:manage`。
- 场景执行需要 `test:execute`。
- 前端不能把用例名称、路径或环境 ID 当作归属证明。
- 快照脱敏和加密由后端负责。

## 8. 测试覆盖

页面测试覆盖：

- 新建、保存版本和真实执行调用。
- 步骤排序和数据集维护。
- 项目切换后的数据隔离。
- 复制和软删除场景。

验证命令：

```bash
npm test -- --run
npm run build
```
