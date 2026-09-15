/** V1 ControlOption owner, extracted without changing interaction or resource lifetime. */
import { Ionicons } from "@expo/vector-icons";
import { type ReactNode } from "react";
import { colors, iconSize } from "../theme";
import { AppListRow } from "./AppListRow";
import { listRowHeight } from "./AppListRow.types";

export function ControlOption({
  accessibilityLabel,
  title,
  titleAccessory,
  subtitle,
  selected,
  attention = false,
  disabled = false,
  position = "only",
  onPress,
}: {
  accessibilityLabel?: string;
  title: string;
  titleAccessory?: ReactNode;
  subtitle?: string;
  selected: boolean;
  attention?: boolean;
  disabled?: boolean;
  position?: "only" | "first" | "middle" | "last";
  onPress(): void;
}) {
  return (
    <AppListRow
      title={title}
      {...(subtitle === undefined ? {} : { description: subtitle })}
      accessibilityLabel={`${accessibilityLabel ?? title}${selected ? ", selected" : ""}`}
      selected={selected}
      disabled={disabled}
      onPress={onPress}
      position={position}
      fixedHeight={subtitle === undefined ? listRowHeight.single : listRowHeight.double}
      {...(titleAccessory === undefined
        ? attention
          ? {
              trailingIcon: {
                name: "alert-circle-outline",
                size: iconSize.inline,
                color: colors.amber,
              },
            }
          : {}
        : {
            trailing: (
              <>
                {titleAccessory}
                {attention && (
                  <Ionicons
                    name="alert-circle-outline"
                    size={iconSize.inline}
                    color={colors.amber}
                  />
                )}
              </>
            ),
          })}
    />
  );
}
