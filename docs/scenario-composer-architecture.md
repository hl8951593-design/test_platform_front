# 场景组合前端技术文档

## 1. 模块定位

场景组合模块入口为 `/scenarios`，用于把当前项目中的 HTTP 和 WebSocket 测试用例组合为有序业务场景，并补充条件判断、等待步骤、数据集和步骤级失败策略。

当前仓库尚未提供场景后端接口。场景定义与调试记录暂时按项目保存在浏览器 `localStorage`，运行结果为前端模拟结果，不代表真实接口执行结果。

相关代码：

| 文件 | 职责 |
| --- | --- |
| `src/pages/ScenariosPage.tsx` | 场景列表、步骤编排、属性配置、数据驱动和调试历史 |
| `src/api/scenarios.ts` | 场景模型、项目隔离持久化、复制、删除和模拟运行 |
| `src/App.tsx` | 注入当前项目、当前环境和项目环境列表 |
| `src/pages/ScenariosPage.test.tsx` | 场景核心业务闭环测试 |

## 2. 当前功能

- 按项目维护场景，新建、编辑、复制和删除。
- 搜索场景名称、说明和标签。
- 并行加载当前项目 HTTP 与 WebSocket 测试用例。
- 添加测试用例、条件判断和等待步骤。
- 调整步骤顺序、删除步骤和配置失败后是否继续。
- 编辑步骤配置 JSON，并在保存时校验 JSON。
- 为场景选择执行环境和维护标签。
- 新增、编辑、启停和删除数据集。
- 保存场景后执行前端模拟运行。
- 展示当前场景的步骤级调试结果。
- 切换项目后重新读取对应项目场景，禁止跨项目混用。

## 3. 数据模型

```ts
interface TestScenario {
  id: string;
  projectId: number;
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

```ts
interface ScenarioStep {
  id: string;
  kind: "api_case" | "websocket_case" | "delay" | "condition";
  referenceId?: string | number;
  name: string;
  method: string;
  path: string;
  configText: string;
  continueOnFailure: boolean;
}
```

```ts
interface ScenarioDataset {
  id: string;
  name: string;
  enabled: boolean;
  variablesText: string;
}
```

测试用例步骤通过 `kind + referenceId` 引用真实资产，名称、方法和路径是展示快照。条件与等待步骤没有 `referenceId`。

## 4. 页面结构

页面采用三栏工作区：

1. 左侧：场景列表、场景搜索、测试用例与内置步骤资产。
2. 中间：场景名称、说明、流程设计、数据驱动和调试记录。
3. 右侧：场景环境和标签配置，或当前选中步骤配置。

流程设计支持步骤添加、选择、上移、下移和删除。数据驱动支持多组 JSON 变量。调试记录展示环境、数据集、场景状态和每个步骤结果。

## 5. 保存校验

保存场景前必须满足：

- 已选择项目。
- 场景名称非空。
- 至少包含一个步骤。
- 已选择执行环境。
- 每个步骤的 `configText` 是合法 JSON。
- 每个数据集的 `variablesText` 是合法 JSON。

后端接入后必须重复校验项目、环境和引用用例归属，不能信任前端提交。

## 6. 模拟运行规则

当前 `runScenario` 只生成前端模拟结果：

- 每个启用数据集分别生成一条调试记录；没有启用数据集时使用第一条数据。
- 步骤名称包含“失败”，或配置 JSON 包含 `"simulateFailure": true` 时模拟失败。
- 失败且 `continueOnFailure = false` 时，后续步骤记录为未执行。
- 运行结果按项目最多保存 200 条。

真实后端接入后应删除这些模拟规则，由执行器返回步骤结果、变量快照、请求响应摘要和日志。

## 7. 本地持久化

| Key | 内容 |
| --- | --- |
| `testauto_scenarios_project_{projectId}` | 当前项目场景定义 |
| `testauto_scenario_runs_project_{projectId}` | 当前项目场景调试记录 |

本地存储无法跨浏览器或设备同步，也不具备权限、审计和并发控制能力。

## 8. 建议后端接口

| 接口 | 方法 | 说明 |
| --- | --- | --- |
| `/scenarios?project_id={projectId}` | `GET` | 查询场景列表 |
| `/scenarios?project_id={projectId}` | `POST` | 创建场景 |
| `/scenarios/{scenarioId}?project_id={projectId}` | `GET` | 查询场景详情 |
| `/scenarios/{scenarioId}?project_id={projectId}` | `PUT` | 更新场景 |
| `/scenarios/{scenarioId}?project_id={projectId}` | `DELETE` | 删除场景 |
| `/scenarios/{scenarioId}/execute?project_id={projectId}` | `POST` | 执行场景 |
| `/scenario-runs?project_id={projectId}&scenario_id={scenarioId}` | `GET` | 查询调试历史 |
| `/scenario-runs/{runId}?project_id={projectId}` | `GET` | 查询步骤执行详情 |

执行接口请求建议包含：

```json
{
  "environment_id": 1,
  "dataset_ids": ["DATA-1"],
  "idempotency_key": "client-generated-key"
}
```

后端应保存不可变场景版本和用例快照，执行时按步骤顺序解析数据变量和上游输出。

## 9. 测试覆盖

`src/pages/ScenariosPage.test.tsx` 覆盖：

- 创建、配置、保存和运行场景。
- 测试用例资产映射。
- 步骤排序。
- 数据集新增与保存。
- 项目数据隔离。

修改场景组合模块后至少运行：

```bash
npm test -- --run
npm run build
```
