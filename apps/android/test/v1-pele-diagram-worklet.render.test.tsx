import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { createContext, runInContext } from "node:vm";

const appRoot = join(__dirname, "..");
const appRequire = createRequire(join(appRoot, "package.json"));
const babelRequire = createRequire(appRequire.resolve("babel-jest"));
const { transformSync } = babelRequire("@babel/core");
const sourcePath = join(appRoot, "src/rendering/peleDiagramRenderer.ts");
const workletsDirectory = join(
  dirname(appRequire.resolve("react-native-worklets/package.json")),
  ".worklets",
);

const GOVERNOR_DIAGRAM = `flowchart LR
    W["Wrapper: очередь и lease"] <-->|"long-poll / handoff"| G["Governor: выдача job, cancellation, reuse / retire"]
    G -->|"полное задание + incarnation / dispatch"| E["Пул Executor: одна job на процесс"]
    E <-->|"тяжёлый fetch, upload, terminal"| W
    E -->|"accepted / terminal / cleaned"| G
    C["cgroup v1/v2: память и pressure"] --> G`;

function transformRenderer(): string {
  const originalDirectory = process.cwd();
  try {
    process.chdir(appRoot);
    const result = transformSync(readFileSync(sourcePath, "utf8"), {
      babelrc: false,
      caller: { isDev: false, name: "metro", platform: "android" },
      configFile: false,
      filename: sourcePath,
      plugins: [
        [
          appRequire.resolve("react-native-worklets/plugin"),
          {
            bundleMode: true,
            importForwarding: { moduleNames: ["pele"] },
            strictGlobal: true,
          },
        ],
      ],
      presets: [appRequire.resolve("babel-preset-expo")],
    });
    if (typeof result?.code !== "string") {
      throw new Error("Android transform produced no Pele renderer code");
    }
    return result.code;
  } finally {
    process.chdir(originalDirectory);
  }
}

function executeCommonJs(
  code: string,
  requireModule: (moduleName: string) => unknown,
): Record<string, unknown> {
  const exports: Record<string, unknown> = {};
  const context = createContext({ __DEV__: false, exports, require: requireModule });
  runInContext("globalThis.global = globalThis", context);
  runInContext(code, context);
  return exports;
}

function loadGeneratedWorklet(moduleName: string): Record<string, unknown> {
  const prefix = "react-native-worklets/.worklets/";
  if (!moduleName.startsWith(prefix)) {
    throw new Error(`Unexpected generated module: ${moduleName}`);
  }
  const generatedPath = join(workletsDirectory, moduleName.slice(prefix.length));
  const result = transformSync(readFileSync(generatedPath, "utf8"), {
    babelrc: false,
    configFile: false,
    filename: generatedPath,
    presets: [appRequire.resolve("babel-preset-expo")],
  });
  if (typeof result?.code !== "string") {
    throw new Error(`Android transform produced no code for ${moduleName}`);
  }
  return executeCommonJs(result.code, (dependency) => {
    if (dependency === "pele" || dependency.startsWith("@babel/runtime/")) {
      return appRequire(dependency);
    }
    throw new Error(`Unexpected worklet dependency: ${dependency}`);
  });
}

it("executes the PR flowchart after the Android Bundle Mode transfer", () => {
  const transformed = transformRenderer();
  const rendererModule = executeCommonJs(transformed, (moduleName) => {
    if (moduleName === "pele") {
      return appRequire(moduleName);
    }
    return loadGeneratedWorklet(moduleName);
  });
  const renderDiagram = rendererModule.renderPeleDiagramSvg;
  if (typeof renderDiagram !== "function") {
    throw new Error("Transformed Pele renderer export is missing");
  }

  const result: unknown = Reflect.apply(renderDiagram, undefined, [GOVERNOR_DIAGRAM, 200_000]);
  expect(result).toMatchObject({ status: "ready" });
  expect(Reflect.get(result, "svg")).toContain("<svg");
  expect(Reflect.get(result, "width")).toBeGreaterThan(0);
  expect(Reflect.get(result, "height")).toBeGreaterThan(0);
});
