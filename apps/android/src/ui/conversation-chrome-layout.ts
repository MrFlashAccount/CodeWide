import { controlSize, layoutSize, spacing, touchTarget } from "../theme";

export const conversationChromeEdgeInset = spacing.compact;

export const conversationComposerDockMinHeight = touchTarget + spacing.xxs + spacing.compact;

export function conversationHeaderChromeHeight(searchVisible: boolean): number {
  return layoutSize.header + (searchVisible ? controlSize.regular + spacing.xxs : 0);
}

export function conversationTopContentInset(searchVisible: boolean): number {
  return conversationHeaderChromeHeight(searchVisible) + spacing.compact;
}

export function conversationBottomContentInset(
  composerHeight: number,
  liveStatusVisible: boolean,
): number {
  return composerHeight + (liveStatusVisible ? controlSize.touch + spacing.sm : 0);
}
