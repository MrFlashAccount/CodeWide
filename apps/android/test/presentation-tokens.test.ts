import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

import { controlHitSlop, controlSize, layoutSize, spacing, touchTarget, typeScale, typeWeight } from "../src/theme";
import { threadListLayout } from "../src/ui/thread-list-layout";
import { APP_MAX_FONT_SIZE_MULTIPLIER } from "../src/ui/typography-policy";

const require = createRequire(new URL("../eslint.config.js", import.meta.url));
const { Linter } = require("eslint");
const presentationTokens = require("./eslint-presentation-tokens.cjs");
const linter = new Linter();

function lintStyle(code: string) {
  return linter.verify(code, {
    languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
    plugins: { codewide: { rules: { tokens: presentationTokens } } },
    rules: { "codewide/tokens": "error" },
  });
}

describe("V1 presentation contract", () => {
  it("has three button sizes, with separate panel geometry and explicit compact hit areas", () => {
    expect(Object.values(controlSize)).toEqual([32, 40, 48]);
    for (const role of ["compact", "regular", "touch"] as const) {
      expect(controlSize[role] + controlHitSlop[role] * 2).toBe(touchTarget);
    }
    expect(layoutSize.header).toBe(56);
    expect(layoutSize.row).toBe(64);
  });

  it("rejects new raw control heights and radii without restricting canvas dimensions", () => {
    expect(lintStyle("StyleSheet.create({ closeButton: { height: 37, borderRadius: 11 } });")).toHaveLength(2);
    expect(lintStyle("StyleSheet.create({ closeButton: { minHeight: controlSize.regular, borderRadius: radii.small }, canvas: { height: 300, width: 400 } });")).toEqual([]);
  });
  it("uses the agreed 14/20 main text and three actual font weights", () => {
    expect(typeScale.body.fontSize).toBe(14);
    expect(typeScale.body.lineHeight).toBe(20);
    expect(typeWeight).toEqual({ regular: "400", medium: "500", semibold: "600" });
    expect(typeScale.heading.fontSize).toBeGreaterThan(typeScale.title.fontSize);
    expect(typeScale.title.fontSize).toBeGreaterThan(typeScale.body.fontSize);
    expect(typeScale.body.fontSize).toBeGreaterThan(typeScale.label.fontSize);
    expect(typeScale.label.fontSize).toBeGreaterThan(typeScale.caption.fontSize);
    for (const role of Object.values(typeScale)) {
      expect(role.lineHeight).toBeGreaterThan(role.fontSize);
    }
  });

  it("fits both sidebar text lines at maximum accessibility scaling without remeasuring rows", () => {
    const textHeight = (typeScale.body.lineHeight + typeScale.label.lineHeight) * APP_MAX_FONT_SIZE_MULTIPLIER;
    const requiredHeight = textHeight + spacing.optical + spacing.compact * 2;
    expect(threadListLayout.rowContentHeight).toBeGreaterThanOrEqual(requiredHeight);
    const sectionHeight = typeScale.caption.lineHeight * APP_MAX_FONT_SIZE_MULTIPLIER + spacing.xs + spacing.xxs;
    expect(threadListLayout.sectionHeight).toBeGreaterThanOrEqual(sectionHeight);
  });

  it.each(["fontSize: 15", "lineHeight: 19", 'fontWeight: "700"', "letterSpacing: -0.15", "gap: 7", "paddingHorizontal: 13", "marginTop: -3"])("rejects new ad-hoc style values: %s", (property) => {
    const diagnostics = lintStyle(`StyleSheet.create({ text: { ${property} } });`);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].ruleId).toBe("codewide/tokens");
  });

  it("also checks inline JSX styles", () => {
    expect(lintStyle("const view = <Text style={{ fontSize: 15 }} />;")).toHaveLength(1);
  });

  it("allows tokens, resets, measured dimensions and explicit native-renderer constants", () => {
    expect(lintStyle(`StyleSheet.create({
      body: { ...typeScale.body, gap: spacing.xs, padding: 0, width: 320 },
      code: { fontSize: NATIVE_CODE_FONT_SIZE, lineHeight: NATIVE_CODE_LINE_HEIGHT },
      overlay: { paddingBottom: keyboardHeight + spacing.sm, marginLeft: "auto" }
    });`)).toEqual([]);
  });

  it("does not impose UI spacing rules on non-style data", () => {
    expect(lintStyle("const measurement = { lineHeight: 16, gap: 7 }; const item = <Editor options={{ fontSize: 13 }} />;")).toEqual([]);
  });
});
