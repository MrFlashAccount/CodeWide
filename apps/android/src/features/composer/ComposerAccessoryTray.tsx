/** V1 ComposerAccessoryTray owner, extracted without changing interaction or resource lifetime. */
import { Ionicons } from "@expo/vector-icons";
import { Pressable, View } from "react-native";
import { colors, iconSize } from "../../theme";
import { AppText as Text } from "../../ui/Typography";
import { styles } from "./ComposerAccessoryTray.styles";
import type { ComposerAccessoryAction } from "./composerTypes";

export const COMPOSER_ACCESSORY_ACTIONS: ReadonlyArray<{
  icon: keyof typeof Ionicons.glyphMap;
  id: ComposerAccessoryAction;
  label: string;
}> = [
  { icon: "attach-outline", id: "files", label: "File" },
  { icon: "brush-outline", id: "drawing", label: "Drawing" },
  { icon: "extension-puzzle-outline", id: "skills", label: "Skill" },
  { icon: "flag-outline", id: "goal", label: "Goal" },
];

export function ComposerAccessoryTray({
  fileEnabled,
  goalEnabled,
  onSelect,
}: {
  fileEnabled: boolean;
  goalEnabled: boolean;
  onSelect: (action: ComposerAccessoryAction) => void;
}) {
  const enabled = (action: ComposerAccessoryAction) =>
    action === "files" || action === "drawing" ? fileEnabled : action !== "goal" || goalEnabled;
  return (
    <View
      accessibilityLabel="Composer actions"
      style={styles.composerAccessoryTray}
      testID="composer-accessory-tray"
    >
      {COMPOSER_ACCESSORY_ACTIONS.map((action) => {
        const actionEnabled = enabled(action.id);
        return (
          <Pressable
            accessibilityLabel={action.label}
            accessibilityRole="button"
            accessibilityState={{ disabled: !actionEnabled }}
            disabled={!actionEnabled}
            key={action.id}
            onPress={() => {
              onSelect(action.id);
            }}
            style={({ pressed }) => [
              styles.composerAccessoryAction,
              pressed && styles.pressed,
              !actionEnabled && styles.disabled,
            ]}
          >
            <Ionicons color={colors.text} name={action.icon} size={iconSize.action} />
            <Text numberOfLines={1} style={styles.composerAccessoryLabel}>
              {action.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

import type { Dispatch, SetStateAction } from "react";
import { Platform } from "react-native";
import { useEvent } from "../../react/useEvent";
import type { ActionMenuItem } from "../../ui/ActionMenu";
type ComposerAccessoryCapabilities = {
  fileAttachmentEnabled: boolean;
  goalEnabled: boolean;
  openComposerFeature: (action: ComposerAccessoryAction) => void;
  setComposerTrayVisible: Dispatch<SetStateAction<boolean>>;
};
export function useComposerAccessoryActions({
  fileAttachmentEnabled,
  goalEnabled,
  openComposerFeature,
  setComposerTrayVisible,
}: ComposerAccessoryCapabilities) {
  const openAccessoryAction = useEvent((action: ComposerAccessoryAction) => {
    setComposerTrayVisible(false);
    openComposerFeature(action);
  });

  const useAnchoredComposerMenu = Platform.OS === "android";

  const anchoredComposerActions: ActionMenuItem[] = [
    { disabled: !fileAttachmentEnabled, icon: "attach-outline", id: "files", label: "Attach file" },
    { disabled: !fileAttachmentEnabled, icon: "brush-outline", id: "drawing", label: "Drawing" },
    { icon: "sparkles-outline", id: "skills", label: "Skills" },
    { disabled: !goalEnabled, icon: "flag-outline", id: "goal", label: "Goal" },
  ];

  const handleAnchoredComposerAction = useEvent((id: string) => {
    if (id === "files" || id === "drawing" || id === "skills" || id === "goal") {
      openAccessoryAction(id);
    }
  });
  return {
    anchoredComposerActions,
    handleAnchoredComposerAction,
    openAccessoryAction,
    useAnchoredComposerMenu,
  };
}
