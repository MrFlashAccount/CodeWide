import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createContext, runInContext } from "node:vm";
import { describe, expect, it } from "vitest";

const appRequire = createRequire(new URL("../package.json", import.meta.url));
const babelRequire = createRequire(appRequire.resolve("babel-jest"));
const { transformSync } = babelRequire("@babel/core");
const sourceUrl = new URL("../src/ui/appNoticeSwipeExit.ts", import.meta.url);
const source = readFileSync(sourceUrl, "utf8");

function compileResolver(input: string): unknown {
  // Exercise Expo's actual Android Worklets transform rather than the render-test mock.
  const result = transformSync(input, {
    filename: sourceUrl.pathname,
    babelrc: false,
    configFile: false,
    caller: { name: "metro", platform: "android", isDev: false },
    presets: [appRequire.resolve("babel-preset-expo")],
  });
  if (typeof result?.code !== "string") throw new Error("Android transform produced no code");
  const exports: Record<string, unknown> = {};
  const context = createContext({ exports, __DEV__: false });
  runInContext("globalThis.global = globalThis", context);
  runInContext(result.code, context);
  return exports.resolveNoticeSwipeExit;
}

function transferToUi(value: unknown): unknown {
  if (typeof value !== "function") {
    if (typeof value === "number" || typeof value === "string" || typeof value === "boolean") {
      return value;
    }
    throw new Error("Unsupported UI closure value");
  }
  // __initData.code and __closure are the Worklets serialization contract. The isolated
  // runtime must execute that code and must never fall back to the original RN function.
  const data: unknown = Reflect.get(value, "__initData");
  const captured: unknown = Reflect.get(value, "__closure");
  if (
    typeof data !== "object" ||
    data === null ||
    typeof captured !== "object" ||
    captured === null
  ) {
    throw new Error("Remote Function cannot be called synchronously on the UI Runtime");
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

function invokeUi(
  resolver: unknown,
  motion: {
    x: number;
    y: number;
    velocityX: number;
    velocityY: number;
  },
): unknown {
  if (typeof resolver !== "function") throw new Error("Missing UI resolver");
  return Reflect.apply(resolver, undefined, [motion]);
}

describe("notice dismissal on the isolated UI runtime", () => {
  const resolver = transferToUi(compileResolver(source));
  it.each([
    [
      { x: 70, y: 0, velocityX: 0, velocityY: 0 },
      { kind: "horizontal", direction: 1 },
    ],
    [
      { x: -70, y: 0, velocityX: 0, velocityY: 0 },
      { kind: "horizontal", direction: -1 },
    ],
    [
      { x: 10, y: 0, velocityX: 400, velocityY: 0 },
      { kind: "horizontal", direction: 1 },
    ],
    [{ x: 0, y: -70, velocityX: 0, velocityY: 0 }, { kind: "up" }],
    [{ x: 0, y: -10, velocityX: 0, velocityY: -400 }, { kind: "up" }],
    [{ x: 0, y: 70, velocityX: 0, velocityY: 400 }, { kind: "none" }],
    [{ x: 10, y: 0, velocityX: 0, velocityY: 0 }, { kind: "none" }],
    [{ x: 0, y: -10, velocityX: 0, velocityY: 0 }, { kind: "none" }],
    [{ x: 0, y: 0, velocityX: 0, velocityY: 0 }, { kind: "none" }],
  ])("resolves motion %j without an RN callback", (motion, expected) => {
    expect(invokeUi(resolver, motion)).toEqual(expected);
  });

  it("rejects the untransformed helper that caused the native crash", () => {
    const remoteResolver = compileResolver(source.replace('  "worklet";\n', ""));
    expect(() => transferToUi(remoteResolver)).toThrow("Remote Function");
  });
});
