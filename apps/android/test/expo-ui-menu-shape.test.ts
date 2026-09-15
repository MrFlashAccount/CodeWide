import { compactSource } from "./source-contract";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const readSource = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

const railStyles = compactSource(readFileSync(new URL("../src/features/conversation/turns/MessageActionRail.styles.ts", import.meta.url), "utf8"));

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

  it("uses the bubble radius and compiles the patched Compose source, not the prebuilt AAR", () => {
    const menu = readSource("../src/ui/CodeWideMenu.native.tsx");
    const bubble = readSource("../src/rendering/Bubble.tsx");
    const manifest = JSON.parse(readSource("../package.json"));
    expect(manifest.expo.autolinking.android.buildFromSource).toEqual(["expo-ui"]);
    expect(menu).toContain("cornerRadius={radii.selected}");
    expect(bubble).toContain("borderRadius: radii.selected");
  });

  it("places the message action beside the bubble without shrinking its touch area", () => {
    const screen = readSource("../src/CodeWideScreen.tsx");

    expect(screen).not.toContain('style={styles.messageActionIcon}');
    const actionStyle = railStyles.match(/messageActionButton: \{[^}]+\}/u)?.[0];
    expect(actionStyle).toContain('alignItems: "flex-start"');
    expect(actionStyle).toContain('width: controlSize.compact');
    expect(readSource("../src/features/conversation/turns/TurnTimelineItem.styles.ts").match(/agentMessageRow: \{[^}]+\}/u)?.[0]).toContain('gap: 0');
    expect(actionStyle).toContain('justifyContent: "center"');
    expect(actionStyle).not.toContain('marginLeft');
  });
});
