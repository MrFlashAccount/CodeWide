import { copyFile, mkdir, chmod } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const androidRoot = path.resolve(scriptDirectory, "..");
const destinationDirectory = path.join(androidRoot, "android/app/src/main/assets");
const assets = [
  [require.resolve("mermaid/dist/mermaid.min.js"), "mermaid.min.js"],
  [require.resolve("@panzoom/panzoom/dist/panzoom.min.js"), "panzoom.min.js"],
  [path.join(androidRoot, "assets/mermaid-renderer.html"), "mermaid-renderer.html"],
];

await mkdir(destinationDirectory, { recursive: true });
for (const [source, fileName] of assets) {
  const destination = path.join(destinationDirectory, fileName);
  await copyFile(source, destination);
  await chmod(destination, 0o644);
}
