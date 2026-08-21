import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const nativeView = readFileSync(new URL("../android/app/src/main/java/dev/codewide/app/rendering/NativeRevealView.kt", import.meta.url), "utf8");
const nativeManager = readFileSync(new URL("../android/app/src/main/java/dev/codewide/app/rendering/NativeRevealManager.kt", import.meta.url), "utf8");
const nativePackage = readFileSync(new URL("../android/app/src/main/java/dev/codewide/app/remote/CodeWidePackage.kt", import.meta.url), "utf8");
const revealSurface = readFileSync(new URL("../src/rendering/NativeRevealSurface.tsx", import.meta.url), "utf8");
const richMarkdown = readFileSync(new URL("../src/rendering/RichMarkdown.tsx", import.meta.url), "utf8");
const mermaid = readFileSync(new URL("../src/rendering/MermaidDiagram.native.tsx", import.meta.url), "utf8");

describe("native semantic reveal", () => {
  it("registers a child-bearing native surface", () => {
    expect(nativePackage).toContain("NativeRevealManager()");
    expect(nativeManager).toContain('getName(): String = "CodexRevealSurface"');
    expect(nativeManager).toContain("ViewGroupManager<NativeRevealView>");
    expect(revealSurface).toContain('requireNativeComponent<NativeRevealProps>("CodexRevealSurface")');
  });

  it("applies a RuntimeShader to the rendered subtree texture", () => {
    expect(nativeView).toContain("class NativeRevealView(context: Context) : ReactViewGroup(context)");
    expect(nativeView).toContain("uniform shader contents;");
    expect(nativeView).toContain("contents.eval(position)");
    expect(nativeView).toContain('RenderEffect.createRuntimeShaderEffect(runtimeShader, "contents")');
  });

  it("honors readiness and reduced motion", () => {
    expect(nativeView).toContain("if (!pendingReady)");
    expect(nativeView).toContain("if (pendingReduceMotion || !ValueAnimator.areAnimatorsEnabled())");
    expect(revealSurface).toContain("useReducedMotionPreference()");
  });

  it("reveals table rows independently and Mermaid only after rendering", () => {
    expect(richMarkdown).toContain('revealKey={`${path}:row:${rowIndex}`}');
    expect(richMarkdown).toContain("reveal={streaming}");
    expect(mermaid).toContain("ready={!reveal || renderedKey === renderKey}");
    expect(mermaid).toContain("onSettled={() => setRenderedKey(renderKey)}");
  });
});
