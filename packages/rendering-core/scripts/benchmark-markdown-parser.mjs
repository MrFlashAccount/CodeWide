import { performance } from "node:perf_hooks";

import { marked } from "marked";
import { parseRichMarkdown } from "@codewide/rendering-core";

const messages = Array.from({ length: 1_000 }, (_, index) => [
  `## Fixture ${index}`,
  "",
  `- [${index % 2 === 0 ? "x" : " "}] deterministic item`,
  `- **strong** and \`inline-${index}\``,
  "",
  "| Name | State |",
  "| --- | --- |",
  `| fixture-${index} | ready |`,
].join("\n"));
const documents = [
  ...messages,
  "Long paragraph. ".repeat(6_500),
  `\`\`\`ts\n${"const value = 1;\n".repeat(5_000)}\`\`\``,
];

function benchmark(name, parse) {
  for (let iteration = 0; iteration < 2; iteration += 1) {
    for (const document of documents) parse(document);
  }
  const samples = [];
  for (let iteration = 0; iteration < 7; iteration += 1) {
    const startedAt = performance.now();
    for (const document of documents) parse(document);
    samples.push(performance.now() - startedAt);
  }
  samples.sort((left, right) => left - right);
  process.stdout.write(`${JSON.stringify({
    name,
    documents: documents.length,
    characters: documents.reduce((total, document) => total + document.length, 0),
    bestMilliseconds: Number(samples[0].toFixed(2)),
    p50Milliseconds: Number(samples[Math.floor(samples.length / 2)].toFixed(2)),
    worstMilliseconds: Number(samples.at(-1).toFixed(2)),
  })}\n`);
}

benchmark("marked-lexer", (source) => marked.lexer(source, { gfm: true, breaks: false }));
benchmark("rendering-core-ast", parseRichMarkdown);
