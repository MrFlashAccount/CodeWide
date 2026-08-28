import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const readSource = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("Expo UI menu shape", () => {
  it("keeps the native corner-radius bridge as a persistent dependency patch", () => {
    const packageJson = readSource("../../../package.json");
    const patch = readSource("../../../patches/@expo__ui@57.0.9.patch");

    expect(packageJson).toContain('"@expo/ui@57.0.9": "patches/@expo__ui@57.0.9.patch"');
    expect(patch).toContain("build/jetpack-compose/DropdownMenu/index.d.ts");
    expect(patch).toContain("cornerRadius?: number");
    expect(patch).toContain("val cornerRadius: Float? = null");
    expect(patch).toContain("RoundedCornerShape(it.dp)");
    expect(patch).toContain("?: MenuDefaults.shape");
    expect(patch).toContain('"strokeColor"');
    expect(patch).toContain("strokeLineWidth = strokeWidth");
    expect(patch).toContain("strokeLineCap = strokeLineCap");
    expect(patch).toContain("strokeLineJoin = strokeLineJoin");
    expect(patch).toContain("strokeLineMiter = strokeMiterLimit");
    expect(patch).toContain("takeUnless { it.alpha == 0f }");
  });

  it("uses the same 30dp radius as the configured HeroUI menu token", () => {
    const globalCss = readSource("../global.css");
    const theme = readSource("../src/theme.ts");
    const menu = readSource("../src/ui/CodeWideMenu.native.tsx");
    const baseRadiusRem = Number(globalCss.match(/--radius:\s*([\d.]+)rem/u)?.[1]);

    expect(baseRadiusRem * 16 * 3).toBe(30);
    expect(theme).toContain("menu: 30");
    expect(menu).toContain("cornerRadius={radii.menu}");
  });

  it("moves only the message action glyph two dp away from the bubble", () => {
    const screen = readSource("../src/CodeWideScreen.tsx");

    expect(screen).toContain('style={styles.messageActionIcon}');
    expect(screen).toContain("messageActionIcon: { transform: [{ translateX: 2 }] }");
  });
});
