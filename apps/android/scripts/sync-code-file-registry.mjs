import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { EXTENSION_TO_FILE_FORMAT } from "@pierre/diffs";

const outputPath = fileURLToPath(new URL("../../../packages/file-types/src/index.ts", import.meta.url));

// Pierre owns the broad syntax registry used by the full editor. These are
// presentation-only additions: plain text formats and extensionless filenames
// that should still open in the code/text surface.
const additionalTextExtensions = ["bazel", "bzl", "lock", "text", "txt", "xsd"];
// Pierre can highlight WebAssembly text, but `.wasm` itself is a binary module.
// Filename routing must not send binary bytes into the text preview.
const binaryIdentifiers = new Set(["wasm"]);
const additionalTextNames = [
  ".babelrc",
  ".editorconfig",
  ".env",
  ".gitattributes",
  ".gitignore",
  ".npmrc",
  ".prettierrc",
  ".yarnrc",
  "build",
  "cmakelists.txt",
  "dockerfile",
  "gemfile",
  "justfile",
  "makefile",
  "procfile",
  "rakefile",
  "workspace",
];

const identifiers = [...new Set([
  ...Object.keys(EXTENSION_TO_FILE_FORMAT),
  ...additionalTextExtensions,
  ...additionalTextNames,
].map((value) => value.toLowerCase()).filter((value) => !binaryIdentifiers.has(value)))].sort();
const startMarker = "// BEGIN GENERATED CODE FILE IDENTIFIERS";
const endMarker = "// END GENERATED CODE FILE IDENTIFIERS";
const source = await readFile(outputPath, "utf8");
const start = source.indexOf(startMarker);
const end = source.indexOf(endMarker);
if (start < 0 || end < start) throw new Error("Generated code-file registry markers are missing");
const values = identifiers.map((value) => `  ${JSON.stringify(value)},`).join("\n");
const generated = `${startMarker}\nconst CODE_FILE_IDENTIFIERS = new Set<string>([\n${values}\n]);\n${endMarker}`;
await writeFile(outputPath, `${source.slice(0, start)}${generated}${source.slice(end + endMarker.length)}`, "utf8");
