import { useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";

import { useEvent } from "../../../react/useEvent";
import { colors, radii, spacing, touchTarget, typeScale } from "../../theme";
import { PresentationIcon } from "../icons/PresentationIcon";
import { ProductText } from "../text/ProductText";
import { ShimmerText } from "../text/ShimmerText";

interface ProjectPickerAddViewProps {
  error: string | null;
  onAdd(path: string): void;
  pending: boolean;
}

export function ProjectPickerAddView(props: ProjectPickerAddViewProps): React.JSX.Element {
  const { error, onAdd, pending } = props;
  const [path, setPath] = useState("");
  const normalizedPath = path.trim();
  const submit = useEvent(() => {
    if (normalizedPath !== "" && !pending) onAdd(normalizedPath);
  });
  return (
    <View style={styles.root}>
      <View style={styles.hero}>
        <View style={styles.heroIcon}>
          <PresentationIcon color={colors.textMuted} name="folder" size={24} />
        </View>
        <ProductText style={styles.title} weight="semibold">
          Add a server folder
        </ProductText>
        <ProductText style={styles.description} tone="muted">
          Enter an absolute directory path. The Companion validates it before pinning the project.
        </ProductText>
      </View>
      <View style={styles.field}>
        <ProductText style={styles.label} tone="muted" weight="semibold">
          Absolute path
        </ProductText>
        <TextInput
          accessibilityLabel="Project absolute path"
          autoCapitalize="none"
          autoCorrect={false}
          editable={!pending}
          onChangeText={setPath}
          onSubmitEditing={submit}
          placeholder="/home/user/project"
          placeholderTextColor={colors.textDim}
          returnKeyType="done"
          style={styles.input}
          value={path}
        />
      </View>
      {error === null ? null : (
        <ProductText accessibilityLiveRegion="polite" tone="danger">
          {error}
        </ProductText>
      )}
      <Pressable
        accessibilityLabel="Use this project folder"
        accessibilityRole="button"
        accessibilityState={{ busy: pending, disabled: normalizedPath === "" || pending }}
        disabled={normalizedPath === "" || pending}
        onPress={submit}
        style={[styles.submit, (normalizedPath === "" || pending) && styles.disabled]}
      >
        {pending ? (
          <ShimmerText style={styles.submitText} text="Adding project…" widthPolicy="intrinsic" />
        ) : (
          <ProductText style={styles.submitText} weight="semibold">
            Use this folder
          </ProductText>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  description: { ...typeScale.body, maxWidth: 420, textAlign: "center" },
  disabled: { opacity: 0.45 },
  field: { gap: spacing.xxs },
  hero: { alignItems: "center", gap: spacing.xs },
  heroIcon: {
    alignItems: "center",
    backgroundColor: colors.surfaceContainer,
    borderRadius: radii.large,
    height: touchTarget,
    justifyContent: "center",
    width: touchTarget,
  },
  input: {
    backgroundColor: colors.surfaceContainer,
    borderColor: colors.border,
    borderRadius: radii.medium,
    borderWidth: StyleSheet.hairlineWidth,
    color: colors.text,
    minHeight: touchTarget,
    paddingHorizontal: spacing.sm,
    ...typeScale.body,
  },
  label: { ...typeScale.caption },
  root: { flex: 1, gap: spacing.md, paddingHorizontal: spacing.xs, paddingTop: spacing.lg },
  submit: {
    alignItems: "center",
    alignSelf: "stretch",
    backgroundColor: colors.accent,
    borderRadius: radii.large,
    justifyContent: "center",
    minHeight: touchTarget,
    paddingHorizontal: spacing.md,
  },
  submitText: { color: colors.onPrimary, ...typeScale.body },
  title: { ...typeScale.title },
});
