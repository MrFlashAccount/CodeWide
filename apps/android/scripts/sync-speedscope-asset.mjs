import { chmod, cp, mkdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const androidRoot = path.resolve(scriptDirectory, "..");
const destinationDirectory = path.join(androidRoot, "android/app/src/main/assets");
const destination = path.join(destinationDirectory, "speedscope");
const speedscopeRoot = path.dirname(require.resolve("speedscope/package.json"));

await mkdir(destinationDirectory, { recursive: true });
await rm(destination, { recursive: true, force: true });
await cp(path.join(speedscopeRoot, "dist/release"), destination, { recursive: true });
await writeFile(
  path.join(destination, "codewide-loader.js"),
  'window.ReactNativeWebView?.postMessage(JSON.stringify({type:"speedscope-ready"}));\n',
  "utf8",
);
await chmod(path.join(destination, "codewide-loader.js"), 0o644);
