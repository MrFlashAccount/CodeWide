import {
  Platform,
  requireNativeComponent,
  UIManager,
  type NativeSyntheticEvent,
  type ViewProps,
} from "react-native";

import type { PlainMarkdownTable } from "./plainMarkdownTable";

/** Natural height after Android wraps the cells at the allocated column width. */
export type TableHeightEvent = NativeSyntheticEvent<{ height: number }>;

type TableProps = ViewProps & {
  grid: PlainMarkdownTable & {
    font: string;
    fontSize: number;
    headerColor: string;
    headerFont: string;
    lineHeight: number;
    paddingX: number;
    paddingY: number;
    ruleColor: string;
    stroke: number;
    textColor: string;
  };
  onTableHeight: (event: TableHeightEvent) => void;
};

const hostName = "CodeWideMarkdownTable";

/** Older Android shells and web continue to use the rich table renderer. */
export const MarkdownTableHost =
  Platform.OS === "android" && UIManager.hasViewManagerConfig(hostName)
    ? requireNativeComponent<TableProps>(hostName)
    : null;
