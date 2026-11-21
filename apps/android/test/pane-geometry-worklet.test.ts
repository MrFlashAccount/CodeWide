import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createContext, runInContext } from "node:vm";
import { describe, expect, it } from "vitest";

import type { PaneArrangement } from "../src/routeComposition/paneGeometry";

const appRequire = createRequire(new URL("../package.json", import.meta.url));
const { transformSync } = createRequire(appRequire.resolve("babel-jest"))("@babel/core");
function compileAndroidModule(
  sourceUrl: URL,
  dependencies: ReadonlyMap<string, Record<string, unknown>>,
): Record<string, unknown> {
  const result = transformSync(readFileSync(sourceUrl, "utf8"), {
    filename: sourceUrl.pathname,
    babelrc: false,
    configFile: false,
    caller: { name: "metro", platform: "android", isDev: false },
    presets: [appRequire.resolve("babel-preset-expo")],
  });
  if (typeof result?.code !== "string") throw new Error("Android transform produced no code");
  const exports: Record<string, unknown> = {};
  const context = createContext({
    exports,
    __DEV__: false,
    require: (name: string) => {
      const dependency = dependencies.get(name);
      if (!dependency) throw new Error(`Unexpected geometry dependency: ${name}`);
      return dependency;
    },
  });
  runInContext("globalThis.global = globalThis", context);
  runInContext(result.code, context);
  return exports;
}

function transferToUi(value: unknown): unknown {
  if (typeof value === "number") return value;
  if (typeof value !== "function") throw new Error("Uninitialized UI dependency");
  const data: unknown = Reflect.get(value, "__initData");
  const captured: unknown = Reflect.get(value, "__closure");
  if (
    typeof data !== "object" ||
    data === null ||
    typeof captured !== "object" ||
    captured === null
  ) {
    throw new Error("Missing worklet metadata");
  }
  const code: unknown = Reflect.get(data, "code");
  if (typeof code !== "string") throw new Error("Missing UI executable code");
  const closure: Record<string, unknown> = {};
  for (const [key, dependency] of Object.entries(captured)) {
    closure[key] = transferToUi(dependency);
  }
  const executable: unknown = runInContext(`(${code})`, createContext({}));
  if (typeof executable !== "function") throw new Error("Invalid UI executable code");
  return executable.bind({ __closure: closure });
}

function invoke(callable: unknown, args: readonly unknown[]): unknown {
  if (typeof callable !== "function") throw new Error("Missing geometry function");
  return Reflect.apply(callable, undefined, args);
}

describe("Android-transformed pane geometry", () => {
  const sidebarDimensions = compileAndroidModule(
    new URL("../src/ui/sidebarDimensions.ts", import.meta.url),
    new Map(),
  );
  const geometry = compileAndroidModule(
    new URL("../src/routeComposition/paneGeometry.ts", import.meta.url),
    new Map([
      ["./paneMotionSpec", { COVERED_CATALOG_OPACITY: 0 }],
      ["../ui/sidebarDimensions", sidebarDimensions],
    ]),
  );
  const lefts = ["alone", "beside", "covered", "under"] as const;
  const rights = ["beside", "cover", "offscreen"] as const;

  it.each(["RN", "UI"] as const)("places every arrangement on %s", (runtime) => {
    const resolve = runtime === "UI" ? transferToUi(geometry.paneGeometry) : geometry.paneGeometry;
    for (const left of lefts) {
      for (const right of rights) {
        const arrangement: PaneArrangement = {
          centerLeftRadius: 12,
          centerRightRadius: 12,
          left,
          right,
          sidebar: true,
        };
        // A 1200 wide frame gives the sidebar its plain 34 % share.
        const sidebar = 408;
        const detailX = left === "alone" ? 1200 : left === "beside" ? sidebar : 0;
        const detailWidth = left === "beside" ? 1200 - sidebar : 1200;
        const centerWidth = right === "offscreen" ? detailWidth : detailWidth / 2;
        const catalogWidth = left === "beside" || left === "covered" ? sidebar : 1200;
        const rightWidth = right === "cover" ? detailWidth : detailWidth / 2;
        const detailVisibleWidth = 1200 - detailX;
        const rightVisibleWidth = left === "alone" || right === "offscreen" ? 0 : rightWidth;
        expect(invoke(resolve, [arrangement, 1200])).toEqual({
          catalogOpacity: left === "covered" ? 0 : 1,
          catalogVisibleWidth: detailX,
          catalogWidth,
          centerClipWidth: detailVisibleWidth - rightVisibleWidth,
          centerLeftRadius: 12,
          centerRightRadius: 12,
          centerWidth,
          detailVisibleWidth,
          detailWidth,
          detailX,
          rightVisibleWidth,
          rightWidth,
          rightX: 1200 - rightVisibleWidth,
        });
      }
    }
  });

  it.each(["RN", "UI"] as const)("interpolates pane positions on %s", (runtime) => {
    const resolve =
      runtime === "UI"
        ? transferToUi(geometry.interpolatePaneGeometry)
        : geometry.interpolatePaneGeometry;
    expect(invoke(resolve, [FROM, TO, 0.5])).toEqual({
      catalogOpacity: 0.5,
      catalogVisibleWidth: 150,
      catalogWidth: 300,
      centerClipWidth: 750,
      centerLeftRadius: 6,
      centerRightRadius: 6,
      centerWidth: 900,
      detailVisibleWidth: 1050,
      detailWidth: 1200,
      detailX: 150,
      rightVisibleWidth: 300,
      rightWidth: 600,
      rightX: 900,
    });
  });

  it.each(["RN", "UI"] as const)(
    "keeps a snapshot body's target width through a reversal on %s",
    (runtime) => {
      const worklet = (fn: unknown) => (runtime === "UI" ? transferToUi(fn) : fn);
      const interpolate = worklet(geometry.interpolatePaneGeometry);
      const inset = worklet(geometry.paneChromeInset);
      const margin = worklet(geometry.snapshotBodyMargin);
      const interrupted = invoke(interpolate, [FROM, TO, 0.6]);
      const midwayBack = invoke(interpolate, [interrupted, FROM, 0.5]);
      for (const [box, heldWidth, expected] of [
        ["catalog", 300, 300],
        ["center", 900, 900],
        ["destination", 1200, 900],
        ["right", 600, 450],
      ] as const) {
        const viewport = heldWidth - Number(invoke(inset, [midwayBack, box]));
        expect(viewport - Number(invoke(margin, [midwayBack, FROM, box]))).toBeCloseTo(expected);
      }
    },
  );

  it.each(["RN", "UI"] as const)("derives the pane chrome inset on %s", (runtime) => {
    const interpolate =
      runtime === "UI"
        ? transferToUi(geometry.interpolatePaneGeometry)
        : geometry.interpolatePaneGeometry;
    const inset =
      runtime === "UI" ? transferToUi(geometry.paneChromeInset) : geometry.paneChromeInset;
    const halfway = invoke(interpolate, [FROM, TO, 0.5]);
    // Content holds the larger layout width; chrome gives up what lies past the visible edge.
    expect(invoke(inset, [halfway, "catalog"])).toBe(150);
    expect(invoke(inset, [halfway, "center"])).toBe(150);
    expect(invoke(inset, [halfway, "destination"])).toBe(150);
    expect(invoke(inset, [halfway, "right"])).toBe(300);
    for (const box of ["center", "destination", "right"]) {
      expect(invoke(inset, [TO, box])).toBe(0);
    }
  });
});

/** Opening the right pane beside the center over a catalog that slides away. */
const FROM = {
  catalogOpacity: 1,
  catalogVisibleWidth: 300,
  catalogWidth: 300,
  centerClipWidth: 900,
  centerLeftRadius: 12,
  centerRightRadius: 0,
  centerWidth: 900,
  detailVisibleWidth: 900,
  detailWidth: 900,
  detailX: 300,
  rightVisibleWidth: 0,
  rightWidth: 450,
  rightX: 1200,
};
const TO = {
  catalogOpacity: 0,
  catalogVisibleWidth: 0,
  catalogWidth: 300,
  centerClipWidth: 600,
  centerLeftRadius: 0,
  centerRightRadius: 12,
  centerWidth: 600,
  detailVisibleWidth: 1200,
  detailWidth: 1200,
  detailX: 0,
  rightVisibleWidth: 600,
  rightWidth: 600,
  rightX: 600,
};
