import { readFile, readdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { Linter } from "eslint";
import { messageKey } from "../src/shared/i18n.js";

const root = new URL("../", import.meta.url);
const decode = value => value.replace(/&(?:quot|amp|lt|gt|#39);/g, entity => ({
  "&quot;": '"', "&amp;": "&", "&lt;": "<", "&gt;": ">", "&#39;": "'"
})[entity]);

// Collect only extension UI strings, never page data or interchange field names.
export async function collectUiMessages() {
  const messages = new Map();
  const add = (source, file) => {
    const key = messageKey(source);
    if (messages.has(key) && messages.get(key).source !== source) throw new Error(`Message key collision: ${key}`);
    if (!messages.has(key)) messages.set(key, { key, source, files: [] });
    if (!messages.get(key).files.includes(file)) messages.get(key).files.push(file);
  };
  const linter = new Linter();
  async function scan(directory) {
    for (const item of await readdir(new URL(directory, root), { withFileTypes: true })) {
      const file = `${directory}${item.name}`;
      if (item.isDirectory()) { await scan(`${file}/`); continue; }
      if (!file.endsWith(".js")) continue;
      const code = await readFile(new URL(file, root), "utf8");
      const diagnostics = linter.verify(code, [{
        languageOptions: { ecmaVersion: "latest", sourceType: "module" },
        plugins: { localization: { rules: { collect: { create(context) {
          return {
            CallExpression(node) {
              if (node.callee.name === "t" && node.parent.type === "BinaryExpression"
                && ["===", "!==", "==", "!="].includes(node.parent.operator)) {
                context.report({ node, message: "Compare internal data types directly; translate only display text." });
              }
              if (node.callee.name === "t" && typeof node.arguments[0]?.value === "string") add(node.arguments[0].value, file);
            },
            TaggedTemplateExpression(node) {
              if (node.tag.name === "t") add(node.quasi.quasis.map((part, index) =>
                part.value.cooked + (index < node.quasi.expressions.length ? `$${index + 1}` : "")).join(""), file);
            },
            Literal(node) {
              // Injected functions cannot import t(); their errors are localized after return.
              if (typeof node.value === "string" && /^[A-Z].*[.!]$/.test(node.value)
                && context.sourceCode.getAncestors(node).some(parent => parent.type === "FunctionDeclaration" && parent.id?.name === "operateStorageInPage")) {
                add(node.value, file);
              }
            }
          };
        } } } } },
        rules: { "localization/collect": "error" }
      }]);
      if (diagnostics.length) throw new Error(`${file}: ${diagnostics.map(diagnostic => diagnostic.message).join("; ")}`);
    }
  }
  await scan("src/");
  const file = "src/popup/popup.html";
  const html = await readFile(new URL(file, root), "utf8");
  for (const [tag] of html.matchAll(/<[a-zA-Z][^>]*>/g)) {
    const attributes = new Map([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(match => [match[1], decode(match[2])]));
    if (attributes.has("data-i18n")) add(attributes.get("data-i18n"), file);
    for (const name of (attributes.get("data-i18n-attrs") || "").split(" ").filter(Boolean)) {
      if (!attributes.has(name)) throw new Error(`${file}: missing localized attribute ${name}`);
      add(attributes.get(name), file);
    }
  }
  return [...messages.values()];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(await collectUiMessages(), null, 2));
}
