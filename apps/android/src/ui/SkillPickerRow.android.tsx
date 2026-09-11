import { Host, ListItem, Text } from "@expo/ui/jetpack-compose";
import { clickable, fillMaxWidth, height } from "@expo/ui/jetpack-compose/modifiers";
import { useEvent } from "../react/useEvent";
import { colors, typeScale } from "../theme";
import type { SkillPickerRowProps } from "./SkillPickerRow.types";
import { listRowHeight } from "./AppListRow.types";

/** Only the row is native; the parent retains React-side list virtualization. */
export function SkillPickerRow({ title, description, onPress }: SkillPickerRowProps) {
  const press = useEvent(onPress);
  return <Host colorScheme="dark" matchContents={false} style={{ width: "100%", height: listRowHeight.double }}>
    <ListItem
      modifiers={[fillMaxWidth(), height(listRowHeight.double), clickable(press)]}
      colors={{ containerColor: colors.surfaceContainer, contentColor: colors.text, supportingContentColor: colors.textMuted }}
    >
      <ListItem.HeadlineContent>
        <Text maxLines={1} overflow="ellipsis" style={{ fontSize: typeScale.body.fontSize, lineHeight: typeScale.body.lineHeight, fontFamily: "RobotoFlex-Regular" }}>{title}</Text>
      </ListItem.HeadlineContent>
      {description !== "" && <ListItem.SupportingContent>
        <Text maxLines={1} overflow="ellipsis" style={{ fontSize: typeScale.label.fontSize, lineHeight: typeScale.label.lineHeight, fontFamily: "RobotoFlex-Regular" }}>{description}</Text>
      </ListItem.SupportingContent>}
    </ListItem>
  </Host>;
}
