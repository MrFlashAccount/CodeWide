import { readFileSync } from "node:fs";

import { expect, it } from "vitest";

import { v1MobileRouteMotion } from "../src/ui/v1MobileRouteMotion";

const routeStyles = readFileSync(
  new URL("../app/v1/V1WorkspaceShell.styles.ts", import.meta.url),
  "utf8",
);

function readAndroidTransitionResource(filename: string): string {
  return readFileSync(
    new URL(`../android/app/src/main/res/anim/${filename}`, import.meta.url),
    "utf8",
  );
}

const pushForeground = readAndroidTransitionResource("rns_fade_from_bottom.xml");
const pushBackground = readAndroidTransitionResource("rns_no_animation_350.xml");
const popBackground = readAndroidTransitionResource("rns_no_animation_250.xml");
const popForeground = readAndroidTransitionResource("rns_fade_to_bottom.xml");
const androidTransitionResources = [pushForeground, pushBackground, popBackground, popForeground];

it("uses a symmetric 250 ms Android crossfade with short horizontal travel", () => {
  const mobileOptions = routeStyles.slice(
    routeStyles.indexOf("export const v1MobileRouteScreenOptions"),
    routeStyles.indexOf("export const v1ListScreenOptions"),
  );

  expect(mobileOptions).toContain('animation: "fade_from_bottom"');
  expect(v1MobileRouteMotion.durationMs).toBe(250);
  expect(mobileOptions).toContain("animationDuration: v1MobileRouteMotion.durationMs");
  expect(mobileOptions).not.toContain('animation: "default"');
  expect(mobileOptions).not.toContain('animation: "slide_from_right"');
  for (const resource of androidTransitionResources) {
    expect(resource).toContain('android:duration="250"');
    expect(resource).toContain("android:fromXDelta");
    expect(resource).toContain("android:toXDelta");
    expect(resource).toContain("<alpha");
  }
  expect(pushForeground).toContain('android:fromAlpha="0.0"');
  expect(pushForeground).toContain('android:fromXDelta="4%"');
  expect(pushBackground).toContain('android:toAlpha="0.0"');
  expect(pushBackground).toContain('android:toXDelta="-2%"');
  expect(popBackground).toContain('android:fromAlpha="0.0"');
  expect(popBackground).toContain('android:fromXDelta="-2%"');
  expect(popForeground).toContain('android:toAlpha="0.0"');
  expect(popForeground).toContain('android:toXDelta="4%"');
});
