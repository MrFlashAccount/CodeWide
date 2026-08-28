import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const appConfig = JSON.parse(readFileSync(new URL("../app.json", import.meta.url), "utf8")) as {
  expo: { plugins: Array<string | [string, Record<string, unknown>]> };
};
const appPackage = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  dependencies: Record<string, string>;
};
const rootLayout = readFileSync(new URL("../app/_layout.tsx", import.meta.url), "utf8");
const gate = readFileSync(new URL("../src/ui/AppLockGate.tsx", import.meta.url), "utf8");
const nativeAuthentication = readFileSync(new URL("../src/native/local-authentication.native.ts", import.meta.url), "utf8");
const screen = readFileSync(new URL("../src/CodeWideScreen.tsx", import.meta.url), "utf8");

describe("biometric app lock", () => {
  it("ships the native Expo module and Face ID usage description", () => {
    expect(appPackage.dependencies["expo-local-authentication"]).toBe("~57.0.2");
    expect(appConfig.expo.plugins).toContainEqual([
      "expo-local-authentication",
      { faceIDPermission: "Allow CodeWide to use Face ID to unlock the app" },
    ]);
  });

  it("gates the router behind a durable fail-closed preference", () => {
    expect(rootLayout).toContain("<AppLockGate>");
    expect(rootLayout.indexOf("<AppLockGate>")).toBeLessThan(rootLayout.indexOf("<Stack screenOptions"));
    expect(gate).toContain("use(database.ready)");
    expect(gate).toContain("database.collection.get(APP_LOCK_PREFERENCE_ID)");
    expect(gate).toContain("if (enabled && !unlocked)");
    expect(gate).toContain("AppState.addEventListener");
  });

  it("uses the operating-system prompt and exposes the setting", () => {
    expect(nativeAuthentication).toContain("LocalAuthentication.hasHardwareAsync()");
    expect(nativeAuthentication).toContain("LocalAuthentication.isEnrolledAsync()");
    expect(nativeAuthentication).toContain("LocalAuthentication.authenticateAsync");
    expect(screen).toContain('testID="app-lock-setting"');
    expect(screen).toContain('accessibilityLabel="Biometric app lock"');
  });
});
