import { executeUnsavedFlow, validateFlowDefinition, type FlowDefinition, type FlowNode } from "./flows";

function node(id: string, kind: FlowNode["kind"]): FlowNode {
  return {
    id,
    kind,
    name: id,
    position: { x: 0, y: 0 },
    config: {
      condition: kind === "condition" ? "response.status == 200" : "",
      delayMs: kind === "delay" ? 100 : undefined,
      inputBindings: [],
      outputPaths: [],
    },
  };
}

function definition(nodes: FlowNode[], edges: FlowDefinition["edges"]): FlowDefinition {
  return {
    schemaVersion: "1.0",
    projectId: 1,
    name: "验证流程",
    description: "",
    nodes,
    edges,
    viewport: { zoom: 1 },
  };
}

describe("validateFlowDefinition", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("accepts a connected executable DAG", () => {
    const flow = definition(
      [node("start", "start"), node("api", "api_case"), node("end", "end")],
      [
        { id: "e1", source: "start", target: "api", route: "always" },
        { id: "e2", source: "api", target: "end", route: "success" },
      ],
    );
    flow.nodes[1].referenceId = 10;

    expect(validateFlowDefinition(flow, true)).toEqual([]);
  });

  it("rejects incomplete condition routes", () => {
    const flow = definition(
      [node("start", "start"), node("condition", "condition"), node("end", "end")],
      [
        { id: "e1", source: "start", target: "condition", route: "always" },
        { id: "e2", source: "condition", target: "end", route: "true" },
      ],
    );

    expect(validateFlowDefinition(flow, true)).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "incomplete_condition_routes" })]),
    );
  });

  it("rejects bindings whose source is not a direct upstream node", () => {
    const target = node("target", "delay");
    target.config.inputBindings = [{
      id: "binding-1",
      target: "body.user_id",
      sourceNodeId: "source",
      sourcePath: "response.body.id",
    }];
    const flow = definition([node("source", "start"), target], []);

    expect(validateFlowDefinition(flow)).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "invalid_binding_source" })]),
    );
  });

  it("rejects unsafe binding targets and undeclared source paths", () => {
    const source = node("source", "api_case");
    source.referenceId = 10;
    source.config.outputPaths = ["response.body"];
    const target = node("target", "delay");
    target.config.inputBindings = [{
      id: "binding-1",
      target: "runtime.secret",
      sourceNodeId: "source",
      sourcePath: "response.headers.token",
    }];
    const flow = definition([source, target], [{ id: "e1", source: "source", target: "target", route: "always" }]);

    expect(validateFlowDefinition(flow)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "invalid_binding_target" }),
        expect.objectContaining({ code: "undeclared_source_path" }),
      ]),
    );
  });

  it("sends an idempotency key when executing the current definition", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ code: 0, message: "ok", data: { execution_id: 9, status: "passed" } }),
    } as Response);
    const flow = definition([node("start", "start"), node("end", "end")], [
      { id: "e1", source: "start", target: "end", route: "always" },
    ]);

    const result = await executeUnsavedFlow(1, flow, 2, "flow-run-key");

    expect(result.execution_id).toBe(9);
    const request = fetchMock.mock.calls[0][1] as RequestInit;
    expect(new Headers(request.headers).get("Idempotency-Key")).toBe("flow-run-key");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8000/api/v1/flows/execute-unsaved?project_id=1&environment_id=2",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ definition: flow }) }),
    );
  });

  it("rejects node-local overrides of project, case identity, and environment", () => {
    const apiNode = node("api", "api_case");
    apiNode.referenceId = 10;
    apiNode.config.caseOverrides = { environment_id: 2 };
    const flow = definition([apiNode], []);

    expect(validateFlowDefinition(flow)).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "protected_case_field" })]),
    );
  });
});
