import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

import { compactSource } from "./source-contract";

const ownerProtocolBlock = compactSource(readFileSync(new URL("../src/features/conversation/protocol/ProtocolBlock.tsx", import.meta.url), "utf8"));
const ownerTurnTimelineItem = compactSource(readFileSync(new URL("../src/features/conversation/turns/TurnTimelineItem.tsx", import.meta.url), "utf8"));
const ownerTurnActivity = compactSource(readFileSync(new URL("../src/features/conversation/turns/TurnActivity.tsx", import.meta.url), "utf8"));
const ownerLiveAgentResponse = compactSource(readFileSync(new URL("../src/features/conversation/turns/LiveAgentResponse.tsx", import.meta.url), "utf8"));

const detail = compactSource(readFileSync(new URL("../src/features/conversation/ConversationDetail.tsx", import.meta.url), "utf8"));

const activation = compactSource(readFileSync(new URL("../src/features/conversation/conversationActivation.ts", import.meta.url), "utf8"));

const completeMarkdown = compactSource(readFileSync(new URL("../src/features/conversation/content/AgentResponseMarkdown.tsx", import.meta.url), "utf8"));

const completedTurn = compactSource(readFileSync(new URL("../src/features/conversation/turns/CompletedTurnHistory.tsx", import.meta.url), "utf8"));

const ownerMainConversationPublication = compactSource(readFileSync(new URL("../src/features/conversation/MainConversationPublication.tsx", import.meta.url), "utf8"));
const ownerAgentTurnBody = compactSource(readFileSync(new URL("../src/features/conversation/turns/AgentTurnBody.tsx", import.meta.url), "utf8"));

it("invalidates native text display lists, not only the enclosing View", () => {
  const view = readFileSync(new URL("../android/app/src/main/java/dev/codewide/app/rendering/NativeStreamingRevealView.kt", import.meta.url), "utf8");
  // Android's selectable TextView/Editor cache glyph paint separately. The
  // UpdateAppearance notification is the public span path for dirtying it.
  expect(view).toContain("paintRevision = object : UpdateAppearance");
  expect(view).toContain("text?.setSpan(paintRevision");
  expect(view).toContain("target.invalidatePaint()");
  expect(view).not.toContain("StreamingRevealHistory");
});

it("marks completed text as static rather than replaying its streaming animation", () => {
  const screen = compactSource(readFileSync(new URL("../src/CodeWideScreen.tsx", import.meta.url), "utf8"));
  const surface = readFileSync(new URL("../src/rendering/StreamingRevealSurface.tsx", import.meta.url), "utf8");
  expect(ownerProtocolBlock).toContain('reviewTarget={reviewTarget} streamKey={block.key}');
  expect(completeMarkdown).toContain('animateNew={false}');
  expect(completedTurn).toContain('animateNew={false}');
  expect(surface).toContain("NativeSurface !== null && animateNew && !reduceMotion");
  expect(surface).toContain('testID="streaming-reveal-fallback"');
});

it("settles recovered live text before enabling animation for new deltas", () => {
  const screen = compactSource(readFileSync(new URL("../src/CodeWideScreen.tsx", import.meta.url), "utf8"));
  const markdown = readFileSync(new URL("../src/rendering/RichMarkdown.tsx", import.meta.url), "utf8");
  expect(ownerMainConversationPublication).toContain("liveTextRecovery: chatSnapshot.backendRefreshing");
  expect(activation).toContain('surfaceInputs.server?.status === "live" && !readInputs.liveTextRecovery');
  expect(ownerAgentTurnBody).toContain("animateNew={animateLiveUpdates}");
  expect(ownerTurnActivity).toContain('animate={animateNew && motionAllowed && turnStatus === "inProgress"}');
  expect(ownerLiveAgentResponse).toContain('streaming animateStreaming={animateNew}');
  expect(markdown).toContain('animateStreaming = streaming');
  expect(markdown).toContain('parseDiagnosticRichMarkdown(source, !streaming)');
  expect(markdown).toContain('<RichMarkdownRevealContext.Provider value={animateStreaming}>');
});

it("resets the native reveal baseline on navigation, recycling and backgrounding", () => {
  const view = readFileSync(new URL("../android/app/src/main/java/dev/codewide/app/rendering/NativeStreamingRevealView.kt", import.meta.url), "utf8");
  expect(view).toContain("session.createState(current.length, animateNew)");
  expect(view).toContain("session.didPresentText()");
  expect(view).toContain("session.reset()");
  expect(view).toContain("onWindowVisibilityChanged");
  expect(view).toContain("onVisibilityAggregated");
  expect(view).toContain("val animate = animateNew && !reduceMotion");
});
