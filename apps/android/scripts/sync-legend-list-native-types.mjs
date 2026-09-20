import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const sourceUrl = new URL("../node_modules/@legendapp/list/react-native.d.ts", import.meta.url);
const targetUrl = new URL("../.expo/types/legend-list-native.d.ts", import.meta.url);
const header =
  "// Generated from @legendapp/list/react-native.d.ts. The web bundle deliberately uses the React Native implementation.\n";
const source = await readFile(sourceUrl, "utf8");
const target = `${header}${source}`;

await mkdir(dirname(fileURLToPath(targetUrl)), { recursive: true });
let current = null;
try {
  current = await readFile(targetUrl, "utf8");
} catch (error) {
  if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") {
    throw error;
  }
}
if (current !== target) {
  await writeFile(targetUrl, target);
}
