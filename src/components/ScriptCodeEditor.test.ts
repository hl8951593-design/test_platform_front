import { describe, expect, it } from "vitest";
import { buildSandboxCompletions } from "./ScriptCodeEditor";

describe("ScriptCodeEditor completions", () => {
  it("describes sandbox variables and allowed Python functions in Chinese", () => {
    const completions = buildSandboxCompletions("python", ["companyId"], ["result"]);
    const byLabel = new Map(completions.map((completion) => [completion.label, completion]));

    expect(byLabel.get("companyId")?.detail).toBe("前置节点输入变量（只读）");
    expect(byLabel.get("result")?.detail).toBe("脚本输出变量（请直接赋值）");
    expect(byLabel.get("len")?.detail).toBe("安全函数 · 获取长度或元素数量");
    expect(byLabel.get("if")?.detail).toBe("条件判断");
    expect(byLabel.has("__annotations__")).toBe(false);
    expect(byLabel.has("__builtins__")).toBe(false);
    expect(byLabel.has("print")).toBe(false);
  });
});
