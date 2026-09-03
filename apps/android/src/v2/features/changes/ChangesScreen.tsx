import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useState, useTransition } from "react";
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from "react-native";
import type { V2Query, V2QueryResult } from "@codewide/sync-client/v2";

import type { QualifiedThread } from "../../domain/qualifiedThread";
import { ChangeDiffView } from "../../presentation/changes/ChangeDiffView";
import { ProductText as Text } from "../../presentation/text/ProductText";
import { ShimmerText } from "../../presentation/text/ShimmerText";
import { useEvent } from "../../../react/useEvent";
import { colors, radii, spacing, touchTarget, typeScale, typeWeight } from "../../theme";
import { ChangesReviewLaunchButton } from "../review/ReviewEntryActions";
import { V2QueryBoundary } from "../shared/V2QueryBoundary";
import { threadChangeOutputDestination } from "../navigation/routeDestinations";

interface ChangesScreenProps {
  owner: QualifiedThread;
}

type ChangeScope = Extract<V2Query, { kind: "thread.resources" }>["scope"];
type ResourcesResult = Extract<V2QueryResult, { kind: "thread.resources" }>;
type Change = ResourcesResult["changes"][number];

interface ChangesWorkspaceProps {
  availableScopes: ChangeScope[];
  changes: Change[];
  onClose(): void;
  onRefresh(): Promise<void>;
  onSelectScope(scope: ChangeScope): void;
  owner: QualifiedThread;
  reviewAvailable: boolean;
  scope: ChangeScope;
}

interface ScopeOptionProps {
  label: string;
  onSelect(scope: ChangeScope): void;
  scope: ChangeScope;
  selected: boolean;
}

interface ChangeRowProps {
  change: Change;
  onSelect(change: Change): void;
  selected: boolean;
}

interface ChangePreviewProps {
  change: Change;
  owner: QualifiedThread;
  onBack(): void;
  scope: ChangeScope;
  showBack: boolean;
}

const SCOPES: Array<{ label: string; scope: ChangeScope }> = [
  { label: "Session", scope: "session" },
  { label: "Last turn", scope: "lastTurn" },
  { label: "Staged", scope: "staged" },
  { label: "Unstaged", scope: "unstaged" },
  { label: "Branch", scope: "branch" },
];
const WIDE_CHANGES_WIDTH = 720;

export function ChangesScreen(props: ChangesScreenProps): React.JSX.Element {
  const { owner } = props;
  const [scope, setScope] = useState<ChangeScope>("session");
  const selectScope = useEvent((next: ChangeScope) => setScope(next));
  const close = useEvent(() => router.back());
  return (
    <V2QueryBoundary
      key={scope}
      chrome="none"
      query={{
        cursor: null,
        kind: "thread.resources",
        limit: 100,
        scope,
        threadId: owner.threadId,
      }}
      savedServerId={owner.savedServerId}
      title="Changes"
    >
      {(result, refresh, availability) => {
        return (
          <ChangesWorkspace
            availableScopes={result.availableScopes}
            changes={result.changes}
            onClose={close}
            onRefresh={refresh}
            onSelectScope={selectScope}
            owner={owner}
            reviewAvailable={
              availability.actionable &&
              result.review.targetKinds.length > 0 &&
              result.review.deliveries.length > 0
            }
            scope={result.scope}
          />
        );
      }}
    </V2QueryBoundary>
  );
}

function ChangesWorkspace(props: ChangesWorkspaceProps): React.JSX.Element {
  const {
    availableScopes,
    changes,
    onClose,
    onRefresh,
    onSelectScope,
    owner,
    reviewAvailable,
    scope,
  } = props;
  const { width } = useWindowDimensions();
  const [selectedPath, setSelectedPath] = useState<string | null>(() =>
    width >= WIDE_CHANGES_WIDTH ? (changes[0]?.path ?? null) : null,
  );
  const [refreshing, startRefresh] = useTransition();
  const wide = width >= WIDE_CHANGES_WIDTH;
  const effectivePath = selectedPath ?? (wide ? (changes[0]?.path ?? null) : null);
  const selected = changes.find((change) => change.path === effectivePath) ?? null;
  const refresh = useEvent(() => startRefresh(() => onRefresh()));
  const select = useEvent((change: Change) => setSelectedPath(change.path));
  const backToFiles = useEvent(() => setSelectedPath(null));
  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable accessibilityLabel="Close changes" onPress={onClose} style={styles.iconButton}>
          <Ionicons color={colors.text} name="close" size={23} />
        </Pressable>
        <View style={styles.headerTitleBlock}>
          {refreshing ? (
            <ShimmerText style={styles.title} text={`Changes · ${changes.length}`} />
          ) : (
            <Text numberOfLines={1} style={styles.title}>
              Changes · {changes.length}
            </Text>
          )}
          <Text numberOfLines={1} style={styles.subtitle}>
            {scopeLabel(scope)}
          </Text>
        </View>
        {reviewAvailable && changes.length > 0 ? (
          <ChangesReviewLaunchButton owner={owner} scope={scope} />
        ) : null}
        <Pressable
          accessibilityLabel="Refresh changes"
          disabled={refreshing}
          onPress={refresh}
          style={styles.iconButton}
        >
          <Ionicons color={colors.textMuted} name="refresh" size={20} />
        </Pressable>
      </View>
      <View style={styles.workspace}>
        {wide || selected === null ? (
          <View style={[styles.sidebar, wide && styles.sidebarWide]}>
            <ScopePicker
              availableScopes={availableScopes}
              onSelect={onSelectScope}
              selected={scope}
            />
            <ScrollView contentContainerStyle={styles.fileList}>
              {changes.map((change) => (
                <ChangeRow
                  key={change.path}
                  change={change}
                  onSelect={select}
                  selected={change.path === effectivePath}
                />
              ))}
              {changes.length === 0 ? (
                <View style={styles.empty}>
                  <Ionicons color={colors.textDim} name="git-compare-outline" size={28} />
                  <Text style={styles.notice}>No file changes in this scope.</Text>
                </View>
              ) : null}
            </ScrollView>
          </View>
        ) : null}
        {selected === null ? null : (
          <ChangePreview
            key={selected.path}
            change={selected}
            onBack={backToFiles}
            owner={owner}
            scope={scope}
            showBack={!wide}
          />
        )}
      </View>
    </View>
  );
}

interface ScopePickerProps {
  availableScopes: ChangeScope[];
  onSelect(scope: ChangeScope): void;
  selected: ChangeScope;
}

function ScopePicker(props: ScopePickerProps): React.JSX.Element {
  const { availableScopes, onSelect, selected } = props;
  const available = new Set(availableScopes);
  return (
    <ScrollView
      contentContainerStyle={styles.scopes}
      horizontal
      showsHorizontalScrollIndicator={false}
    >
      {SCOPES.filter((entry) => available.has(entry.scope)).map((entry) => (
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
  const { change, onSelect, selected } = props;
  const select = useEvent(() => onSelect(change));
  return (
    <Pressable
      accessibilityLabel={`Open change ${change.path}`}
      onPress={select}
      style={[styles.row, selected && styles.rowSelected]}
    >
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
    </Pressable>
  );
}

function ChangePreview(props: ChangePreviewProps): React.JSX.Element {
  const { change, onBack, owner, scope, showBack } = props;
  const openFullDiff = useEvent(() =>
    router.push(threadChangeOutputDestination(owner, change.path, scope)),
  );
  return (
    <View style={styles.preview}>
      <View style={styles.previewHeader}>
        {showBack ? (
          <Pressable
            accessibilityLabel="Back to changed files"
            onPress={onBack}
            style={styles.iconButton}
          >
            <Ionicons color={colors.text} name="arrow-back" size={20} />
          </Pressable>
        ) : null}
        <View style={styles.previewTitleBlock}>
          <Text ellipsizeMode="middle" numberOfLines={1} style={styles.previewTitle}>
            {change.path}
          </Text>
          <Text style={styles.previewSubtitle}>Diff · {change.change}</Text>
        </View>
      </View>
      <V2QueryBoundary
        key={`${scope}:${change.path}`}
        chrome="none"
        query={{ kind: "thread.change", path: change.path, scope, threadId: owner.threadId }}
        savedServerId={owner.savedServerId}
        title="change"
      >
        {(result) => <ChangeDiffView onOpenFullDiff={openFullDiff} result={result} />}
      </V2QueryBoundary>
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

function scopeLabel(scope: ChangeScope): string {
  return SCOPES.find((entry) => entry.scope === scope)?.label ?? "Session";
}

const styles = StyleSheet.create({
  additions: { color: colors.green, ...typeScale.label, fontVariant: ["tabular-nums"] },
  deletions: { color: colors.red, ...typeScale.label, fontVariant: ["tabular-nums"] },
  empty: { alignItems: "center", gap: spacing.sm, justifyContent: "center", minHeight: 180 },
  fileList: { gap: spacing.optical, padding: spacing.sm, paddingBottom: spacing.xl },
  header: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderBottomColor: colors.borderSoft,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    minHeight: 56,
    paddingHorizontal: spacing.xs,
  },
  headerTitleBlock: { flex: 1, minWidth: 0 },
  iconButton: {
    alignItems: "center",
    height: touchTarget,
    justifyContent: "center",
    width: touchTarget,
  },
  notice: { color: colors.textMuted, ...typeScale.body },
  preview: { backgroundColor: colors.code, flex: 1, minWidth: 0 },
  previewHeader: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderBottomColor: colors.borderSoft,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    minHeight: 52,
    paddingHorizontal: spacing.sm,
  },
  previewSubtitle: { color: colors.textMuted, ...typeScale.caption, textTransform: "capitalize" },
  previewTitle: { color: colors.text, ...typeScale.body, fontWeight: typeWeight.medium },
  previewTitleBlock: { flex: 1, minWidth: 0 },
  resourceIcon: { alignItems: "center", justifyContent: "center", width: 32 },
  root: { backgroundColor: colors.background, flex: 1 },
  row: {
    alignItems: "center",
    borderRadius: radii.selected,
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: 56,
    paddingHorizontal: spacing.sm,
  },
  rowSelected: { backgroundColor: colors.surfaceHover },
  rowSubtitle: { color: colors.textMuted, ...typeScale.caption, textTransform: "capitalize" },
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: { color: colors.text, ...typeScale.body, fontWeight: typeWeight.medium },
  scope: {
    borderRadius: radii.large,
    justifyContent: "center",
    minHeight: 34,
    paddingHorizontal: spacing.sm,
  },
  scopeSelected: { backgroundColor: colors.surfaceHover },
  scopeText: { color: colors.textMuted, ...typeScale.label },
  scopeTextSelected: { color: colors.text, fontWeight: typeWeight.semibold },
  scopes: {
    gap: spacing.xs,
    paddingBottom: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.xs,
  },
  sidebar: { backgroundColor: colors.surface, flex: 1, minWidth: 0 },
  sidebarWide: {
    borderRightColor: colors.borderSoft,
    borderRightWidth: StyleSheet.hairlineWidth,
    flex: 0,
    width: 340,
  },
  subtitle: { color: colors.textMuted, ...typeScale.caption },
  title: { color: colors.text, ...typeScale.title },
  workspace: { flex: 1, flexDirection: "row", minHeight: 0 },
});
