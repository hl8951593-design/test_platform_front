import { requestWithAuth } from "./client";

export type FlowNodeKind = "api_case" | "websocket_case" | "condition" | "delay" | "start" | "end";

export interface FlowPosition {
  x: number;
  y: number;
}

export interface FlowInputBinding {
  id: string;
  target: string;
  sourceNodeId: string;
  sourcePath: string;
  fallback?: unknown;
}

export interface FlowNodeConfig {
  description?: string;
  condition?: string;
  delayMs?: number;
  continueOnFailure?: boolean;
  caseConfig?: Record<string, unknown>;
  caseOverrides?: Record<string, unknown>;
  inputBindings: FlowInputBinding[];
  outputPaths: string[];
}

export interface FlowNode {
  id: string;
  kind: FlowNodeKind;
  name: string;
  referenceId?: string | number;
  method?: string;
  path?: string;
  position: FlowPosition;
  config: FlowNodeConfig;
}

export type FlowEdgeRoute = "always" | "success" | "failure" | "true" | "false";

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  route: FlowEdgeRoute;
  sourceHandle?: string;
  targetHandle?: string;
  label?: string;
}

export interface FlowDefinition {
  schemaVersion: "1.0";
  id?: string | number;
  projectId: number;
  environmentId?: number;
  name: string;
  description: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
  viewport: {
    zoom: number;
  };
  updatedAt?: string;
}

export interface FlowSummary {
  id: string | number;
  name: string;
  description: string;
  nodeCount: number;
  updatedAt: string;
  definition?: FlowDefinition;
}

export interface FlowValidationIssue {
  code: string;
  message: string;
  nodeId?: string;
  edgeId?: string;
}

export interface FlowExecutionResult {
  execution_id?: string | number;
  flow_id?: string | number;
  flow_version?: number;
  status?: string;
  [key: string]: unknown;
}

type BackendFlow = Record<string, unknown>;
type FlowListResult = BackendFlow[] | { items?: BackendFlow[]; records?: BackendFlow[]; data?: BackendFlow[] };

function buildQuery(projectId: number) {
  return new URLSearchParams({ project_id: String(projectId) }).toString();
}

function unwrapList(result: FlowListResult) {
  if (Array.isArray(result)) return result;
  return result.data ?? result.items ?? result.records ?? [];
}

function readDefinition(source: BackendFlow): FlowDefinition | undefined {
  const candidate = source.definition ?? source.flow_definition ?? source.graph;
  return candidate && typeof candidate === "object" ? candidate as FlowDefinition : undefined;
}

function mapSummary(source: BackendFlow, index: number): FlowSummary {
  const definition = readDefinition(source);
  return {
    id: String(source.id ?? source.flow_id ?? `flow-${index}`),
    name: String(source.name ?? definition?.name ?? "未命名流程"),
    description: String(source.description ?? definition?.description ?? ""),
    nodeCount: Number(source.node_count ?? definition?.nodes?.length ?? 0),
    updatedAt: String(source.updated_at ?? definition?.updatedAt ?? ""),
    definition,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const protectedCaseFields = [
  "id",
  "case_id",
  "test_case_id",
  "project_id",
  "projectId",
  "environment_id",
  "environment_ids",
  "environmentId",
  "environmentIds",
  "referenceId",
];

export function validateFlowDefinition(definition: FlowDefinition, executable = false): FlowValidationIssue[] {
  const issues: FlowValidationIssue[] = [];
  const nodeIds = new Set<string>();
  const edgePairs = new Set<string>();
  const edgeIds = new Set<string>();
  const bindingIds = new Set<string>();
  const validKinds: FlowNodeKind[] = ["api_case", "websocket_case", "condition", "delay", "start", "end"];
  const validRoutes: FlowEdgeRoute[] = ["always", "success", "failure", "true", "false"];

  if (!definition.name.trim()) issues.push({ code: "empty_flow_name", message: "流程名称不能为空" });
  if (definition.schemaVersion !== "1.0") issues.push({ code: "unsupported_schema", message: `不支持的流程结构版本：${definition.schemaVersion}` });
  if (!Number.isFinite(definition.viewport.zoom) || definition.viewport.zoom < .6 || definition.viewport.zoom > 1.4) {
    issues.push({ code: "invalid_zoom", message: "画布缩放比例必须在 0.6 至 1.4 之间" });
  }
  definition.nodes.forEach((node) => {
    if (!node.id || nodeIds.has(node.id)) issues.push({ code: "duplicate_node_id", message: `节点 ID 重复或为空：${node.id || "-"}`, nodeId: node.id });
    nodeIds.add(node.id);
    if (!validKinds.includes(node.kind)) issues.push({ code: "invalid_node_kind", message: `节点“${node.name}”类型无效`, nodeId: node.id });
    if (!node.name.trim()) issues.push({ code: "empty_node_name", message: "节点名称不能为空", nodeId: node.id });
    if (!Number.isFinite(node.position.x) || !Number.isFinite(node.position.y)) issues.push({ code: "invalid_position", message: `节点“${node.name}”坐标无效`, nodeId: node.id });
    if ((node.kind === "api_case" || node.kind === "websocket_case") && !node.referenceId) {
      issues.push({ code: "missing_reference", message: `节点“${node.name}”缺少测试用例引用`, nodeId: node.id });
    }
    if (node.config.caseConfig !== undefined && !isPlainObject(node.config.caseConfig)) {
      issues.push({ code: "invalid_case_config", message: `节点“${node.name}”的本地用例配置必须是 JSON 对象`, nodeId: node.id });
    }
    if (node.config.caseOverrides !== undefined && !isPlainObject(node.config.caseOverrides)) {
      issues.push({ code: "invalid_case_overrides", message: `节点“${node.name}”的用例覆盖配置必须是 JSON 对象`, nodeId: node.id });
    }
    const protectedField = [node.config.caseConfig, node.config.caseOverrides]
      .filter(isPlainObject)
      .flatMap((config) => Object.keys(config))
      .find((field) => protectedCaseFields.includes(field));
    if (protectedField) {
      issues.push({ code: "protected_case_field", message: `节点“${node.name}”不能覆盖受保护字段：${protectedField}`, nodeId: node.id });
    }
    if (node.kind !== "api_case" && node.kind !== "websocket_case" && (node.config.caseConfig || node.config.caseOverrides)) {
      issues.push({ code: "unsupported_case_config", message: `节点“${node.name}”不是接口节点，不能配置本地用例副本`, nodeId: node.id });
    }
    if (node.kind === "condition" && !node.config.condition?.trim()) {
      issues.push({ code: "missing_condition", message: `条件节点“${node.name}”缺少表达式`, nodeId: node.id });
    }
    if (node.kind === "delay" && (!Number.isFinite(node.config.delayMs) || Number(node.config.delayMs) < 0)) {
      issues.push({ code: "invalid_delay", message: `等待节点“${node.name}”的等待时间无效`, nodeId: node.id });
    }
  });

  definition.edges.forEach((edge) => {
    if (!edge.id || edgeIds.has(edge.id)) issues.push({ code: "duplicate_edge_id", message: `连线 ID 重复或为空：${edge.id || "-"}`, edgeId: edge.id });
    edgeIds.add(edge.id);
    if (!validRoutes.includes(edge.route)) issues.push({ code: "invalid_edge_route", message: `连线路由无效：${edge.route}`, edgeId: edge.id });
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) issues.push({ code: "dangling_edge", message: "连线引用了不存在的节点", edgeId: edge.id });
    if (edge.source === edge.target) issues.push({ code: "self_edge", message: "节点不能连接自身", edgeId: edge.id });
    const pair = `${edge.source}->${edge.target}`;
    if (edgePairs.has(pair)) issues.push({ code: "duplicate_edge", message: "同一对节点之间不能重复连线", edgeId: edge.id });
    edgePairs.add(pair);
  });

  definition.nodes.forEach((node) => {
    node.config.inputBindings.forEach((binding) => {
      if (!binding.id || bindingIds.has(binding.id)) issues.push({ code: "duplicate_binding_id", message: `输入取值关联 ID 重复或为空：${binding.id || "-"}`, nodeId: node.id });
      bindingIds.add(binding.id);
      if (!binding.target.trim() || !binding.sourceNodeId || !binding.sourcePath.trim()) {
        issues.push({ code: "incomplete_binding", message: `节点“${node.name}”存在未填写完整的输入取值关联`, nodeId: node.id });
      } else if (!edgePairs.has(`${binding.sourceNodeId}->${node.id}`)) {
        issues.push({ code: "invalid_binding_source", message: `节点“${node.name}”的取值来源不是直接上游节点`, nodeId: node.id });
      } else {
        const sourceNode = definition.nodes.find((item) => item.id === binding.sourceNodeId);
        const declared = sourceNode?.config.outputPaths.some((path) => binding.sourcePath === path || binding.sourcePath.startsWith(`${path}.`));
        if (!declared) issues.push({ code: "undeclared_source_path", message: `节点“${node.name}”引用了上游未声明的输出路径`, nodeId: node.id });
      }
      const targetRoot = binding.target.match(/^[A-Za-z][A-Za-z0-9_]*/)?.[0] ?? "";
      if (binding.target && !["pathParams", "query", "headers", "body", "variables", "messages"].includes(targetRoot)) {
        issues.push({ code: "invalid_binding_target", message: `节点“${node.name}”的目标字段根路径无效：${targetRoot}`, nodeId: node.id });
      }
    });
  });

  const adjacency = new Map(definition.nodes.map((node) => [node.id, [] as string[]]));
  definition.edges.forEach((edge) => adjacency.get(edge.source)?.push(edge.target));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (nodeId: string): boolean => {
    if (visiting.has(nodeId)) return true;
    if (visited.has(nodeId)) return false;
    visiting.add(nodeId);
    const cyclic = (adjacency.get(nodeId) ?? []).some(visit);
    visiting.delete(nodeId);
    visited.add(nodeId);
    return cyclic;
  };
  if (definition.nodes.some((node) => visit(node.id))) issues.push({ code: "cycle", message: "流程不能形成循环依赖" });

  if (executable) {
    const starts = definition.nodes.filter((node) => node.kind === "start");
    const ends = definition.nodes.filter((node) => node.kind === "end");
    if (starts.length !== 1) issues.push({ code: "invalid_start_count", message: "可执行流程必须且只能包含一个开始节点" });
    if (ends.length === 0) issues.push({ code: "missing_end", message: "可执行流程至少需要一个结束节点" });
    definition.edges.forEach((edge) => {
      const source = definition.nodes.find((node) => node.id === edge.source);
      const target = definition.nodes.find((node) => node.id === edge.target);
      if (source?.kind === "end") issues.push({ code: "end_has_output", message: "结束节点不能连接下游节点", edgeId: edge.id });
      if (target?.kind === "start") issues.push({ code: "start_has_input", message: "开始节点不能连接上游节点", edgeId: edge.id });
      if (source?.kind !== "condition" && (edge.route === "true" || edge.route === "false")) {
        issues.push({ code: "invalid_boolean_route", message: `只有条件节点可以使用 ${edge.route} 路由`, edgeId: edge.id });
      }
    });
    definition.nodes.filter((node) => node.kind === "condition").forEach((node) => {
      const routes = definition.edges.filter((edge) => edge.source === node.id).map((edge) => edge.route);
      if (routes.filter((route) => route === "true").length !== 1 || routes.filter((route) => route === "false").length !== 1 || routes.some((route) => route !== "true" && route !== "false")) {
        issues.push({ code: "incomplete_condition_routes", message: `条件节点“${node.name}”必须且只能配置一条 true 和一条 false 下游连线`, nodeId: node.id });
      }
    });
    if (starts.length === 1) {
      const reachable = new Set<string>();
      const pending = [starts[0].id];
      while (pending.length > 0) {
        const current = pending.pop();
        if (!current || reachable.has(current)) continue;
        reachable.add(current);
        (adjacency.get(current) ?? []).forEach((nodeId) => pending.push(nodeId));
      }
      definition.nodes.filter((node) => !reachable.has(node.id)).forEach((node) => {
        issues.push({ code: "unreachable_node", message: `节点“${node.name}”无法从开始节点到达`, nodeId: node.id });
      });
    }
    const reverseAdjacency = new Map(definition.nodes.map((node) => [node.id, [] as string[]]));
    definition.edges.forEach((edge) => reverseAdjacency.get(edge.target)?.push(edge.source));
    const canReachEnd = new Set<string>();
    const reversePending = ends.map((node) => node.id);
    while (reversePending.length > 0) {
      const current = reversePending.pop();
      if (!current || canReachEnd.has(current)) continue;
      canReachEnd.add(current);
      (reverseAdjacency.get(current) ?? []).forEach((nodeId) => reversePending.push(nodeId));
    }
    definition.nodes.filter((node) => !canReachEnd.has(node.id)).forEach((node) => {
      issues.push({ code: "dead_end_node", message: `节点“${node.name}”无法到达结束节点`, nodeId: node.id });
    });
  }

  return issues;
}

export async function listFlows(projectId: number) {
  const result = await requestWithAuth<FlowListResult>(`/flows?${buildQuery(projectId)}`);
  return unwrapList(result).map(mapSummary);
}

export async function getFlow(projectId: number, flowId: string | number) {
  const result = await requestWithAuth<BackendFlow>(`/flows/${flowId}?${buildQuery(projectId)}`);
  return readDefinition(result) ?? result as unknown as FlowDefinition;
}

export function createFlow(projectId: number, definition: FlowDefinition) {
  return requestWithAuth<BackendFlow>(`/flows?${buildQuery(projectId)}`, {
    method: "POST",
    body: JSON.stringify({ name: definition.name, description: definition.description, definition }),
  });
}

export function updateFlow(projectId: number, flowId: string | number, definition: FlowDefinition) {
  return requestWithAuth<BackendFlow>(`/flows/${flowId}?${buildQuery(projectId)}`, {
    method: "PUT",
    body: JSON.stringify({ name: definition.name, description: definition.description, definition }),
  });
}

export function deleteFlow(projectId: number, flowId: string | number) {
  return requestWithAuth<void>(`/flows/${flowId}?${buildQuery(projectId)}`, {
    method: "DELETE",
  });
}

export function executeFlow(projectId: number, flowId: string | number, environmentId?: number, idempotencyKey?: string) {
  const query = new URLSearchParams({ project_id: String(projectId) });
  if (environmentId) query.set("environment_id", String(environmentId));
  return requestWithAuth<FlowExecutionResult>(`/flows/${flowId}/execute?${query.toString()}`, {
    method: "POST",
    headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
  });
}

export function executeUnsavedFlow(projectId: number, definition: FlowDefinition, environmentId?: number, idempotencyKey?: string) {
  const query = new URLSearchParams({ project_id: String(projectId) });
  if (environmentId) query.set("environment_id", String(environmentId));
  return requestWithAuth<FlowExecutionResult>(`/flows/execute-unsaved?${query.toString()}`, {
    method: "POST",
    headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
    body: JSON.stringify({ definition }),
  });
}
