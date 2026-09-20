import { compactSource } from "./source-contract";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  effectiveComposerSendPreference,
  resolveComposerSendMode,
} from "../src/features/composer/deliveryMode";

const screen = readFileSync(new URL("../app/v1/_layout.tsx", import.meta.url), "utf8");

const ownerSubmission = readFileSync(
  new URL("../src/features/composer/submission.ts", import.meta.url),
  "utf8",
);
const ownerVoice = readFileSync(
  new URL("../src/features/composer/voice.ts", import.meta.url),
  "utf8",
);

const ownerTimelineJump = readFileSync(
  new URL("../src/features/conversation/timeline/timelineJump.ts", import.meta.url),
  "utf8",
);

const timelineJump = compactSource(
  readFileSync(
    new URL("../src/features/conversation/timeline/timelineJump.ts", import.meta.url),
    "utf8",
  ),
);

describe("composer delivery mode", () => {
  it("queues the normal send mode while a turn is active", () => {
    expect(resolveComposerSendMode("start", true, "turn-active")).toEqual({ type: "queue" });
    expect(effectiveComposerSendPreference("start", true, "turn-active")).toBe("queue");
  });

  it("queues while active even before the turn detail is materialized", () => {
    expect(resolveComposerSendMode("start", true, null)).toEqual({ type: "queue" });
    expect(resolveComposerSendMode("steer", true, null)).toEqual({ type: "queue" });
  });

  it("starts immediately when the thread is idle", () => {
    expect(resolveComposerSendMode("start", false, null)).toEqual({ type: "start" });
    expect(resolveComposerSendMode("queue", false, null)).toEqual({ type: "start" });
    expect(effectiveComposerSendPreference("queue", false, null)).toBe("start");
  });

  it("keeps explicit queue and steer choices while a turn is active", () => {
    expect(resolveComposerSendMode("queue", true, "turn-active")).toEqual({ type: "queue" });
    expect(resolveComposerSendMode("steer", true, "turn-active")).toEqual({
      type: "steer",
      expectedTurnId: "turn-active",
    });
  });

  it("falls back to start when stale turn detail survives an idle lifecycle", () => {
    expect(resolveComposerSendMode("steer", false, null)).toEqual({ type: "start" });
    expect(resolveComposerSendMode("steer", false, "stale-turn")).toEqual({ type: "start" });
  });

  it("finishes active voice input before applying a long-press delivery choice", () => {
    expect(ownerSubmission).toContain('voicePhase !== "idle"');
    expect(ownerSubmission).toContain("await finishVoice(true, id)");
    expect(ownerVoice).toContain(
      "await voiceController?.finish(composerScope, sendAfter, (text) => {",
    );
    expect(ownerVoice).toContain("send(text, preference);");
  });

  it("loads the latest range before asking LegendList to reveal a new turn", () => {
    expect(timelineJump).toMatch(/void historyViewport\s*\.loadLatest\(\)\s*\.then\(\(\) => \{/u);
    expect(ownerTimelineJump).toContain(
      "await list.scrollToEnd({ animated: false }).catch(() => undefined);",
    );
    expect(screen).not.toContain("historyViewport.revealLatest");
    expect(screen).not.toContain("markTimelineAtLatest");
  });
});
