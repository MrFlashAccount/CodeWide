import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const nativeModule = readFileSync(new URL("../android/app/src/main/java/dev/codewide/app/performance/CodexPerformanceModule.kt", import.meta.url), "utf8");
const nativeCapture = readFileSync(new URL("../android/app/src/main/jni/performance/HermesHeapSnapshot.cpp", import.meta.url), "utf8");
const cmake = readFileSync(new URL("../android/app/src/main/jni/CMakeLists.txt", import.meta.url), "utf8");
const gradle = readFileSync(new URL("../android/app/build.gradle", import.meta.url), "utf8");
const bridge = readFileSync(new URL("../src/native/performance-metrics.native.ts", import.meta.url), "utf8");
const hud = readFileSync(new URL("../src/ui/NavigationPerformanceHud.tsx", import.meta.url), "utf8");

describe("Hermes retained heap capture", () => {
  it("captures on the JS runtime thread directly to a native file", () => {
    expect(nativeModule).toContain("context.runOnJSQueueThread");
    expect(nativeModule).toContain("synchronized(holder)");
    expect(nativeModule).toContain("nativeCaptureHermesHeapSnapshot(runtimePointer, rawSnapshot.absolutePath, true)");
    expect(nativeCapture).toContain('instrumentation.collectGarbage("CodeWide retained heap snapshot")');
    expect(nativeCapture).toContain("instrumentation.createSnapshotToFile(path.get(), {true})");
  });

  it("streams a compressed artifact to Downloads instead of crossing the JS bridge as JSON", () => {
    expect(nativeModule).toContain("GZIPOutputStream(buffered)");
    expect(nativeModule).toContain("MediaStore.Downloads.EXTERNAL_CONTENT_URI");
    expect(nativeModule).toContain('putString("location", "Downloads/$HEAP_SNAPSHOT_DIRECTORY")');
    expect(bridge).toContain("captureHermesHeapSnapshot?(): Promise<HermesHeapSnapshot>");
    expect(bridge).not.toContain("heapsnapshot: string");
  });

  it("packages the JSI capture next to the Hermes CPU profiler", () => {
    expect(gradle).toContain('path file("src/main/jni/CMakeLists.txt")');
    expect(cmake).toContain("add_library(codewide_performance SHARED");
    expect(hud).toContain('title="Hermes CPU profile"');
    expect(hud).toContain('title="Hermes heap snapshot"');
    expect(hud).toContain("captureHermesHeapSnapshot()");
    expect(hud).toContain("attach from the chat composer");
  });
});
