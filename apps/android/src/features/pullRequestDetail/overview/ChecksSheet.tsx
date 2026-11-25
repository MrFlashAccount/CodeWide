import { Ionicons } from "@expo/vector-icons";
import { observable } from "@legendapp/state";
import { useSelector } from "@legendapp/state/react";
import { Pressable, StyleSheet, useWindowDimensions, View } from "react-native";

import type { ActionDescriptor } from "../../../data/forgeActionCatalog";
import type { CheckItem } from "../../../data/forgePullRequestContract";
import { searchFieldLayout } from "../../../presentation/input/searchLayout";
import { useConstant } from "../../../react/useConstant";
import { useEvent } from "../../../react/useEvent";
import { colors, controlSize, iconSize, spacing, typeScale } from "../../../theme";
import { AppList } from "../../../ui/AppList";
import { AppSheet, AppSheetScrollView } from "../../../ui/AppSheet";
import { InlineIcon } from "../../../ui/InlineIcon";
import { AppText as Text, AppTextInput } from "../../../ui/Typography";
import { AddressChecksButton } from "./AddressChecksButton";
import { TriggerDiscoveryNotice } from "./ManualTriggerControls";
import { ChecksSheetHeader } from "./ChecksSheetHeader";
import { CheckJobRow } from "./CheckJobRow";
import { checksSheetRows } from "./checksSheetRows";

const SHEET_HEIGHT_SHARE = 0.72;
const SECTION_TITLES = {
  other: "Other checks",
  required: "Required",
  unspecified: "Requirement unknown",
} as const;

type Props = {
  readonly actionsFor: (checkId: string) => readonly ActionDescriptor[];
  readonly addressAction: ActionDescriptor | null;
  readonly checks: readonly CheckItem[];
  readonly host: string;
  readonly onDismiss: () => void;
  readonly onRun: (action: ActionDescriptor) => void;
  readonly pending: Readonly<Record<string, true>>;
  readonly pendingToggles: Readonly<Record<string, boolean>>;
};

/** Search and requirement disclosure affect the list only; the footer always addresses the entire PR. */
export function ChecksSheet(props: Props): React.JSX.Element {
  const { addressAction, checks, host, onDismiss, onRun, pending, pendingToggles } = props;
  const { height } = useWindowDimensions();
  const state = useConstant(() => observable({ expanded: false, query: "", searchExpanded: true }));
  const query = useSelector(state.query);
  const searching = query.trim().length > 0;
  const expanded = useSelector(() =>
    searching ? state.searchExpanded.get() : state.expanded.get(),
  );
  const change = useEvent((next: string) => {
    state.searchExpanded.set(true);
    state.query.set(next);
  });
  const toggle = useEvent(() => {
    (searching ? state.searchExpanded : state.expanded).toggle();
  });
  const close = useEvent((open: boolean) => {
    if (!open) {
      onDismiss();
    }
  });
  const address = useEvent((action: ActionDescriptor) => {
    onDismiss();
    onRun(action);
  });
  const rows = checksSheetRows(checks, query, expanded);
  const renderItem = ({ item }: { readonly item: (typeof rows)[number] }) => {
    if (item.kind === "job") {
      return (
        <CheckJobRow
          actions={props.actionsFor(item.check.checkId)}
          check={item.check}
          host={host}
          onRun={onRun}
          pending={pending}
          pendingToggles={pendingToggles}
        />
      );
    }
    const label = `${SECTION_TITLES[item.kind]} · ${String(item.count)}`;
    if (item.kind === "other") {
      return (
        <Pressable
          accessibilityLabel={label}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          onPress={toggle}
          style={styles.section}
          testID="pull-request-checks-other"
        >
          <Text style={styles.group}>{label}</Text>
          <Ionicons
            color={colors.textMuted}
            name={expanded ? "chevron-up" : "chevron-down"}
            size={iconSize.inline}
          />
        </Pressable>
      );
    }
    return (
      <View style={styles.section}>
        <Text accessibilityRole="header" style={styles.group}>
          {label}
        </Text>
      </View>
    );
  };
  return (
    <AppSheet
      contentProps={{
        dismissLabel: "Close checks",
        style: { height: height * SHEET_HEIGHT_SHARE },
      }}
      isOpen
      onOpenChange={close}
    >
      <ChecksSheetHeader title="Checks" />
      <View style={styles.search}>
        <InlineIcon color={colors.textMuted} name="search-outline" />
        <AppTextInput
          accessibilityLabel="Search checks"
          autoCapitalize="none"
          autoCorrect={false}
          compact
          onChangeText={change}
          placeholder="Search checks"
          placeholderTextColor={colors.textDim}
          returnKeyType="search"
          style={styles.input}
          testID="pull-request-checks-search"
          value={query}
          voiceInput={false}
        />
      </View>
      <TriggerDiscoveryNotice />
      <AppList
        data={rows}
        empty={<Text style={styles.empty}>No matching checks</Text>}
        extraData={{ actionsFor: props.actionsFor, expanded, host, pending, pendingToggles }}
        keyboardShouldPersistTaps="handled"
        keyExtractor={(row) => (row.kind === "job" ? `job:${row.check.checkId}` : row.kind)}
        nestedScrollEnabled
        renderItem={renderItem}
        scrollComponent={AppSheetScrollView}
        testID="pull-request-checks-sheet"
        virtualized
      />
      {addressAction === null ? null : (
        <View style={styles.footer}>
          <AddressChecksButton
            accessibilityLabel="Address all checks"
            action={addressAction}
            onPress={address}
            pending={pending[addressAction.actionId] === true}
          />
        </View>
      )}
    </AppSheet>
  );
}

const styles = StyleSheet.create({
  empty: {
    ...typeScale.body,
    color: colors.textMuted,
    paddingVertical: spacing.md,
    textAlign: "center",
  },
  footer: {
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: spacing.xs,
  },
  group: {
    ...typeScale.label,
    color: colors.textMuted,
    flex: 1,
  },
  input: {
    color: colors.text,
    flex: 1,
    fontSize: typeScale.body.fontSize,
    height: controlSize.regular,
    includeFontPadding: false,
    minWidth: 0,
    padding: 0,
    textAlignVertical: "center",
  },
  search: {
    ...searchFieldLayout,
    backgroundColor: colors.surfaceContainerHigh,
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  section: {
    alignItems: "center",
    columnGap: spacing.xs,
    flexDirection: "row",
    minHeight: controlSize.regular,
  },
});
