import { Ionicons } from "@expo/vector-icons";
import { Linking, Pressable, StyleSheet, useWindowDimensions, View } from "react-native";

import type { ActionDescriptor } from "../../../data/forgeActionCatalog";
import type { CheckItem } from "../../../data/forgePullRequestContract";
import { safeProviderUrl } from "../../../data/forgeProviderUrl";
import {
  colors,
  controlHitSlop,
  controlSize,
  iconSize,
  spacing,
  typeScale,
  typeWeight,
} from "../../../theme";
import { AppSheet, AppSheetScrollView } from "../../../ui/AppSheet";
import { AppText as Text } from "../../../ui/Typography";
import { CatalogActionButton } from "../actions/CatalogActionButton";
import { CHECK_STATE_GLYPHS } from "./checkPresentation";
import { checkOutcome } from "./mergeBox";

/** The sheet grows with its checks up to this share of the window, then scrolls. */
const SHEET_MAX_HEIGHT_RATIO = 0.7;

/**
 * Every check of the PR with its outcome, its anchored actions (Fix in agent)
 * and its forge details page. Running an action closes the sheet first, so a
 * confirmation or the linked chat never opens beneath it.
 */
export function ChecksSheet({
  actionsFor,
  checks,
  host,
  onDismiss,
  onRun,
  pending,
  summary,
}: {
  readonly actionsFor: (checkId: string) => readonly ActionDescriptor[];
  readonly checks: readonly CheckItem[];
  readonly host: string;
  readonly onDismiss: () => void;
  readonly onRun: (action: ActionDescriptor) => void;
  readonly pending: Readonly<Record<string, true>>;
  readonly summary: string;
}): React.JSX.Element {
  const window = useWindowDimensions();
  return (
    <AppSheet
      contentProps={{ dismissLabel: "Close checks" }}
      isOpen
      onOpenChange={(open) => {
        if (!open) {
          onDismiss();
        }
      }}
    >
      <View style={styles.header}>
        <Text accessibilityRole="header" style={styles.title}>
          Checks
        </Text>
        <Text numberOfLines={1} style={styles.summary}>
          {summary}
        </Text>
      </View>
      <AppSheetScrollView
        style={{ maxHeight: window.height * SHEET_MAX_HEIGHT_RATIO }}
        testID="pull-request-checks-sheet"
      >
        {checks.map((check) => (
          <CheckRow
            actions={actionsFor(check.checkId)}
            check={check}
            detailsUrl={check.detailsUrl === null ? null : safeProviderUrl(check.detailsUrl, host)}
            key={check.checkId}
            onRun={(action) => {
              onDismiss();
              onRun(action);
            }}
            pending={pending}
          />
        ))}
      </AppSheetScrollView>
    </AppSheet>
  );
}

function CheckRow({
  actions,
  check,
  detailsUrl,
  onRun,
  pending,
}: {
  readonly actions: readonly ActionDescriptor[];
  readonly check: CheckItem;
  readonly detailsUrl: string | null;
  readonly onRun: (action: ActionDescriptor) => void;
  readonly pending: Readonly<Record<string, true>>;
}): React.JSX.Element {
  const glyph = CHECK_STATE_GLYPHS[check.state];
  const outcome = checkOutcome(check);
  return (
    <View style={styles.row}>
      <Ionicons color={glyph.color} name={glyph.icon} size={iconSize.action} />
      <View accessibilityLabel={`${check.name}, ${outcome}`} accessible style={styles.body}>
        <Text numberOfLines={1} style={styles.name}>
          {check.name}
        </Text>
        <Text numberOfLines={1} style={styles.outcome}>
          {outcome}
        </Text>
      </View>
      {actions.map((action) => (
        <CatalogActionButton
          action={action}
          key={action.actionId}
          onPress={onRun}
          pending={pending[action.actionId] === true}
          variant="raised"
        />
      ))}
      {detailsUrl === null ? null : <DetailsLink name={check.name} url={detailsUrl} />}
    </View>
  );
}

function DetailsLink({ name, url }: { readonly name: string; readonly url: string }) {
  return (
    <Pressable
      accessibilityLabel={`Open ${name} details`}
      accessibilityRole="link"
      hitSlop={controlHitSlop.compact}
      onPress={() => {
        // Without a browser the check stays readable here.
        Linking.openURL(url).catch(() => undefined);
      }}
      style={styles.link}
    >
      <Ionicons color={colors.textMuted} name="open-outline" size={iconSize.inline} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    minWidth: 0,
  },
  header: {
    alignItems: "center",
    columnGap: spacing.xs,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: controlSize.touch,
  },
  link: {
    alignItems: "center",
    height: controlSize.compact,
    justifyContent: "center",
    width: controlSize.compact,
  },
  name: {
    ...typeScale.body,
    color: colors.text,
    fontWeight: typeWeight.medium,
  },
  outcome: {
    ...typeScale.label,
    color: colors.textMuted,
  },
  row: {
    alignItems: "center",
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    columnGap: spacing.sm,
    flexDirection: "row",
    minHeight: controlSize.touch + spacing.xs,
    paddingVertical: spacing.xs,
  },
  summary: {
    ...typeScale.label,
    color: colors.textMuted,
    flexShrink: 1,
  },
  title: {
    ...typeScale.title,
    color: colors.text,
  },
});
