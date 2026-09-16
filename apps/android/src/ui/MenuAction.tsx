/** V1 MenuAction owner, extracted without changing interaction or resource lifetime. */
import { Ionicons, MaterialIcons } from "@expo/vector-icons";
import { isComposeIconName } from "../presentation/icons/composeIconNames";
import { colors, iconSize } from "../theme";
import { AppListRow } from "./AppListRow";
import { listRowHeight } from "./AppListRow.types";

export function MenuAction({
  danger = false,
  icon,
  onPress,
  subtitle,
  title,
}: {
  danger?: boolean;
  icon: keyof typeof Ionicons.glyphMap | "push-pin";
  onPress?: () => void;
  subtitle: string;
  title: string;
}) {
  return (
    <AppListRow
      danger={danger}
      description={subtitle}
      disabled={onPress === undefined}
      fixedHeight={listRowHeight.double}
      title={title}
      {...(onPress === undefined ? {} : { onPress })}
      {...(isComposeIconName(icon)
        ? {
            leadingIcon: {
              color: danger ? colors.red : colors.textMuted,
              name: icon,
              size: iconSize.action,
            },
          }
        : {
            leading:
              icon === "push-pin" ? (
                <MaterialIcons
                  color={danger ? colors.red : colors.textMuted}
                  name="push-pin"
                  size={iconSize.action}
                />
              ) : (
                <Ionicons
                  color={danger ? colors.red : colors.textMuted}
                  name={icon}
                  size={iconSize.action}
                />
              ),
          })}
    />
  );
}
