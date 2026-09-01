import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useState, useTransition } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";
import type { V2Query, V2QueryResult } from "@codewide/sync-client/v2";

import type { QualifiedThread } from "../../domain/qualifiedThread";
import { ProductText as Text } from "../../presentation/text/ProductText";
import { useEvent } from "../../../react/useEvent";
import { colors, radii, spacing, touchTarget, typeScale, typeWeight } from "../../theme";
import { V2QueryBoundary } from "../shared/V2QueryBoundary";

interface ChangesScreenProps {
  owner: QualifiedThread;
}

type ChangeScope = Extract<V2Query, { kind: "thread.resources" }>["scope"];
type ResourcesResult = Extract<V2QueryResult, { kind: "thread.resources" }>;
type Change = ResourcesResult["changes"][number];

interface ChangesListProps {
  changes: Change[];
  onRefresh(): Promise<void>;
  onSelectScope(scope: ChangeScope): void;
  scope: ChangeScope;
}

interface ScopePickerProps {
  onSelect(scope: ChangeScope): void;
  selected: ChangeScope;
}

interface ScopeOptionProps {
  label: string;
  onSelect(scope: ChangeScope): void;
  scope: ChangeScope;
  selected: boolean;
}

interface ChangeRowProps {
  change: Change;
}

const SCOPES: Array<{ label: string; scope: ChangeScope }> = [
  { label: "Session", scope: "session" },
  { label: "Last turn", scope: "lastTurn" },
  { label: "Staged", scope: "staged" },
  { label: "Unstaged", scope: "unstaged" },
  { label: "Branch", scope: "branch" },
];

export function ChangesScreen(props: ChangesScreenProps): React.JSX.Element {
  const { owner } = props;
  const [scope, setScope] = useState<ChangeScope>("session");
  const selectScope = useEvent((next: ChangeScope) => setScope(next));
  return (
    <V2QueryBoundary
      key={scope}
      chrome="none"
      query={{ kind: "thread.resources", scope, threadId: owner.threadId }}
      savedServerId={owner.savedServerId}
      title="Changes"
    >
      {(result, refresh) => {
        if (result.kind !== "thread.resources") return null;
        return (
          <ChangesList
            changes={result.changes}
            onRefresh={refresh}
            onSelectScope={selectScope}
            scope={scope}
          />
        );
      }}
    </V2QueryBoundary>
  );
}

function ChangesList(props: ChangesListProps): React.JSX.Element {
  const { changes, onRefresh, onSelectScope, scope } = props;
  const [refreshing, startRefresh] = useTransition();
  const refresh = useEvent(() => startRefresh(() => onRefresh()));
  const close = useEvent(() => router.back());
  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <View style={styles.headerIconSlot}>
          <Ionicons color={colors.textMuted} name="git-compare-outline" size={20} />
        </View>
        <Text numberOfLines={1} style={styles.title}>
          Changes · {changes.length}
        </Text>
        <View style={styles.flex} />
        <Pressable
          accessibilityLabel="Refresh changes"
          disabled={refreshing}
          onPress={refresh}
          style={styles.iconButton}
        >
          {refreshing ? (
            <ActivityIndicator color={colors.accent} size="small" />
          ) : (
            <Ionicons color={colors.text} name="refresh" size={20} />
          )}
        </Pressable>
        <Pressable accessibilityLabel="Close changes" onPress={close} style={styles.iconButton}>
          <Ionicons color={colors.text} name="close" size={21} />
        </Pressable>
      </View>
      <ScopePicker onSelect={onSelectScope} selected={scope} />
      <ScrollView contentContainerStyle={styles.content}>
        {changes.map((change) => (
          <ChangeRow key={change.path} change={change} />
        ))}
        {changes.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons color={colors.textDim} name="git-compare-outline" size={28} />
            <Text style={styles.notice}>No file changes in this scope.</Text>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

function ScopePicker(props: ScopePickerProps): React.JSX.Element {
  const { onSelect, selected } = props;
  return (
    <ScrollView
      contentContainerStyle={styles.scopes}
      horizontal
      showsHorizontalScrollIndicator={false}
    >
      {SCOPES.map((entry) => (
        <ScopeOption
          key={entry.scope}
          label={entry.label}
          onSelect={onSelect}
          scope={entry.scope}
          selected={entry.scope === selected}
        />
      ))}
    </ScrollView>
  );
}

function ScopeOption(props: ScopeOptionProps): React.JSX.Element {
  const { label, onSelect, scope, selected } = props;
  const select = useEvent(() => onSelect(scope));
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      onPress={select}
      style={[styles.scope, selected && styles.scopeSelected]}
    >
      <Text style={[styles.scopeText, selected && styles.scopeTextSelected]}>{label}</Text>
    </Pressable>
  );
}

function ChangeRow(props: ChangeRowProps): React.JSX.Element {
  const { change } = props;
  return (
    <View style={styles.row}>
      <View style={styles.resourceIcon}>
        <Ionicons color={changeColor(change.change)} name={changeIcon(change.change)} size={19} />
      </View>
      <View style={styles.rowText}>
        <Text ellipsizeMode="middle" numberOfLines={1} style={styles.rowTitle}>
          {change.path}
        </Text>
        <Text style={styles.rowSubtitle}>{change.change}</Text>
      </View>
      <Text style={styles.additions}>+{change.additions}</Text>
      <Text style={styles.deletions}>−{change.deletions}</Text>
      <Ionicons color={colors.textDim} name="chevron-forward" size={17} />
    </View>
  );
}

function changeIcon(change: Change["change"]): keyof typeof Ionicons.glyphMap {
  if (change === "add") return "add-circle-outline";
  if (change === "delete") return "remove-circle-outline";
  return "document-text-outline";
}

function changeColor(change: Change["change"]): string {
  if (change === "add") return colors.green;
  if (change === "delete") return colors.red;
  return colors.textMuted;
}

const styles = StyleSheet.create({
  additions: { color: colors.green, ...typeScale.label, fontVariant: ["tabular-nums"] },
  content: { gap: spacing.optical, padding: spacing.md, paddingBottom: spacing.xl },
  deletions: { color: colors.red, ...typeScale.label, fontVariant: ["tabular-nums"] },
  empty: { alignItems: "center", gap: spacing.sm, justifyContent: "center", minHeight: 180 },
  flex: { flex: 1 },
  header: {
    alignItems: "center",
    flexDirection: "row",
    minHeight: 54,
    paddingHorizontal: spacing.sm,
  },
  headerIconSlot: { alignItems: "center", justifyContent: "center", width: 32 },
  iconButton: {
    alignItems: "center",
    height: touchTarget,
    justifyContent: "center",
    width: touchTarget,
  },
  notice: { color: colors.textMuted, ...typeScale.body },
  resourceIcon: { alignItems: "center", justifyContent: "center", width: 32 },
  root: { backgroundColor: colors.surface, flex: 1, minHeight: 0 },
  row: {
    alignItems: "center",
    borderRadius: radii.selected,
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: 56,
    paddingHorizontal: spacing.sm,
  },
  rowSubtitle: {
    color: colors.textMuted,
    ...typeScale.caption,

    textTransform: "capitalize",
  },
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: { color: colors.text, ...typeScale.body, fontWeight: typeWeight.medium },
  scope: {
    borderRadius: radii.large,
    minHeight: 34,
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
  },
  scopeSelected: { backgroundColor: colors.surfaceHover },
  scopeText: { color: colors.textMuted, ...typeScale.label },
  scopeTextSelected: { color: colors.text, fontWeight: typeWeight.semibold },
  scopes: { gap: spacing.xs, paddingHorizontal: spacing.md, paddingBottom: spacing.xs },
  title: { color: colors.text, ...typeScale.title },
});
