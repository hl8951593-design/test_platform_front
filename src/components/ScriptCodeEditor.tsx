import CodeMirror from "@uiw/react-codemirror";
import { autocompletion, snippetCompletion, type Completion, type CompletionContext } from "@codemirror/autocomplete";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";

const pythonBuiltins: Array<[string, string, string]> = [
  ["abs", "绝对值", "abs(${value})"], ["bool", "转换为布尔值", "bool(${value})"], ["dict", "创建字典", "dict()"],
  ["enumerate", "遍历时同时获取索引和值", "enumerate(${items})"], ["float", "转换为浮点数", "float(${value})"],
  ["int", "转换为整数", "int(${value})"], ["len", "获取长度或元素数量", "len(${value})"], ["list", "创建或转换为列表", "list(${value})"],
  ["max", "获取最大值", "max(${items})"], ["min", "获取最小值", "min(${items})"], ["range", "生成整数序列", "range(${start}, ${stop})"],
  ["round", "四舍五入", "round(${value}, ${digits})"], ["sorted", "返回排序后的列表", "sorted(${items})"],
  ["str", "转换为字符串", "str(${value})"], ["sum", "计算元素总和", "sum(${items})"], ["tuple", "创建或转换为元组", "tuple(${items})"],
  ["zip", "按位置组合多个序列", "zip(${itemsA}, ${itemsB})"],
];

const pythonKeywords: Array<[string, string, string?]> = [
  ["if", "条件判断", "if ${condition}:\n\t${pass}"], ["else", "条件不成立时执行", "else:\n\t${pass}"],
  ["elif", "继续判断其他条件", "elif ${condition}:\n\t${pass}"], ["for", "遍历序列", "for ${item} in ${items}:\n\t${pass}"],
  ["while", "条件循环", "while ${condition}:\n\t${pass}"], ["True", "布尔真值"], ["False", "布尔假值"], ["None", "空值"],
  ["and", "逻辑与"], ["or", "逻辑或"], ["not", "逻辑非"], ["in", "成员判断"],
];

const javascriptKeywords: Array<[string, string, string?]> = [
  ["if", "条件判断", "if (${condition}) {\n\t${statement}\n}"], ["else", "条件不成立时执行", "else {\n\t${statement}\n}"],
  ["for", "循环执行", "for (let ${index} = 0; ${index} < ${length}; ${index}++) {\n\t${statement}\n}"],
  ["while", "条件循环", "while (${condition}) {\n\t${statement}\n}"], ["true", "布尔真值"], ["false", "布尔假值"],
  ["null", "空值"], ["let", "声明可重新赋值的变量"], ["const", "声明不可重新赋值的变量"],
];

function keywordCompletion([label, detail, snippet]: [string, string, string?]): Completion {
  return snippet
    ? snippetCompletion(snippet, { label, detail, type: "keyword" })
    : { label, detail, type: "keyword" };
}

export function buildSandboxCompletions(language: string, inputNames: string[], outputNames: string[]): Completion[] {
  const variables: Completion[] = [
    ...inputNames.map((label) => ({ label, detail: "前置节点输入变量（只读）", type: "variable" })),
    ...outputNames.map((label) => ({ label, detail: "脚本输出变量（请直接赋值）", type: "variable" })),
  ];
  if (language === "python") {
    return [
      ...variables,
      ...pythonBuiltins.map(([label, detail, snippet]) => snippetCompletion(snippet, { label, detail: `安全函数 · ${detail}`, type: "function" })),
      ...pythonKeywords.map(keywordCompletion),
    ];
  }
  return [...variables, ...javascriptKeywords.map(keywordCompletion)];
}

function sandboxCompletionSource(language: string, inputNames: string[], outputNames: string[]) {
  return (context: CompletionContext) => {
    const word = context.matchBefore(/[$\w]*/);
    if (!word || (word.from === word.to && !context.explicit)) return null;
    if (word.from > 0 && context.state.sliceDoc(word.from - 1, word.from) === ".") return null;
    return { from: word.from, options: buildSandboxCompletions(language, inputNames, outputNames), validFor: /^[$\w]*$/ };
  };
}

export default function ScriptCodeEditor({ code, inputNames, language, onChange, outputNames, placeholder }: {
  code: string;
  inputNames: string[];
  language: string;
  onChange: (value: string) => void;
  outputNames: string[];
  placeholder: string;
}) {
  return <CodeMirror
    basicSetup={{ autocompletion: false, bracketMatching: true, closeBrackets: true, foldGutter: true, highlightActiveLine: true, lineNumbers: true }}
    extensions={[language === "python" ? python() : javascript(), autocompletion({ activateOnTyping: true, override: [sandboxCompletionSource(language, inputNames, outputNames)] })]}
    height="260px"
    onChange={onChange}
    onCreateEditor={(view) => view.contentDOM.setAttribute("aria-label", "脚本代码")}
    placeholder={placeholder}
    value={code}
  />;
}
