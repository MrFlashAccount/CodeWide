import { Ionicons } from "@expo/vector-icons";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";

import { useEvent } from "../../../react/useEvent";
import { colors, radii, spacing, touchTarget, typeScale } from "../../theme";
import type { ReviewScope, ReviewViewMode } from "../../rendering/review/reviewModel";
import { ActionPressable } from "../../ui/actions/ActionPressable";
import { ProductText } from "../text/ProductText";

interface ReviewWorkspaceHeaderProps {
  commentCount: number;
  fileCount: number;
  mode: ReviewViewMode;
  onClose(): void;
  onModeChange(mode: ReviewViewMode): void;
  onScopeChange(scope: ReviewScope): void;
  onSubmit(): Promise<void>;
  onWrapChange(wrap: boolean): void;
  scope: ReviewScope;
  scopes: ReviewScope[];
  submitDisabled: boolean;
  wrapLines: boolean;
}

const MODES: ReviewViewMode[] = ["unified", "split", "source"];

export function ReviewWorkspaceHeader(props: ReviewWorkspaceHeaderProps): React.JSX.Element {
  const {
    commentCount,
    fileCount,
    mode,
    onClose,
    onModeChange,
    onScopeChange,
    onSubmit,
    onWrapChange,
    scope,
    scopes,
    submitDisabled,
    wrapLines,
  } = props;
  const toggleWrap = useEvent(() => onWrapChange(!wrapLines));
  return (
    <View style={styles.root}>
      <View style={styles.titleRow}>
        <Pressable
          accessibilityLabel="Close code review"
          onPress={onClose}
          style={styles.iconButton}
        >
          <Ionicons color={colors.text} name="close" size={23} />
        </Pressable>
        <View style={styles.titleBlock}>
          <ProductText numberOfLines={1} style={styles.title} weight="semibold">
            Code review
          </ProductText>
          <ProductText numberOfLines={1} style={styles.subtitle} tone="dim">
            {scopeLabel(scope)} · {fileCount} files · {commentCount} comments
          </ProductText>
        </View>
        <ActionPressable
          action={{
            disabled: submitDisabled || commentCount === 0,
            id: "submit-review-feedback",
            label: "Submit",
            run: onSubmit,
          }}
        />
      </View>
      <ScrollView
        contentContainerStyle={styles.controls}
        horizontal
        showsHorizontalScrollIndicator={false}
      >
        {scopes.map((option) => (
          <ScopeChip
            key={option}
            onSelect={onScopeChange}
            option={option}
            selected={scope === option}
          />
        ))}
        <View style={styles.divider} />
        {MODES.map((option) => (
          <ModeChip
            key={option}
            onSelect={onModeChange}
            option={option}
            selected={mode === option}
          />
        ))}
        <OptionChip label="Wrap" onSelect={toggleWrap} selected={wrapLines} />
      </ScrollView>
    </View>
  );
}

interface ScopeChipProps {
  onSelect(scope: ReviewScope): void;
  option: ReviewScope;
  selected: boolean;
}

function ScopeChip(props: ScopeChipProps): React.JSX.Element {
  const { onSelect, option, selected } = props;
  const select = useEvent(() => onSelect(option));
  return <OptionChip label={scopeLabel(option)} onSelect={select} selected={selected} />;
}

interface ModeChipProps {
  onSelect(mode: ReviewViewMode): void;
  option: ReviewViewMode;
  selected: boolean;
}

function ModeChip(props: ModeChipProps): React.JSX.Element {
  const { onSelect, option, selected } = props;
  const select = useEvent(() => onSelect(option));
  return <OptionChip label={modeLabel(option)} onSelect={select} selected={selected} />;
}

interface OptionChipProps {
  label: string;
  onSelect(): void;
  selected: boolean;
}

function OptionChip(props: OptionChipProps): React.JSX.Element {
  const { label, onSelect, selected } = props;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onSelect}
      style={[styles.chip, selected && styles.chipSelected]}
    >
      <ProductText style={styles.chipText} tone={selected ? "default" : "muted"}>
        {label}
      </ProductText>
    </Pressable>
  );
}

function scopeLabel(scope: ReviewScope): string {
  if (scope === "lastTurn") return "Last turn";
  return scope.charAt(0).toUpperCase() + scope.slice(1);
}

function modeLabel(mode: ReviewViewMode): string {
  return mode.charAt(0).toUpperCase() + mode.slice(1);
}

const styles = StyleSheet.create({
  chip: {
    borderRadius: radii.pill,
    justifyContent: "center",
    minHeight: 34,
    paddingHorizontal: spacing.sm,
  },
  chipSelected: { backgroundColor: colors.surfaceHover },
  chipText: { ...typeScale.label },
  controls: {
    alignItems: "center",
    gap: spacing.xs,
    paddingBottom: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  divider: { backgroundColor: colors.borderSoft, height: 22, width: StyleSheet.hairlineWidth },
  iconButton: {
    alignItems: "center",
    height: touchTarget,
    justifyContent: "center",
    width: touchTarget,
  },
  root: {
    backgroundColor: colors.surface,
    borderBottomColor: colors.borderSoft,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  subtitle: { ...typeScale.caption },
  title: { ...typeScale.title },
  titleBlock: { flex: 1, minWidth: 0 },
  titleRow: {
    alignItems: "center",
    flexDirection: "row",
    minHeight: 58,
    paddingHorizontal: spacing.xs,
  },
});
