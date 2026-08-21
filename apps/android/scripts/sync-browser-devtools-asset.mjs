import { chmod, copyFile, cp, mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const androidRoot = path.resolve(scriptDirectory, "..");
const destinationDirectory = path.join(androidRoot, "android/app/src/main/assets");
const destination = path.join(destinationDirectory, "browser-devtools");
const chiiRoot = path.dirname(require.resolve("chii/package.json"));

await mkdir(destinationDirectory, { recursive: true });
await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
await cp(path.join(chiiRoot, "public/front_end"), path.join(destination, "front_end"), { recursive: true });
await copyFile(path.join(chiiRoot, "LICENSE"), path.join(destination, "CHII_LICENSE"));
await chmod(path.join(destination, "CHII_LICENSE"), 0o644);
