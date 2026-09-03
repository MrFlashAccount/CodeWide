import { Pressable, type PressableStateCallbackType, StyleSheet, View } from "react-native";

import { useEvent } from "../../../react/useEvent";
import { colors, radii, spacing, touchTarget, typeScale } from "../../theme";
import { ActionMenu, type ActionMenuItem } from "../../ui/ActionMenu";
import { PresentationIcon } from "../icons/PresentationIcon";
import { ProductText } from "../text/ProductText";

export type WorkspaceMode = "current" | "isolated";

interface WorkspaceModePickerViewProps {
  disabled: boolean;
  mode: WorkspaceMode;
  onSelect(mode: WorkspaceMode): void;
  provider: string;
}

export function WorkspaceModePickerView(props: WorkspaceModePickerViewProps): React.JSX.Element {
  const { disabled, mode, onSelect, provider } = props;
  const select = useEvent((id: string) => {
    if (id === "current" || id === "isolated") onSelect(id);
  });
  return (
    <ActionMenu
      accessibilityLabel="Choose workspace mode"
      actions={workspaceModeActions(mode, provider, disabled)}
      align="center"
      onSelect={select}
      placement="bottom"
    >
      <Pressable
        accessibilityLabel={`Workspace mode, ${mode === "isolated" ? "new workspace" : "in this folder"}`}
        accessibilityRole="button"
        accessibilityState={{ disabled }}
        disabled={disabled}
        style={workspaceModeButtonStyle}
      >
        <View style={styles.content}>
          <PresentationIcon
            color={colors.textMuted}
            name={mode === "isolated" ? "construct" : "folder"}
            size={16}
          />
          <ProductText style={styles.label} tone="muted">
            {mode === "isolated" ? "New workspace" : "In this folder"}
          </ProductText>
          <PresentationIcon color={colors.textMuted} name="chevronDown" size={15} />
        </View>
      </Pressable>
    </ActionMenu>
  );
}

function workspaceModeActions(
  mode: WorkspaceMode,
  provider: string,
  disabled: boolean,
): ActionMenuItem[] {
  return [
    {
      description: "Use the selected project directly",
      disabled,
      icon: "folder-outline",
      id: "current",
      label: "In this folder",
      section: "Workspace",
      selected: mode === "current",
    },
    {
      description: `Create an isolated ${provider} workspace`,
      disabled,
      icon: "git-branch-outline",
      id: "isolated",
      label: "New workspace",
      section: "Workspace",
      selected: mode === "isolated",
    },
  ];
}

function workspaceModeButtonStyle(state: PressableStateCallbackType) {
  const { pressed } = state;
  return [styles.button, pressed && styles.pressed];
}

const styles = StyleSheet.create({
  button: {
    borderRadius: radii.large,
    minHeight: touchTarget,
    paddingHorizontal: spacing.sm,
  },
  content: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xxs,
    minHeight: touchTarget,
  },
  label: { ...typeScale.label },
  pressed: { opacity: 0.68 },
});
