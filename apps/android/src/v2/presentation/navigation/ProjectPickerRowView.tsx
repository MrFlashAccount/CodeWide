import { Pressable, type PressableStateCallbackType, View } from "react-native";

import { useEvent } from "../../../react/useEvent";
import { colors } from "../../theme";
import { PresentationIcon } from "../icons/PresentationIcon";
import { ProductText } from "../text/ProductText";
import { ShimmerText } from "../text/ShimmerText";
import type { ProjectPickerRow } from "./ProjectPickerView";
import { projectPickerStyles as styles } from "./projectPickerStyles";

interface ProjectPickerRowViewProps {
  onPin(project: ProjectPickerRow): void;
  onSelect(path: string | null): void;
  pinDisabled: boolean;
  pinning: boolean;
  project: ProjectPickerRow;
  selectDisabled: boolean;
  selected: boolean;
}

interface ProjectCopyProps {
  detail: string;
  icon: "folder" | "pin" | "server";
  title: string;
}

export function ProjectPickerRowView(props: ProjectPickerRowViewProps): React.JSX.Element {
  const { onPin, onSelect, pinDisabled, pinning, project, selectDisabled, selected } = props;
  const select = useEvent(() => onSelect(project.path));
  const pin = useEvent(() => onPin(project));
  return (
    <View style={selected ? styles.rowSelected : styles.row}>
      <Pressable
        accessibilityLabel={`Project ${project.path}`}
        accessibilityRole="button"
        accessibilityState={{ disabled: selectDisabled, selected }}
        disabled={selectDisabled}
        onPress={select}
        style={rowContentStyle}
      >
        <ProjectPickerCopy
          detail={project.path}
          icon={project.pinned ? "pin" : "folder"}
          title={project.label}
        />
        <PresentationIcon
          color={selected ? colors.accent : colors.textDim}
          name={selected ? "checkCircle" : "radio"}
          size={20}
        />
      </Pressable>
      {project.pinned ? null : (
        <Pressable
          accessibilityLabel={`Pin ${project.label}`}
          accessibilityRole="button"
          accessibilityState={{ busy: pinning, disabled: pinDisabled }}
          disabled={pinDisabled}
          onPress={pin}
          style={pinStyle}
        >
          {pinning ? (
            <ShimmerText style={styles.pinText} text="Pinning…" widthPolicy="intrinsic" />
          ) : (
            <PresentationIcon color={colors.textMuted} name="pin" size={19} />
          )}
        </Pressable>
      )}
    </View>
  );
}

export function ProjectPickerCopy(props: ProjectCopyProps): React.JSX.Element {
  const { detail, icon, title } = props;
  return (
    <>
      <View style={styles.rowIcon}>
        <PresentationIcon color={colors.textMuted} name={icon} size={20} />
      </View>
      <View style={styles.rowCopy}>
        <ProductText numberOfLines={1} style={styles.rowTitle} weight="semibold">
          {title}
        </ProductText>
        <ProductText numberOfLines={1} style={styles.rowDetail} tone="muted">
          {detail}
        </ProductText>
      </View>
    </>
  );
}

function rowContentStyle(state: PressableStateCallbackType) {
  return [styles.rowContent, state.pressed && styles.pressed];
}

function pinStyle(state: PressableStateCallbackType) {
  return [styles.pin, state.pressed && styles.pressed];
}
