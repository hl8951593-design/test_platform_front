import {
  compileScenarioStepConfig,
  readScenarioContext,
  writeScenarioContext,
  type ScenarioContextConfig,
} from "./scenarioContext";
import type { ScenarioStep } from "./scenarios";

function step(id: string, configText = "{}"): ScenarioStep {
  return {
    id,
    kind: "api_case",
    referenceId: Number(id.replace(/\D/g, "")) || 1,
    name: id,
    method: "POST",
    path: `/${id}`,
    configText,
    continueOnFailure: false,
  };
}

describe("scenario context bindings", () => {
  it("compiles an upstream response extraction into a downstream request field", () => {
    const sourceContext: ScenarioContextConfig = {
      extractions: [{ id: "VAR-1", name: "companyId", path: "data.company.id" }],
      bindings: [],
    };
    const targetContext: ScenarioContextConfig = {
      extractions: [],
      bindings: [{
        id: "BIND-1",
        sourceStepId: "STEP-1",
        sourceExtractionId: "VAR-1",
        target: "body",
        targetPath: "company.id",
      }],
    };
    const source = step("STEP-1", writeScenarioContext("{}", sourceContext));
    const target = step("STEP-2", writeScenarioContext('{"body":{"name":"demo"}}', targetContext));

    expect(compileScenarioStepConfig(target, [source, target])).toEqual(expect.objectContaining({
      body: {
        name: "demo",
        company: { id: "{{companyId}}" },
      },
      _scenario_context: expect.objectContaining({
        bindings: [expect.objectContaining({
          id: "BIND-1",
          name: "companyId",
          source_step_id: "STEP-1",
          source_extraction_id: "VAR-1",
          target_path: "company.id",
        })],
      }),
    }));
  });

  it("uses the websocket message index in generated references", () => {
    const source = {
      ...step("STEP-1", writeScenarioContext("{}", {
        extractions: [{ id: "VAR-1", name: "connectionId", path: "connection_id", messageIndex: 2 }],
        bindings: [],
      })),
      kind: "websocket_case" as const,
      method: "WS",
    };
    const target = step("STEP-2", writeScenarioContext("{}", {
      extractions: [],
      bindings: [{
        id: "BIND-1",
        sourceStepId: source.id,
        sourceExtractionId: "VAR-1",
        target: "headers",
        targetPath: "X-Connection-Id",
      }],
    }));

    expect(compileScenarioStepConfig(target, [source, target])).toEqual(expect.objectContaining({
      headers: { "X-Connection-Id": "{{connectionId}}" },
    }));
  });

  it("removes an old generated override when its binding is deleted", () => {
    const withBinding = writeScenarioContext('{"query_params":{"company_id":"{{step_1.json.data.id}}"}}', {
      extractions: [],
      bindings: [{
        id: "BIND-1",
        sourceStepId: "STEP-1",
        sourceExtractionId: "VAR-1",
        target: "query_params",
        targetPath: "company_id",
      }],
    });
    const withoutBinding = writeScenarioContext(withBinding, { extractions: [], bindings: [] });

    expect(JSON.parse(withoutBinding)).toEqual({});
    expect(readScenarioContext(withoutBinding)).toEqual({ extractions: [], bindings: [] });
  });

  it("replaces one request path placeholder without overwriting the whole path", () => {
    const source = step("STEP-1", writeScenarioContext("{}", {
      extractions: [{ id: "VAR-1", name: "companyId", path: "data.company_id" }],
      bindings: [],
    }));
    const target = {
      ...step("STEP-2", writeScenarioContext("{}", {
        extractions: [],
        bindings: [{
          id: "BIND-1",
          sourceStepId: source.id,
          sourceExtractionId: "VAR-1",
          target: "path",
          targetPath: "company_id",
        }],
      })),
      path: "/companies/{{company_id}}/detail",
    };

    expect(compileScenarioStepConfig(target, [source, target])).toEqual(expect.objectContaining({
      path: "/companies/{{company_id}}/detail",
    }));
  });

  it("reads legacy camelCase metadata and writes the backend snake_case contract", () => {
    const legacy = JSON.stringify({
      _scenario_context: {
        extractions: [{ id: "VAR-1", name: "companyId", path: "data.id", messageIndex: 1, masked: true }],
        bindings: [{
          id: "BIND-1",
          name: "companyId",
          sourceStepId: "STEP-1",
          sourceExtractionId: "VAR-1",
          target: "query_params",
          targetPath: "companyId",
        }],
      },
    });
    const configText = writeScenarioContext(legacy, readScenarioContext(legacy));

    expect(JSON.parse(configText)._scenario_context).toEqual({
      extractions: [{ id: "VAR-1", name: "companyId", path: "data.id", message_index: 1, masked: true }],
      bindings: [{
        id: "BIND-1",
        name: "companyId",
        source_step_id: "STEP-1",
        source_extraction_id: "VAR-1",
        target: "query_params",
        target_path: "companyId",
      }],
    });
  });
});
