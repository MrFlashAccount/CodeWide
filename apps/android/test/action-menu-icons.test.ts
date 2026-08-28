import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const typesUrl = new URL("../src/ui/ActionMenu.types.ts", import.meta.url);
const nativeMenuUrl = new URL("../src/ui/ActionMenu.native.tsx", import.meta.url);
const codeWideMenuUrl = new URL("../src/ui/CodeWideMenu.native.tsx", import.meta.url);
const types = readFileSync(typesUrl, "utf8");
const nativeMenu = readFileSync(nativeMenuUrl, "utf8");
const codeWideMenu = readFileSync(codeWideMenuUrl, "utf8");

describe("native action-menu icons", () => {
  it("passes named icons through instead of converting them to XML assets", () => {
    expect(types).toContain('ComponentProps<typeof Ionicons>["name"]');
    expect(types).toContain("ActionMenuIconName | ImageSourcePropType");
    expect(nativeMenu).toContain("{ icon: action.icon }");
    expect(nativeMenu).not.toContain("ACTION_ICONS");
    expect(nativeMenu).not.toContain("resolveNativeIcon");
    expect(nativeMenu).not.toContain("assets/menu-icons");
  });

  it("renders real Ionicons inside the native Compose menu slots", () => {
    expect(codeWideMenu).toContain('import Ionicons from "@expo/vector-icons/Ionicons"');
    expect(codeWideMenu).toContain("<RNHostView matchContents>");
    expect(codeWideMenu).toContain("<Ionicons color={color} name={icon} size={size} />");
    expect(codeWideMenu).toContain('<MenuIcon icon="checkmark" size={18} color={colors.text} />');
    expect(codeWideMenu).not.toContain("assets/menu-icons");
  });

  it("preserves custom React Native image sources as a fallback", () => {
    expect(codeWideMenu).toContain("ActionMenuIconName | ImageSourcePropType");
    expect(codeWideMenu).toContain('if (typeof icon !== "string")');
    expect(codeWideMenu).toContain("<Icon source={icon} size={size} tint={color} />");
  });
});
