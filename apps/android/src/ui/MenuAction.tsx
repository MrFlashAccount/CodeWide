/** V1 MenuAction owner, extracted without changing interaction or resource lifetime. */
import { Ionicons, MaterialIcons } from "@expo/vector-icons";
import { isComposeIconName } from "../presentation/icons/composeIconNames";
import { colors, iconSize } from "../theme";
import { AppListRow } from "./AppListRow";
import { listRowHeight } from "./AppListRow.types";

export function MenuAction({
  icon,
  title,
  subtitle,
  danger = false,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap | "push-pin";
  title: string;
  subtitle: string;
  danger?: boolean;
  onPress?(): void;
}) {
  return (
    <AppListRow
      title={title}
      description={subtitle}
      danger={danger}
      fixedHeight={listRowHeight.double}
      disabled={onPress === undefined}
      {...(onPress === undefined ? {} : { onPress })}
      {...(isComposeIconName(icon)
        ? {
            leadingIcon: {
              name: icon,
              size: iconSize.action,
              color: danger ? colors.red : colors.textMuted,
            },
          }
        : {
            leading:
              icon === "push-pin" ? (
                <MaterialIcons
                  name="push-pin"
                  size={iconSize.action}
                  color={danger ? colors.red : colors.textMuted}
                />
              ) : (
                <Ionicons
                  name={icon}
                  size={iconSize.action}
                  color={danger ? colors.red : colors.textMuted}
                />
              ),
          })}
    />
  );
}
