/** V1 composerLayout owner, extracted without changing interaction or resource lifetime. */
import { spacing, touchTarget } from "../../theme";
import { conversationComposerDockMinHeight } from "../../ui/conversation-chrome-layout";

export const COMPOSER_MIN_HEIGHT = touchTarget;

export const COMPOSER_CHIP_TOP_INSET = spacing.xxs;

export const COMPOSER_CHIP_BOTTOM_INSET = spacing.xxs;

export const COMPOSER_MAX_HEIGHT = 132;

export const COMPOSER_DOCK_MIN_HEIGHT = conversationComposerDockMinHeight;
