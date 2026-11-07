import { build } from "esbuild";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const androidRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const external = [
  "react",
  "react-native",
  "react-native-gesture-handler",
  "react-native-reanimated",
  "react-native-safe-area-context",
  "react-native-worklets",
];

async function buildComponent(entryPoint, outfile) {
  await build({
    absWorkingDir: androidRoot,
    alias: {
      "@/react/useEvent": "./src/react/useEvent.ts",
      "@/utils/create-compound-component":
        "./vendor/reacticx/src/utils/create-compound-component/index.ts",
    },
    banner: {
      js: "// Generated from vendored Reacticx source. Do not edit.",
    },
    bundle: true,
    entryPoints: [entryPoint],
    external,
    format: "esm",
    jsx: "automatic",
    outfile,
    platform: "neutral",
  });
}

await Promise.all([
  buildComponent(
    "vendor/reacticx/src/components/organisms/masked-tab-bar/index.tsx",
    "src/vendor/reacticx/masked-tab-bar.js",
  ),
  buildComponent(
    "vendor/reacticx/src/components/organisms/tray/index.tsx",
    "src/vendor/reacticx/tray.js",
  ),
]);
