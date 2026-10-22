import { spacing } from "../../theme";
import { threadListLayout } from "../../ui/thread-list-layout";

const ROW_VERTICAL_SIDES = 2;

export const MASTER_DETAIL_BREAKPOINT = 720;
export const MASTER_MIN_WIDTH = 280;
export const MASTER_MAX_WIDTH = 360;
export const SUBAGENT_BOUNDARY_HEIGHT = spacing.xs;
export const SUBAGENT_ROW_HEIGHT =
  threadListLayout.rowContentHeight + threadListLayout.rowVerticalMargin * ROW_VERTICAL_SIDES;
export const SUBAGENT_SECTION_HEIGHT = threadListLayout.sectionHeight;
