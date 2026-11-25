import { createContext } from "react";
import { spacing } from "../../theme";

/** Shared geometry for the floating catalog switcher and surfaces that scroll behind it. */
export const catalogModeBarHeight = 52;
export const catalogModeBarBottomInset = spacing.compact;
export const catalogModeBarHorizontalInset = spacing.md;
export const catalogModeBarContentInset =
  catalogModeBarHeight + catalogModeBarBottomInset + spacing.sm;
export const catalogModeBarFabBottom =
  catalogModeBarHeight + catalogModeBarBottomInset + spacing.md;

/** Navigation area behind a full-height catalog list, zero in an already inset host. */
export const CatalogNavigationInsetContext = createContext(0);
