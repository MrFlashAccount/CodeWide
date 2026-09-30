import { createContext, useContext } from "react";
import { Platform } from "react-native";

export type RichMarkdownPremeasurementPolicy = Readonly<{
  active: boolean;
  enabled: boolean;
  fontScale: number;
  width: number | null;
}>;

/** Timeline-local configuration for Pretext-owned stable Markdown rows. */
export const RichMarkdownPremeasurementContext = createContext<RichMarkdownPremeasurementPolicy>({
  active: false,
  enabled: false,
  fontScale: 1,
  width: null,
});

/** Returns the active timeline policy; ordinary Markdown consumers remain untouched. */
export function useRichMarkdownPremeasurement(): RichMarkdownPremeasurementPolicy | null {
  const policy = useContext(RichMarkdownPremeasurementContext);
  return policy.enabled && policy.active ? policy : null;
}

/** Selects the Android greedy line breaker used by Pretext for premeasured Markdown. */
export function useRichMarkdownTextBreakStrategy(): "simple" | undefined {
  return useRichMarkdownPremeasurement() !== null && Platform.OS === "android"
    ? "simple"
    : undefined;
}
