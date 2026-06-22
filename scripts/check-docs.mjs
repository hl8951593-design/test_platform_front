import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const root = process.cwd();
const markdownFiles = [];

function collect(path) {
  if (!existsSync(path)) return;
  for (const name of readdirSync(path)) {
    const fullPath = join(path, name);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) collect(fullPath);
    else if (name.endsWith(".md")) markdownFiles.push(fullPath);
  }
}

["README.md", "AGENTS.md"].forEach((name) => {
  const path = join(root, name);
  if (existsSync(path)) markdownFiles.push(path);
});
collect(join(root, "docs"));
collect(join(root, "api_docs"));

const errors = [];
const linkPattern = /\[[^\]]*]\(([^)]+)\)/g;

for (const file of markdownFiles) {
  const content = readFileSync(file, "utf8");
  for (const match of content.matchAll(linkPattern)) {
    const rawTarget = match[1].trim().replace(/^<|>$/g, "");
    if (!rawTarget || /^(https?:|mailto:|#)/i.test(rawTarget)) continue;
    const target = decodeURIComponent(rawTarget.split("#")[0].split("?")[0]);
    if (!existsSync(resolve(dirname(file), target))) {
      errors.push(`${relative(root, file)}: broken link -> ${rawTarget}`);
    }
  }
}

const index = readFileSync(join(root, "docs", "README.md"), "utf8");
[
  "documentation-governance.md",
  "style.md",
  "scenario-data-driven-contract.md",
  "scenario-run-events-contract.md",
  "scenario-run-detail-contract.md",
  "scenario-variable-tracing-contract.md",
].forEach((required) => {
  if (!index.includes(required)) errors.push(`docs/README.md: missing index entry -> ${required}`);
});
if (!index.includes("../api_docs/README.md")) {
  errors.push("docs/README.md: missing canonical API documentation index");
}
if (existsSync(join(root, "docs", "api_environment_configs.md"))) {
  errors.push("docs/api_environment_configs.md: duplicate contract; use api_docs/api_environment_configs.md");
}

const scenarioApi = readFileSync(join(root, "api_docs", "api_scenarios.md"), "utf8");
[
  "202 Accepted",
  "\"records\"",
  "\"request_overrides\"",
  "/scenario-runs/{run_id}/events",
].forEach((required) => {
  if (!scenarioApi.includes(required)) errors.push(`api_docs/api_scenarios.md: missing contract marker -> ${required}`);
});

if (errors.length) {
  console.error(`Documentation check failed (${errors.length}):`);
  errors.forEach((error) => console.error(`- ${error}`));
  process.exitCode = 1;
} else {
  console.log(`Documentation check passed for ${markdownFiles.length} Markdown files.`);
}
