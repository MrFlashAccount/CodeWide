import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { compactSource } from "./source-contract";

const nativeView = readFileSync(
  new URL(
    "../android/app/src/main/java/dev/codewide/app/rendering/NativeRevealView.kt",
    import.meta.url,
  ),
  "utf8",
);
const nativeManager = readFileSync(
  new URL(
    "../android/app/src/main/java/dev/codewide/app/rendering/NativeRevealManager.kt",
    import.meta.url,
  ),
  "utf8",
);
const nativePackage = readFileSync(
  new URL(
    "../android/app/src/main/java/dev/codewide/app/remote/CodeWidePackage.kt",
    import.meta.url,
  ),
  "utf8",
);
const revealSurface = readFileSync(
  new URL("../src/rendering/NativeRevealSurface.tsx", import.meta.url),
  "utf8",
);
const richMarkdown = readFileSync(
  new URL("../src/rendering/RichMarkdown.tsx", import.meta.url),
  "utf8",
);
const mermaid = readFileSync(
  new URL("../src/rendering/MermaidDiagram.native.tsx", import.meta.url),
  "utf8",
);

describe("native semantic reveal", () => {
  it("reveals tools and subagent actions only in a moving live tail with stable identities", () => {
    const screen = compactSource(
      readFileSync(
        new URL("../src/features/conversation/turns/TurnActivity.tsx", import.meta.url),
        "utf8",
      ),
    );
    const activity = screen.slice(
      screen.indexOf("function TurnActivitySegment"),
      screen.indexOf("interface TurnActivityProps"),
    );
    expect(activity.match(/revealKey=\{`\$\{turnKey\}:\$\{block.key\}`\}/gu)).toHaveLength(1);
    expect(
      activity.match(
        /animate=\{props\.animateNew && motionAllowed && props\.turnStatus === "inProgress"\}/gu,
      ),
    ).toHaveLength(2);
    expect(activity.match(/<RevealedActivityBlock/gu)).toHaveLength(2);
    expect(activity).toContain("useContext(TimelineMotionContext)");
    expect(nativeView).toContain("RevealHistory.contains(historyKey)");
  });

  it("registers a child-bearing native surface", () => {
    expect(nativePackage).toContain("NativeRevealManager()");
    expect(nativeManager).toContain('getName(): String = "CodexRevealSurface"');
    expect(nativeManager).toContain("ViewGroupManager<NativeRevealView>");
    expect(revealSurface).toContain(
      'requireNativeComponent<NativeRevealProps>("CodexRevealSurface")',
    );
  });

  it("applies a RuntimeShader to the rendered subtree texture", () => {
    expect(nativeView).toContain(
      "class NativeRevealView(context: Context) : ReactViewGroup(context)",
    );
    expect(nativeView).toContain("uniform shader contents;");
    expect(nativeView).toContain("contents.eval(position)");
    expect(nativeView).toContain(
      'RenderEffect.createRuntimeShaderEffect(runtimeShader, "contents")',
    );
  });

  it("honors readiness and reduced motion", () => {
    expect(nativeView).toContain("if (!pendingReady)");
    // Other snap-to-visible cases may share the branch; reduced motion must still finish and return.
    expect(nativeView).toMatch(
      /if \(pendingReduceMotion \|\| !ValueAnimator\.areAnimatorsEnabled\(\)[^\n]*\) \{\s+finishReveal\(\)\s+return/u,
    );
    expect(revealSurface).toContain("useReducedMotionPreference()");
  });

  it("reveals table rows independently and Mermaid only after rendering", () => {
    expect(richMarkdown).toContain("revealKey={`${path}:row:${String(rowIndex)}`}");
    expect(richMarkdown).toContain("reveal={animateStreaming}");
    expect(mermaid).toContain("ready={!reveal || renderedKey === renderKey}");
    expect(mermaid).toMatch(
      /onSettled=\{\(\) => \{\s*setRenderedKey\(renderKey\);\s*\}\}/u,
    );
  });
});
