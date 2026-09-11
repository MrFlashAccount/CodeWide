import type { ReactNode } from "react";
import type { ComposeIconName } from "../presentation/icons/composeIconNames";

/** Display data lets each platform draw accessories without embedding another UI runtime. */
export interface AppListRowIcon {
  readonly name: ComposeIconName;
  readonly size?: number;
  readonly color?: string;
}

type LeadingAccessory =
  | { readonly leadingIcon?: AppListRowIcon; readonly leading?: undefined }
  | { readonly leading?: ReactNode; readonly leadingIcon?: undefined };

type DescriptionAccessory =
  | { readonly descriptionIcon?: AppListRowIcon; readonly descriptionLeading?: undefined }
  | { readonly descriptionLeading?: ReactNode; readonly descriptionIcon?: undefined };

type TrailingAccessory =
  | {
      readonly trailingIcon?: AppListRowIcon;
      readonly trailing?: undefined;
      readonly trailingBusy?: undefined;
    }
  | {
      readonly trailing?: ReactNode;
      readonly trailingIcon?: undefined;
      readonly trailingBusy?: undefined;
    }
  | {
      readonly trailingBusy: true;
      readonly trailing?: undefined;
      readonly trailingIcon?: undefined;
    };

/** Display-only list row. Callers own selection, pending state, data and secondary actions. */
interface AppListRowContentProps {
  readonly title: string;
  readonly description?: string;
  readonly selected?: boolean;
  readonly disabled?: boolean;
  readonly danger?: boolean;
  readonly multiline?: boolean;
  /** Keep fixed versus content-measured mode stable during a row's mounted lifetime. */
  readonly fixedHeight?: number;
  readonly position?: "only" | "first" | "middle" | "last";
  readonly accessibilityLabel?: string;
  readonly accessibilityHint?: string;
  readonly testID?: string;
  readonly onPress?: () => void;
}

/** Custom React slots remain available for independently interactive accessories. */
export type AppListRowProps = AppListRowContentProps &
  LeadingAccessory &
  DescriptionAccessory &
  TrailingAccessory;

/** Material ListItem's one- and two-line heights; virtual lists must use the same contract. */
export const listRowHeight = { single: 56, double: 72 } as const;

export function listRowPosition(
  index: number,
  count: number,
): "only" | "first" | "middle" | "last" {
  if (count === 1) return "only";
  if (index === 0) return "first";
  return index === count - 1 ? "last" : "middle";
}
