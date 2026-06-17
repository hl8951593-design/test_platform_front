import type { ScenarioStep } from "./scenarios";

export type ScenarioBindingTarget = "path" | "headers" | "query_params" | "body";

export interface ScenarioExtraction {
  id: string;
  name: string;
  path: string;
  messageIndex?: number;
  masked?: boolean;
}

export interface ScenarioBinding {
  id: string;
  name?: string;
  sourceStepId: string;
  sourceExtractionId: string;
  target: ScenarioBindingTarget;
  targetPath: string;
}

export interface ScenarioContextConfig {
  extractions: ScenarioExtraction[];
  bindings: ScenarioBinding[];
}

const CONTEXT_KEY = "_scenario_context";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function parseConfig(configText: string) {
  const parsed = JSON.parse(configText || "{}") as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("步骤配置必须是 JSON 对象");
  }
  return parsed as Record<string, unknown>;
}

function serializeScenarioContext(context: ScenarioContextConfig) {
  return {
    extractions: context.extractions.map((extraction) => ({
      id: extraction.id,
      name: extraction.name,
      path: extraction.path,
      ...(extraction.messageIndex === undefined ? {} : { message_index: extraction.messageIndex }),
      ...(extraction.masked === undefined ? {} : { masked: extraction.masked }),
    })),
    bindings: context.bindings.map((binding) => ({
      id: binding.id,
      ...(binding.name ? { name: binding.name } : {}),
      source_step_id: binding.sourceStepId,
      source_extraction_id: binding.sourceExtractionId,
      target: binding.target,
      target_path: binding.targetPath,
    })),
  };
}

export function readScenarioContext(configText: string): ScenarioContextConfig {
  try {
    const metadata = asRecord(parseConfig(configText)[CONTEXT_KEY]);
    const extractions = Array.isArray(metadata.extractions)
      ? metadata.extractions.map((value) => {
          const item = asRecord(value);
          return {
            id: String(item.id ?? ""),
            name: String(item.name ?? ""),
            path: String(item.path ?? ""),
            messageIndex: item.message_index === undefined && item.messageIndex === undefined
              ? undefined
              : Number(item.message_index ?? item.messageIndex),
            masked: item.masked === undefined ? undefined : Boolean(item.masked),
          };
        }).filter((item) => item.id)
      : [];
    const bindings = Array.isArray(metadata.bindings)
      ? metadata.bindings.map((value) => {
          const item = asRecord(value);
          return {
            id: String(item.id ?? ""),
            name: item.name === undefined ? undefined : String(item.name),
            sourceStepId: String(item.source_step_id ?? item.sourceStepId ?? ""),
            sourceExtractionId: String(item.source_extraction_id ?? item.sourceExtractionId ?? ""),
            target: String(item.target ?? "body") as ScenarioBindingTarget,
            targetPath: String(item.target_path ?? item.targetPath ?? ""),
          };
        }).filter((item) => item.id)
      : [];
    return { extractions, bindings };
  } catch {
    return { extractions: [], bindings: [] };
  }
}

export function writeScenarioContext(configText: string, context: ScenarioContextConfig) {
  const config = parseConfig(configText);
  const previous = readScenarioContext(configText);
  previous.bindings.forEach((binding) => {
    const next = context.bindings.find((item) => item.id === binding.id);
    if (!next || next.target !== binding.target || next.targetPath !== binding.targetPath) {
      deleteBindingTarget(config, binding);
    }
  });
  if (context.extractions.length || context.bindings.length) {
    config[CONTEXT_KEY] = serializeScenarioContext(context);
  } else {
    delete config[CONTEXT_KEY];
  }
  return JSON.stringify(config, null, 2);
}

function deleteNestedValue(target: Record<string, unknown>, path: string) {
  const parts = path.split(".").map((item) => item.trim()).filter(Boolean);
  if (!parts.length) return;
  const parents: Array<{ parent: Record<string, unknown>; key: string }> = [];
  let current = target;
  for (const part of parts.slice(0, -1)) {
    const child = current[part];
    if (!child || typeof child !== "object" || Array.isArray(child)) return;
    parents.push({ parent: current, key: part });
    current = child as Record<string, unknown>;
  }
  delete current[parts[parts.length - 1]];
  parents.reverse().forEach(({ parent, key }) => {
    const child = parent[key];
    if (child && typeof child === "object" && !Array.isArray(child) && Object.keys(child).length === 0) {
      delete parent[key];
    }
  });
}

function deleteBindingTarget(config: Record<string, unknown>, binding: ScenarioBinding) {
  if (binding.target === "path") {
    delete config.path;
    return;
  }
  const container = asRecord(config[binding.target]);
  deleteNestedValue(container, binding.targetPath);
  if (Object.keys(container).length === 0) delete config[binding.target];
}

function setNestedValue(target: Record<string, unknown>, path: string, value: unknown) {
  const parts = path.split(".").map((item) => item.trim()).filter(Boolean);
  if (!parts.length) throw new Error("引用写入字段不能为空");
  let current = target;
  parts.forEach((part, index) => {
    if (index === parts.length - 1) {
      current[part] = value;
      return;
    }
    const child = current[part];
    if (child !== undefined && (!child || typeof child !== "object" || Array.isArray(child))) {
      throw new Error(`无法写入 ${path}，${parts.slice(0, index + 1).join(".")} 不是对象`);
    }
    current[part] = asRecord(child);
    current = current[part] as Record<string, unknown>;
  });
}

function getNestedValue(target: Record<string, unknown>, path: string) {
  const parts = path.split(".").map((item) => item.trim()).filter(Boolean);
  let current: unknown = target;
  for (const part of parts) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export function compileScenarioStepConfig(step: ScenarioStep, steps: ScenarioStep[]) {
  const config = parseConfig(step.configText);
  const context = readScenarioContext(step.configText);
  const currentIndex = steps.findIndex((item) => item.id === step.id);
  const extractionNames = new Set<string>();
  context.extractions.forEach((extraction) => {
    const name = extraction.name.trim();
    if (!name) throw new Error(`步骤“${step.name}”存在未命名的响应取值`);
    if (!extraction.path.trim()) throw new Error(`响应取值“${name}”缺少 JSON 路径`);
    if (extractionNames.has(name)) throw new Error(`步骤“${step.name}”的响应取值名称不能重复：${name}`);
    extractionNames.add(name);
  });

  context.bindings.forEach((binding) => {
    const sourceIndex = steps.findIndex((item) => item.id === binding.sourceStepId);
    if (sourceIndex < 0) throw new Error(`步骤“${step.name}”引用的上游步骤已不存在`);
    if (sourceIndex >= currentIndex) throw new Error(`步骤“${step.name}”只能引用当前步骤之前的响应取值`);
    const sourceStep = steps[sourceIndex];
    const extraction = readScenarioContext(sourceStep.configText).extractions
      .find((item) => item.id === binding.sourceExtractionId);
    if (!extraction) throw new Error(`步骤“${step.name}”引用的上游取值已不存在`);
    if (!extraction.path.trim()) throw new Error(`上游取值“${extraction.name}”缺少响应路径`);
    if (binding.target !== "path" && !binding.targetPath.trim()) {
      throw new Error(`步骤“${step.name}”的变量引用缺少写入字段`);
    }

    const variableName = binding.name?.trim()
      || (binding.target === "path" ? binding.targetPath.trim() : extraction.name.trim());
    binding.name = variableName;
    const reference = `{{${variableName}}}`;
    if (binding.target === "path") {
      const basePath = String(config.path ?? step.path);
      config.path = basePath.includes(reference) ? basePath : reference;
      return;
    }
    const container = asRecord(config[binding.target]);
    config[binding.target] = container;
    const currentValue = getNestedValue(container, binding.targetPath);
    if (typeof currentValue !== "string" || !currentValue.includes(reference)) {
      setNestedValue(container, binding.targetPath, reference);
    }
  });

  if (context.extractions.length || context.bindings.length) {
    config[CONTEXT_KEY] = serializeScenarioContext(context);
  } else {
    delete config[CONTEXT_KEY];
  }
  return config;
}
