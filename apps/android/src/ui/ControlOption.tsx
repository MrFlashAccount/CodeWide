/** V1 ControlOption owner, extracted without changing interaction or resource lifetime. */
import { Ionicons } from "@expo/vector-icons";
import type { ReactNode } from "react";
import { colors, iconSize } from "../theme";
import { AppListRow } from "./AppListRow";
import { listRowHeight } from "./AppListRow.types";

export function ControlOption({
  accessibilityLabel,
  attention = false,
  disabled = false,
  onPress,
  position = "only",
  selected,
  subtitle,
  title,
  titleAccessory,
}: {
  accessibilityLabel?: string;
  attention?: boolean;
  disabled?: boolean;
  onPress: () => void;
  position?: "only" | "first" | "middle" | "last";
  selected: boolean;
  subtitle?: string;
  title: string;
  titleAccessory?: ReactNode;
}) {
  return (
    <AppListRow
      title={title}
      {...(subtitle === undefined ? {} : { description: subtitle })}
      accessibilityLabel={`${accessibilityLabel ?? title}${selected ? ", selected" : ""}`}
      disabled={disabled}
      fixedHeight={subtitle === undefined ? listRowHeight.single : listRowHeight.double}
      onPress={onPress}
      position={position}
      selected={selected}
      {...(titleAccessory === undefined
        ? attention
          ? {
              trailingIcon: {
                color: colors.amber,
                name: "alert-circle-outline",
                size: iconSize.inline,
              },
            }
          : {}
        : {
            trailing: (
              <>
                {titleAccessory}
                {attention && (
                  <Ionicons
                    color={colors.amber}
                    name="alert-circle-outline"
                    size={iconSize.inline}
                  />
                )}
              </>
            ),
          })}
    />
  );
}
