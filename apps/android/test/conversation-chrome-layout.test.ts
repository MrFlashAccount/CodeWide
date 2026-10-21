import { describe, expect, it } from "vitest";

import { controlSize, darkScheme, layoutSize, radii, spacing, colors } from "../src/theme";
import {
  conversationBottomContentInset,
  conversationChromeEdgeInset,
  conversationHeaderChromeHeight,
  conversationTopContentInset,
} from "../src/ui/conversation-chrome-layout";

describe("conversation chrome layout", () => {
  it("reuses the existing neutral surfaces instead of inventing a palette", () => {
    expect(colors.threadListSurface).toBe(darkScheme.background);
    expect(colors.conversationSurface).toBe(darkScheme.surface);
    expect(colors.messageSurface).toBe(darkScheme.background);
  });

  it("reserves only the chrome that can cover the first and last message", () => {
    expect(conversationTopContentInset(false)).toBe(layoutSize.header + spacing.compact);
    expect(conversationTopContentInset(true)).toBe(
      conversationTopContentInset(false) + controlSize.regular + spacing.xxs,
    );
    expect(conversationBottomContentInset(96, false)).toBe(96);
    expect(conversationBottomContentInset(96, true)).toBe(96 + controlSize.touch + spacing.sm);
  });

  it("clips opaque surfaces to the complete top and bottom chrome", () => {
    expect(conversationHeaderChromeHeight(false)).toBe(layoutSize.header);
    expect(conversationHeaderChromeHeight(true)).toBe(
      layoutSize.header + controlSize.regular + spacing.xxs,
    );
  });

  it("overlays edge-to-edge chrome without a panel shadow", () => {
    expect(conversationChromeEdgeInset).toBe(spacing.compact);
    expect(radii.composer).toBeGreaterThan(radii.medium);
  });
});
