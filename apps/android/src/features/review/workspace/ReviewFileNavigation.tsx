import { Ionicons } from "@expo/vector-icons";
import { useEffect, useRef } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { SidebarToggle } from "../../../ui/SidebarToggle";

import { colors, controlSize, iconSize, spacing, typeScale, typeWeight } from "../../../theme";
import { AppText as Text } from "../../../ui/AppText";
import type { CodeReviewFileItem } from "../editor/editorBridge";

/** Native file controls in the current thread's Changes toolbar. */
export function ReviewFileNavigation(props: {
  readonly compact: boolean;
  readonly count: number;
  readonly file: CodeReviewFileItem | undefined;
  readonly index: number;
  readonly onNext: () => void;
  readonly onPrevious: () => void;
  readonly onToggle: () => void;
  readonly open: boolean;
}): React.JSX.Element {
  const { compact, count, file, index, onNext, onPrevious, onToggle, open } = props;
  const name = file?.treePath.split("/").at(-1) ?? "Changes";
  return (
    <>
      {compact ? (
        <FilePicker name={name} onToggle={onToggle} open={open} />
      ) : (
        <>
          <SidebarToggle onToggle={onToggle} open={open} />
          <Text numberOfLines={2} style={styles.name}>
            {name}
          </Text>
          <FileCounts file={file} />
          <FileStep disabled={index <= 0} forward={false} onPress={onPrevious} />
        </>
      )}
      {index >= 0 && (
        <Text numberOfLines={1} style={styles.position}>
          {index + 1} / {count}
        </Text>
      )}
      {!compact && <FileStep disabled={index < 0 || index + 1 >= count} forward onPress={onNext} />}
    </>
  );
}

const ripple = { color: colors.surfaceContainerHigh };

type ToggleProps = { readonly onToggle: () => void; readonly open: boolean };

function FilePicker({
  name,
  onToggle,
  open,
}: ToggleProps & { readonly name: string }): React.JSX.Element {
  const picker = useRef<View>(null);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !open) {
      picker.current?.focus();
    }
    wasOpen.current = open;
  }, [open]);
  return (
    <Pressable
      accessibilityLabel={`Choose file, ${name}`}
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      android_ripple={ripple}
      onPress={onToggle}
      ref={picker}
      style={styles.picker}
    >
      <Text numberOfLines={2} style={styles.pickerName}>
        {name}
      </Text>
      <Ionicons color={colors.textMuted} name="chevron-down" size={iconSize.inline} />
    </Pressable>
  );
}

function FileCounts({
  file,
}: {
  readonly file: CodeReviewFileItem | undefined;
}): React.JSX.Element | null {
  if (file === undefined || file.countsAreNet === false || file.sourceOnly === true) {
    return null;
  }
  return (
    <View style={styles.counts}>
      <Text style={styles.added}>+{file.additions}</Text>
      <Text style={styles.removed}>−{file.deletions}</Text>
    </View>
  );
}

function FileStep(props: {
  readonly disabled: boolean;
  readonly forward: boolean;
  readonly onPress: () => void;
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityLabel={props.forward ? "Next file" : "Previous file"}
      accessibilityRole="button"
      accessibilityState={{ disabled: props.disabled }}
      android_ripple={ripple}
      disabled={props.disabled}
      onPress={props.onPress}
      style={styles.button}
    >
      <Ionicons
        color={props.disabled ? colors.textDim : colors.text}
        name={props.forward ? "chevron-forward" : "chevron-back"}
        size={iconSize.inline}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  added: {
    ...typeScale.label,
    color: colors.green,
  },
  button: {
    alignItems: "center",
    height: controlSize.touch,
    justifyContent: "center",
    width: controlSize.regular,
  },
  counts: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xxs,
  },
  name: {
    ...typeScale.body,
    color: colors.text,
    flex: 1,
    fontWeight: typeWeight.semibold,
    minWidth: 0,
  },
  picker: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: spacing.xxs,
    height: controlSize.touch,
    minWidth: 0,
  },
  pickerName: {
    ...typeScale.body,
    color: colors.text,
    flexShrink: 1,
    fontWeight: typeWeight.semibold,
  },
  position: {
    ...typeScale.label,
    color: colors.textMuted,
    fontVariant: ["tabular-nums"],
  },
  removed: {
    ...typeScale.label,
    color: colors.red,
  },
});
