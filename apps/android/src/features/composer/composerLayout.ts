/** V1 composerLayout owner, extracted without changing interaction or resource lifetime. */
import { spacing, touchTarget, typeScale } from "../../theme";
import { conversationComposerDockMinHeight } from "../../ui/conversation-chrome-layout";

export const COMPOSER_MIN_HEIGHT = touchTarget;

/** The text inset is split between the top and the bottom. */
const INSET_SIDES = 2;

/**
 * The editor's vertical text inset: one composer line box centred in the
 * minimum height, so a single line, the placeholder and the last line of a
 * grown draft sit on the centre line of the bottom-aligned + / mic / send
 * controls.
 */
export const COMPOSER_TEXT_INSET =
  (COMPOSER_MIN_HEIGHT - typeScale.composerInput.lineHeight) / INSET_SIDES;

export const COMPOSER_CHIP_TOP_INSET = spacing.xxs;

export const COMPOSER_CHIP_BOTTOM_INSET = spacing.xxs;

export const COMPOSER_MAX_HEIGHT = 132;

export const COMPOSER_DOCK_MIN_HEIGHT = conversationComposerDockMinHeight;
