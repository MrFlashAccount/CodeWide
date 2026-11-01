import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import type { ActionDescriptor } from "../../../data/forgeActionCatalog";
import type { CheckItem } from "../../../data/forgePullRequestContract";
import { colors, controlSize, iconSize, spacing, typeScale } from "../../../theme";
import { AppText as Text } from "../../../ui/Typography";
import type { ActionSlots } from "../actions/actionSlotting";
import { StatusRow } from "../sections/StatusRow";
import { CHECK_STATE_GLYPHS } from "./checkPresentation";
import { ChecksSheet } from "./ChecksSheet";
import { checkOutcome, type MergeBoxRow } from "./mergeBox";

/** The check states that need a look; passed and skipped checks stay in the sheet. */
const ATTENTION: ReadonlySet<CheckItem["state"]> = new Set(["cancelled", "failed", "pending"]);

/**
 * The Status section's Checks row: `2 failing, 7 successful`; expanded, the
 * failing, cancelled and pending checks with their outcome, and "All checks",
 * which opens the sheet with every check, its anchored actions (Fix in agent)
 * and its details page. Owns the expansion and the sheet's visibility.
 */
export function ChecksStatusRow({
  checks,
  divided,
  host,
  items,
  onRun,
  pending,
  slots,
}: {
  readonly checks: MergeBoxRow;
  readonly divided: boolean;
  readonly host: string;
  readonly items: readonly CheckItem[];
  readonly onRun: (action: ActionDescriptor) => void;
  readonly pending: Readonly<Record<string, true>>;
  readonly slots: Pick<ActionSlots, "anchored">;
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const [sheet, setSheet] = useState(false);
  const list =
    items.length === 0 ? undefined : (
      <ChecksList
        items={items}
        onOpenSheet={() => {
          setSheet(true);
        }}
      />
    );
  const sheetView = sheet ? (
    <ChecksSheet
      actionsFor={(checkId) => slots.anchored.checks.get(checkId) ?? []}
      checks={items}
      host={host}
      onDismiss={() => {
        setSheet(false);
      }}
      onRun={onRun}
      pending={pending}
      summary={checks.detail}
    />
  ) : null;
  return (
    <>
      <StatusRow
        detail={checks.detail}
        detailTone="muted"
        disclosure={
          items.length === 0
            ? { kind: "fixed" }
            : {
                expanded,
                kind: "expandable",
                onToggle: () => {
                  setExpanded(!expanded);
                },
              }
        }
        divided={divided}
        testID="pull-request-status-checks"
        title="Checks"
        tone={checks.tone}
      >
        {list}
      </StatusRow>
      {sheetView}
    </>
  );
}

/** The checks that need a look, then the entry into the sheet with every check. */
function ChecksList({
  items,
  onOpenSheet,
}: {
  readonly items: readonly CheckItem[];
  readonly onOpenSheet: () => void;
}): React.JSX.Element {
  return (
    <View>
      {items.map((check) =>
        ATTENTION.has(check.state) ? <CheckLine check={check} key={check.checkId} /> : null,
      )}
      <AllChecksLink count={items.length} onPress={onOpenSheet} />
    </View>
  );
}

function AllChecksLink({
  count,
  onPress,
}: {
  readonly count: number;
  readonly onPress: () => void;
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityHint="Shows every check"
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.line, pressed && styles.pressed]}
      testID="pull-request-status-checks-all"
    >
      <Text style={styles.all}>{`All checks (${String(count)})`}</Text>
      <Ionicons color={colors.textMuted} name="chevron-forward" size={iconSize.inline} />
    </Pressable>
  );
}

function CheckLine({ check }: { readonly check: CheckItem }): React.JSX.Element {
  const glyph = CHECK_STATE_GLYPHS[check.state];
  const outcome = checkOutcome(check);
  return (
    <View
      accessibilityLabel={`${check.name}, ${outcome}`}
      accessible
      style={styles.line}
      testID={`pull-request-status-check-${check.checkId}`}
    >
      <Ionicons color={glyph.color} name={glyph.icon} size={iconSize.inline} />
      <Text numberOfLines={1} style={styles.name}>
        {check.name}
      </Text>
      <Text numberOfLines={1} style={styles.outcome}>
        {outcome}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  all: {
    ...typeScale.body,
    color: colors.textMuted,
    flex: 1,
  },
  line: {
    alignItems: "center",
    columnGap: spacing.sm,
    flexDirection: "row",
    minHeight: controlSize.regular,
  },
  name: {
    ...typeScale.body,
    color: colors.text,
    flex: 1,
    minWidth: 0,
  },
  outcome: {
    ...typeScale.label,
    color: colors.textDim,
    flexShrink: 0,
  },
  pressed: {
    backgroundColor: colors.surfaceContainer,
  },
});
