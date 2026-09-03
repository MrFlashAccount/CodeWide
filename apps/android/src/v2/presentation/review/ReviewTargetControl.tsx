import { Ionicons } from "@expo/vector-icons";
import type { ComponentProps, ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { useEvent } from "../../../react/useEvent";
import { colors, radii, spacing, touchTarget, typeScale } from "../../theme";
import type { ReviewStartKind, ReviewStartTarget } from "../../rendering/review/reviewModel";
import { PresentationTextInput, ProductText } from "../text/ProductText";

export type ReviewTargetInputRenderer = (
  props: ComponentProps<typeof PresentationTextInput>,
) => ReactNode;

interface ReviewTargetControlProps {
  availableKinds: readonly ReviewStartKind[];
  onChange(target: ReviewStartTarget): void;
  renderCustomInput?: ReviewTargetInputRenderer;
  target: ReviewStartTarget;
}

interface TargetOption {
  detail: string;
  kind: ReviewStartKind;
  label: string;
}

const TARGETS: TargetOption[] = [
  { detail: "Working tree changes", kind: "uncommitted", label: "Uncommitted changes" },
  { detail: "Compare with a branch", kind: "baseBranch", label: "Base branch" },
  { detail: "Inspect one commit", kind: "commit", label: "Commit" },
  { detail: "Describe a custom review", kind: "custom", label: "Custom" },
];

export function ReviewTargetControl(props: ReviewTargetControlProps): React.JSX.Element {
  const { availableKinds, onChange, renderCustomInput, target } = props;
  const available = new Set(availableKinds);
  const select = useEvent((kind: ReviewStartKind) => onChange(defaultTarget(kind)));
  const editValue = useEvent((value: string) => onChange(targetWithValue(target, value)));
  return (
    <View style={styles.root}>
      {TARGETS.filter((option) => available.has(option.kind)).map((option) => (
        <TargetRow
          key={option.kind}
          onSelect={select}
          option={option}
          selected={target.kind === option.kind}
        />
      ))}
      {target.kind === "uncommitted"
        ? null
        : renderTargetInput(target, editValue, renderCustomInput)}
    </View>
  );
}

function renderTargetInput(
  target: Exclude<ReviewStartTarget, { kind: "uncommitted" }>,
  onChangeText: (value: string) => void,
  renderCustomInput: ReviewTargetInputRenderer | undefined,
): ReactNode {
  const inputProps: ComponentProps<typeof PresentationTextInput> = {
    accessibilityLabel: inputLabel(target.kind),
    autoCapitalize: "none",
    autoCorrect: false,
    multiline: target.kind === "custom",
    onChangeText,
    placeholder: inputLabel(target.kind),
    placeholderTextColor: colors.textDim,
    style: [styles.input, target.kind === "custom" && styles.multilineInput],
    value: targetValue(target),
  };
  if (target.kind === "custom" && renderCustomInput !== undefined) {
    return renderCustomInput(inputProps);
  }
  return <PresentationTextInput {...inputProps} />;
}

interface TargetRowProps {
  onSelect(kind: ReviewStartKind): void;
  option: TargetOption;
  selected: boolean;
}

function TargetRow(props: TargetRowProps): React.JSX.Element {
  const { onSelect, option, selected } = props;
  const select = useEvent(() => onSelect(option.kind));
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      onPress={select}
      style={[styles.option, selected && styles.optionSelected]}
    >
      <View style={styles.optionCopy}>
        <ProductText weight="medium">{option.label}</ProductText>
        <ProductText style={styles.detail} tone="dim">
          {option.detail}
        </ProductText>
      </View>
      <Ionicons
        color={selected ? colors.accent : colors.textDim}
        name={selected ? "radio-button-on" : "radio-button-off"}
        size={21}
      />
    </Pressable>
  );
}

export function isReviewTargetReady(target: ReviewStartTarget): boolean {
  return target.kind === "uncommitted" || targetValue(target).trim() !== "";
}

function defaultTarget(kind: ReviewStartKind): ReviewStartTarget {
  if (kind === "uncommitted") return { kind };
  if (kind === "baseBranch") return { branch: "", kind };
  if (kind === "commit") return { kind, sha: "" };
  return { instructions: "", kind };
}

function targetWithValue(target: ReviewStartTarget, value: string): ReviewStartTarget {
  if (target.kind === "baseBranch") return { branch: value, kind: target.kind };
  if (target.kind === "commit") return { kind: target.kind, sha: value };
  if (target.kind === "custom") return { instructions: value, kind: target.kind };
  return target;
}

function targetValue(target: ReviewStartTarget): string {
  if (target.kind === "baseBranch") return target.branch;
  if (target.kind === "commit") return target.sha;
  if (target.kind === "custom") return target.instructions;
  return "";
}

function inputLabel(kind: Exclude<ReviewStartKind, "uncommitted">): string {
  if (kind === "baseBranch") return "Base branch";
  if (kind === "commit") return "Commit SHA";
  return "Review instructions";
}

const styles = StyleSheet.create({
  detail: { ...typeScale.caption },
  input: {
    backgroundColor: colors.surfaceContainer,
    borderColor: colors.border,
    borderRadius: radii.large,
    borderWidth: 1,
    color: colors.text,
    minHeight: touchTarget,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    ...typeScale.body,
  },
  multilineInput: { minHeight: 120, textAlignVertical: "top" },
  option: {
    alignItems: "center",
    borderRadius: radii.selected,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 62,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  optionCopy: { flex: 1, gap: spacing.optical, minWidth: 0 },
  optionSelected: { backgroundColor: colors.surfaceHover },
  root: { gap: spacing.xxs },
});
