import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const popupSources = [
  "../node_modules/heroui-native/src/components/menu/menu.tsx",
  "../node_modules/heroui-native/src/components/popover/popover.tsx",
  "../node_modules/heroui-native/lib/module/components/menu/menu.js",
  "../node_modules/heroui-native/lib/module/components/popover/popover.js",
] as const;

const popupPrimitiveBuilds = [
  "../node_modules/heroui-native/lib/module/primitives/menu/menu.js",
  "../node_modules/heroui-native/lib/module/primitives/popover/popover.js",
] as const;

const popupPrimitives = [
  "../node_modules/heroui-native/src/primitives/menu/menu.tsx",
  "../node_modules/heroui-native/src/primitives/popover/popover.tsx",
  ...popupPrimitiveBuilds,
] as const;

describe("HeroUI popup layout readiness patch", () => {
  it.each(popupSources)("treats a measured y=0 as ready in %s", async (relativePath) => {
    const source = await readFile(new URL(relativePath, import.meta.url), "utf8");
    const expression = source.match(/const isReady = ([^;]+);/)?.[1];
    expect(expression).toBeDefined();

    const isReady = new Function("contentLayout", "screenHeight", `return ${expression}`) as (
      contentLayout: { y?: number } | null,
      screenHeight: number,
    ) => boolean;

    expect(isReady({ y: 0 }, 900)).toBe(true);
    expect(isReady({ y: 899.5 }, 900)).toBe(true);
    expect(isReady({}, 900)).toBe(false);
    expect(isReady({ y: Number.NaN }, 900)).toBe(false);
    expect(isReady({ y: Number.POSITIVE_INFINITY }, 900)).toBe(false);
    expect(isReady({ y: -1 }, 900)).toBe(false);
    expect(isReady({ y: 900 }, 900)).toBe(false);
    expect(isReady({ y: 901 }, 900)).toBe(false);
    expect(isReady({ y: 0 }, 0)).toBe(false);
    expect(isReady({ y: 0 }, -1)).toBe(false);
    expect(isReady(null, 900)).toBe(false);
  });

  it.each(popupPrimitiveBuilds)("promotes only a finite computed position in %s", async (relativePath) => {
    const primitiveSource = await readFile(new URL(relativePath, import.meta.url), "utf8");
    const helperBody = primitiveSource.match(
      /function syncContentLayoutPosition\(contentLayout, positionStyle\) \{([\s\S]*?)\n\}\nconst Root/,
    )?.[1];
    expect(helperBody).toBeDefined();

    const componentSource = await readFile(
      new URL(relativePath.replace("/primitives/", "/components/"), import.meta.url),
      "utf8",
    );
    const readyExpression = componentSource.match(/const isReady = ([^;]+);/)?.[1];
    expect(readyExpression).toBeDefined();

    type Layout = { x: number; y: number; width: number; height: number };
    const syncPosition = new Function("contentLayout", "positionStyle", helperBody!) as (
      contentLayout: Layout | null,
      positionStyle: { left?: number; top?: number },
    ) => Layout | null;
    const isReady = new Function("contentLayout", "screenHeight", `return ${readyExpression}`) as (
      contentLayout: Layout | null,
      screenHeight: number,
    ) => boolean;
    const sentinel = { x: 0, y: 900, width: 312, height: 240 };

    expect(isReady(sentinel, 900)).toBe(false);
    const positioned = syncPosition(sentinel, { left: 24, top: 0 });
    expect(positioned).toEqual({ ...sentinel, x: 24, y: 0 });
    expect(isReady(positioned, 900)).toBe(true);
    expect(syncPosition(positioned, { left: 24, top: 0 })).toBe(positioned);

    expect(isReady(syncPosition(sentinel, { left: 24, top: 900 }), 900)).toBe(false);
    expect(isReady(syncPosition(sentinel, { left: 24, top: -1 }), 900)).toBe(false);
    expect(syncPosition(sentinel, { left: Number.NaN, top: 0 })).toBe(sentinel);
    expect(syncPosition(sentinel, { left: 24, top: Number.POSITIVE_INFINITY })).toBe(sentinel);
    expect(syncPosition(sentinel, { left: 24 })).toBe(sentinel);
  });

  it("persists the y=0 fix for both source and compiled menu/popover builds", async () => {
    const patch = await readFile(new URL("../../../patches/heroui-native@1.0.8.patch", import.meta.url), "utf8");
    expect(patch.match(/Number\.isFinite\(contentLayout\.y\).*contentLayout\.y >= 0.*contentLayout\.y < screenHeight/g)).toHaveLength(4);
    expect(patch.match(/function syncContentLayoutPosition/g)).toHaveLength(4);
    expect(patch.match(/positionedLayout !== contentLayout/g)).toHaveLength(4);
  });

  it.each(popupPrimitives)("remeasures an open anchor after keyboard and window geometry changes in %s", async (relativePath) => {
    const primitive = await readFile(new URL(relativePath, import.meta.url), "utf8");

    expect(primitive).toContain("Keyboard.addListener('keyboardWillShow', invalidate)");
    expect(primitive).toContain("Keyboard.addListener('keyboardWillHide', invalidate)");
    expect(primitive).toContain("Keyboard.addListener('keyboardDidShow', reposition)");
    expect(primitive).toContain("Keyboard.addListener('keyboardDidHide', reposition)");
    expect(primitive).toContain("Dimensions.addEventListener('change', reposition)");
    expect(primitive).toMatch(/const invalidate = \(\) => \{[\s\S]*?setTriggerPosition\(null\);[\s\S]*?setContentLayout\(null\);[\s\S]*?\};/);
    expect(primitive).toMatch(/const reposition = \(\) => \{[\s\S]*?invalidate\(\);[\s\S]*?requestAnimationFrame\([\s\S]*?measureTrigger\(\);/);
  });

  it("persists keyboard-aware anchor measurement in the HeroUI patch", async () => {
    const patch = await readFile(new URL("../../../patches/heroui-native@1.0.8.patch", import.meta.url), "utf8");
    expect(patch.match(/Keyboard\.addListener\('keyboardDidShow', reposition\)/g)).toHaveLength(4);
    expect(patch.match(/Keyboard\.addListener\('keyboardDidHide', reposition\)/g)).toHaveLength(4);
    expect(patch.match(/Dimensions\.addEventListener\('change', reposition\)/g)).toHaveLength(4);
  });
});
