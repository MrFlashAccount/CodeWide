import { catalogModeBarFabBottom } from "../../presentation/layouts/catalogModeBarGeometry";
import { controlSize, spacing } from "../../theme";
import { NEW_THREAD_FAB_SIZE } from "../projects/NewThreadFloatingButton";

/** Diameter of the Global Voice mini action stacked above New thread. */
export const SECONDARY_FAB_SIZE = controlSize.compact;
const FAB_STACK_GAP = spacing.sm;
const PRIMARY_FAB_RIGHT = spacing.md;
const CENTER_DIVISOR = 2;
const AXIS_INSET = (NEW_THREAD_FAB_SIZE - SECONDARY_FAB_SIZE) / CENTER_DIVISOR;

/** Floating actions draw above the list rows and the pull-to-search backdrop. */
export const FLOATING_ACTION_Z_INDEX = 10;

/** Bottom-right placement of the New thread action inside a list pane. */
export const PRIMARY_FAB_PLACEMENT = {
  bottom: catalogModeBarFabBottom,
  right: PRIMARY_FAB_RIGHT,
} as const;

/** The mini action shares the New thread vertical axis, directly above it. */
export const SECONDARY_FAB_ABOVE_PRIMARY = {
  bottom: catalogModeBarFabBottom + NEW_THREAD_FAB_SIZE + FAB_STACK_GAP,
  right: PRIMARY_FAB_RIGHT + AXIS_INSET,
} as const;

/** Without New thread (archived scope) the mini action takes its center on the same axis. */
export const SECONDARY_FAB_ALONE = {
  bottom: catalogModeBarFabBottom + AXIS_INSET,
  right: PRIMARY_FAB_RIGHT + AXIS_INSET,
} as const;

/** Hidden actions move down by the whole stack plus its bottom margin. */
export const FAB_STACK_HIDE_TRAVEL = SECONDARY_FAB_ABOVE_PRIMARY.bottom + SECONDARY_FAB_SIZE;
