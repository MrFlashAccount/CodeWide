import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("V2 keyboard and system insets", () => {
  it("applies every safe-area edge to workspace and fullscreen attachment content", () => {
    const workspace = readFileSync(
      new URL("../src/v2/presentation/layouts/AdaptiveWorkspaceView.tsx", import.meta.url),
      "utf8",
    );
    const attachment = readFileSync(
      new URL(
        "../app/(modal)/servers/[savedServerId]/threads/[threadId]/attachments/[attachmentId].tsx",
        import.meta.url,
      ),
      "utf8",
    );

    for (const edge of ["bottom", "left", "right", "top"] as const) {
      expect(workspace).toContain(`padding${titleCase(edge)}: insets.${edge}`);
    }
    expect(attachment).toContain("<WorkspaceSafeAreaView>");
    expect(attachment).toContain("</WorkspaceSafeAreaView>");
  });

  it("keeps Android system navigation chrome dark for activity and sheet windows", () => {
    const theme = readFileSync(
      new URL("../android/app/src/main/res/values/styles.xml", import.meta.url),
      "utf8",
    );
    const resources = readFileSync(
      new URL("../android/app/src/main/res/values/strings.xml", import.meta.url),
      "utf8",
    );

    expect(resources).toContain(
      '<string name="expo_system_ui_user_interface_style" translatable="false">dark</string>',
    );
    expect(theme).toContain('<item name="android:navigationBarColor">@color/codewide_brand</item>');
    expect(theme).toContain('<item name="android:windowLightNavigationBar">false</item>');
    expect(theme).toContain('<item name="android:enforceNavigationBarContrast">false</item>');
  });
});

function titleCase(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}
