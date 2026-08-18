import { createHash } from "node:crypto";
import { mkdir, chmod, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const androidRoot = path.resolve(scriptDirectory, "..");
const destinationDirectory = path.join(androidRoot, "android/app/src/main/assets");
const javascriptDestination = path.join(destinationDirectory, "code-review-editor.js");
const htmlDestination = path.join(destinationDirectory, "code-review-editor.html");

await mkdir(destinationDirectory, { recursive: true });
const buildResult = await build({
  entryPoints: [path.join(androidRoot, "code-review-editor/entry.ts")],
  outfile: javascriptDestination,
  bundle: true,
  minify: true,
  format: "iife",
  platform: "browser",
  target: ["chrome100"],
  legalComments: "eof",
  metafile: true,
});
const javascript = await readFile(javascriptDestination);
const assetVersion = createHash("sha256").update(javascript).digest("hex").slice(0, 16);
const htmlTemplate = await readFile(path.join(androidRoot, "assets/code-review-editor.html"), "utf8");
const html = htmlTemplate.replace(
  'src="code-review-editor.js"',
  `src="code-review-editor.js?v=${assetVersion}"`,
);
if (html === htmlTemplate) throw new Error("Code review script tag was not found");
await writeFile(htmlDestination, html, "utf8");
await Promise.all([chmod(javascriptDestination, 0o644), chmod(htmlDestination, 0o644)]);

const { writeThirdPartyNotices } = await import("./write-third-party-notices.mjs");
await writeThirdPartyNotices({
  androidRoot,
  destinationDirectory,
  bundledInputs: Object.keys(buildResult.metafile.inputs),
});
