import type { ReactNode } from "react";
import type { ComposeIconName } from "../presentation/icons/composeIconNames";

/** Display data lets each platform draw accessories without embedding another UI runtime. */
interface AppListRowIcon {
  readonly color?: string;
  readonly name: ComposeIconName;
  readonly size?: number;
}

type LeadingAccessory =
  | { readonly leading?: undefined; readonly leadingIcon?: AppListRowIcon }
  | { readonly leading?: ReactNode; readonly leadingIcon?: undefined };

type DescriptionAccessory =
  | { readonly descriptionIcon?: AppListRowIcon; readonly descriptionLeading?: undefined }
  | { readonly descriptionIcon?: undefined; readonly descriptionLeading?: ReactNode };

type TrailingAccessory =
  | {
      readonly trailing?: undefined;
      readonly trailingBusy?: undefined;
      readonly trailingIcon?: AppListRowIcon;
    }
  | {
      readonly trailing?: ReactNode;
      readonly trailingBusy?: undefined;
      readonly trailingIcon?: undefined;
    }
  | {
      readonly trailing?: undefined;
      readonly trailingBusy: true;
      readonly trailingIcon?: undefined;
    };

/** Display-only list row. Callers own selection, pending state, data and secondary actions. */
interface AppListRowContentProps {
  readonly accessibilityHint?: string;
  readonly accessibilityLabel?: string;
  readonly danger?: boolean;
  readonly description?: string;
  readonly disabled?: boolean;
  /** Keep fixed versus content-measured mode stable during a row's mounted lifetime. */
  readonly fixedHeight?: number;
  readonly multiline?: boolean;
  readonly onPress?: () => void;
  readonly position?: "only" | "first" | "middle" | "last";
  readonly selected?: boolean;
  readonly testID?: string;
  readonly title: string;
}

/** Custom React slots remain available for independently interactive accessories. */
export type AppListRowProps = AppListRowContentProps &
  LeadingAccessory &
  DescriptionAccessory &
  TrailingAccessory;

/** Material ListItem's one- and two-line heights; virtual lists must use the same contract. */
export const listRowHeight = { double: 72, single: 56 } as const;

export function listRowPosition(
  index: number,
  count: number,
): "only" | "first" | "middle" | "last" {
  if (count === 1) {
    return "only";
  }
  if (index === 0) {
    return "first";
  }
  return index === count - 1 ? "last" : "middle";
}
