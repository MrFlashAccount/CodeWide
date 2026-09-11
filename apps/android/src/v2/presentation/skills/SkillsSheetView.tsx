import { LegendList, type LegendListRenderItemProps } from "@legendapp/list/react-native";
import { Pressable, type PressableStateCallbackType, StyleSheet, View } from "react-native";

import { useEvent } from "../../../react/useEvent";
import type { SkillCatalogEntry } from "../../application/skills/skillSelection";
import { colors, radii, spacing, touchTarget, typeScale } from "../../theme";
import { PresentationIcon } from "../icons/PresentationIcon";
import {
  PresentationSheetScrollView,
  PresentationSheetView,
} from "../surfaces/PresentationSheetView";
import { ProductText } from "../text/ProductText";
import { ShimmerText } from "../text/ShimmerText";

const SKILL_ROW_HEIGHT = 72;

interface SkillsSheetViewProps {
  actionable: boolean;
  error: string | null;
  loading: boolean;
  onClose(): void;
  onSelect(skill: SkillCatalogEntry): void;
  skills: SkillCatalogEntry[];
  workspaceLabel: string;
}

interface SkillRowProps {
  actionable: boolean;
  onSelect(skill: SkillCatalogEntry): void;
  skill: SkillCatalogEntry;
}

export function SkillsSheetView(props: SkillsSheetViewProps): React.JSX.Element {
  const { actionable, error, loading, onClose, onSelect, skills, workspaceLabel } = props;
  const handleOpenChange = useEvent((isOpen: boolean) => {
    if (!isOpen) onClose();
  });
  const rows = skills.map((skill) => ({ actionable, onSelect, skill }));
  return (
    <PresentationSheetView
      contentProps={{
        dismissLabel: "Close skills",
        performanceSurface: "skills",
        enableDynamicSizing: false,
        snapPoints: ["60%", "90%"],
        index: 0,
      }}
      isOpen
      onOpenChange={handleOpenChange}
    >
      <View style={styles.header}>
        <View style={styles.titleBlock}>
          <ProductText style={styles.title} weight="semibold">
            Skills
          </ProductText>
          <ProductText numberOfLines={1} style={styles.subtitle} tone="muted">
            {workspaceLabel}
          </ProductText>
        </View>
      </View>
      {loading ? (
        <View style={styles.notice}>
          <ShimmerText text="Loading skills…" />
        </View>
      ) : null}
      {error === null ? null : (
        <ProductText accessibilityLiveRegion="polite" style={styles.notice} tone="danger">
          {error}
        </ProductText>
      )}
      {!loading && error === null && skills.length === 0 ? (
        <ProductText style={styles.notice} tone="muted">
          No skills returned for this workspace.
        </ProductText>
      ) : null}
      <LegendList
        data={rows}
        keyExtractor={skillKey}
        getFixedItemSize={skillRowHeight}
        recycleItems
        style={styles.list}
        contentContainerStyle={styles.content}
        renderScrollComponent={PresentationSheetScrollView}
        renderItem={renderSkill}
      />
    </PresentationSheetView>
  );
}

function renderSkill(value: LegendListRenderItemProps<SkillRowProps>): React.JSX.Element {
  return <SkillRow {...value.item} />;
}

function skillKey(row: SkillRowProps): string {
  return row.skill.path;
}

function skillRowHeight(): number {
  return SKILL_ROW_HEIGHT;
}

function SkillRow(props: SkillRowProps): React.JSX.Element {
  const { actionable, onSelect, skill } = props;
  const select = useEvent(() => onSelect(skill));
  return (
    <Pressable
      accessibilityLabel={skill.name}
      accessibilityRole="button"
      accessibilityState={{ disabled: !actionable || !skill.enabled }}
      disabled={!actionable || !skill.enabled}
      onPress={select}
      style={actionable && skill.enabled ? skillRowStyle : disabledSkillRowStyle}
    >
      <View style={styles.skillIcon}>
        <PresentationIcon color={colors.text} name="sparkles" size={20} />
      </View>
      <View style={styles.skillCopy}>
        <ProductText numberOfLines={1} weight="semibold">
          {skill.name}
        </ProductText>
        <ProductText numberOfLines={1} style={styles.description} tone="muted">
          {skill.description}
        </ProductText>
      </View>
      <PresentationIcon color={colors.textDim} name="chevronForward" size={18} />
    </Pressable>
  );
}

function skillRowStyle(state: PressableStateCallbackType) {
  return [styles.skillRow, state.pressed && styles.pressed];
}

function disabledSkillRowStyle(state: PressableStateCallbackType) {
  return [styles.skillRow, styles.disabled, state.pressed && styles.pressed];
}

const styles = StyleSheet.create({
  content: { paddingBottom: spacing.lg },
  list: { flex: 1, minHeight: 0 },
  description: { ...typeScale.label, marginTop: spacing.optical },
  disabled: { opacity: 0.45 },
  header: { alignItems: "center", flexDirection: "row", minHeight: 64 },
  notice: { paddingBottom: spacing.sm },
  pressed: { opacity: 0.68 },
  skillCopy: { flex: 1, minWidth: 0 },
  skillIcon: {
    alignItems: "center",
    backgroundColor: colors.surfaceContainerHigh,
    borderRadius: radii.large,
    height: touchTarget,
    justifyContent: "center",
    width: touchTarget,
  },
  skillRow: {
    alignItems: "center",
    borderRadius: radii.selected,
    flexDirection: "row",
    gap: spacing.sm,
    height: SKILL_ROW_HEIGHT,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xs,
  },
  subtitle: { ...typeScale.label, marginTop: spacing.optical },
  title: { ...typeScale.heading },
  titleBlock: { flex: 1, minWidth: 0 },
});
