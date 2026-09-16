import { Host, ListItem, Text } from "@expo/ui/jetpack-compose";
import { clickable, fillMaxWidth, height } from "@expo/ui/jetpack-compose/modifiers";
import { useEvent } from "../react/useEvent";
import { colors, typeScale } from "../theme";
import type { SkillPickerRowProps } from "./SkillPickerRow.types";
import { listRowHeight } from "./AppListRow.types";

/** Only the row is native; the parent retains React-side list virtualization. */
export function SkillPickerRow({ description, onPress, title }: SkillPickerRowProps) {
  const press = useEvent(onPress);
  return (
    <Host
      colorScheme="dark"
      matchContents={false}
      style={{ height: listRowHeight.double, width: "100%" }}
    >
      <ListItem
        colors={{
          containerColor: colors.surfaceContainer,
          contentColor: colors.text,
          supportingContentColor: colors.textMuted,
        }}
        modifiers={[fillMaxWidth(), height(listRowHeight.double), clickable(press)]}
      >
        <ListItem.HeadlineContent>
          <Text
            maxLines={1}
            overflow="ellipsis"
            style={{
              fontFamily: "RobotoFlex-Regular",
              fontSize: typeScale.body.fontSize,
              lineHeight: typeScale.body.lineHeight,
            }}
          >
            {title}
          </Text>
        </ListItem.HeadlineContent>
        {description !== "" && (
          <ListItem.SupportingContent>
            <Text
              maxLines={1}
              overflow="ellipsis"
              style={{
                fontFamily: "RobotoFlex-Regular",
                fontSize: typeScale.label.fontSize,
                lineHeight: typeScale.label.lineHeight,
              }}
            >
              {description}
            </Text>
          </ListItem.SupportingContent>
        )}
      </ListItem>
    </Host>
  );
}
