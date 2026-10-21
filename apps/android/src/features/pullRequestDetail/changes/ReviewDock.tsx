import { Linking, View } from "react-native";

import type { ActionDescriptor } from "../../../data/forgeActionCatalog";
import { safeProviderUrl } from "../../../data/forgeProviderUrl";
import { AppButton } from "../../../presentation/controls/AppButton";
import { AppText as Text } from "../../../ui/Typography";
import type { DockCounts } from "./dockCounts";
import { reviewDockStyles as styles } from "./ReviewDock.styles";
import { SubmitSplitButton } from "./SubmitSplitButton";
import { publishedDetail, publishedTitle } from "./submitResultCopy";

/** The outcome line ("2 published · 1 to agent · 1 left") may take two lines at 320–360dp. */
const SUMMARY_DETAIL_LINES = 2;

/** What the last Submit did, as the dock reports it. */
export type SubmitResult =
  | {
      readonly kind: "published";
      readonly left: number;
      readonly published: number;
      readonly reviewUrl: string | null;
      readonly toAgent: number;
      readonly verdict: string;
    }
  | { readonly kind: "failed"; readonly reason: string; readonly verdict: string };

/** Props of the review dock. */
export type ReviewDockProps = {
  readonly counts: DockCounts;
  readonly disabled: boolean;
  readonly host: string;
  readonly onOpenSubmit: () => void;
  readonly onSelectVerdict: (actionId: string) => void;
  readonly result: SubmitResult | null;
  readonly verdict: ActionDescriptor | null;
  readonly verdicts: readonly ActionDescriptor[];
};

/**
 * Changes dock: the draft summary and the single Submit review control with the
 * plugin's verdicts behind ▾ (default first). Verdicts never appear in the
 * action row. After Submit it reports the outcome instead of a toast.
 */
export function ReviewDock(props: ReviewDockProps): React.JSX.Element {
  const { result } = props;
  if (result?.kind === "published" && props.counts.toPr === 0) {
    return <PublishedDock host={props.host} result={result} />;
  }
  const summary = dockSummary(props.counts, result);
  return (
    <View style={styles.dock} testID="review-dock">
      <DockSummary detail={summary.detail} title={summary.title} />
      <SubmitSplitButton
        disabled={props.disabled}
        label={submitLabel(result, props.verdict)}
        onOpenSubmit={props.onOpenSubmit}
        onSelectVerdict={props.onSelectVerdict}
        verdict={props.verdict}
        verdicts={props.verdicts}
      />
    </View>
  );
}

function dockSummary(
  counts: DockCounts,
  result: SubmitResult | null,
): { readonly detail: string; readonly title: string } {
  if (result?.kind === "failed") {
    return { detail: `Verdict: ${result.verdict}`, title: `${String(counts.total)} drafts kept` };
  }
  return {
    detail: `${String(counts.toPr)} to PR · ${String(counts.agentOnly)} to agent`,
    title: draftCountLabel(counts.total),
  };
}

function submitLabel(result: SubmitResult | null, verdict: ActionDescriptor | null): string {
  if (result?.kind === "failed") {
    return "Retry submit";
  }
  return verdict === null ? "Submit" : `Submit · ${verdict.label}`;
}

function draftCountLabel(total: number): string {
  return `${String(total)} ${total === 1 ? "draft" : "drafts"}`;
}

function DockSummary({
  detail,
  title,
}: {
  readonly detail: string;
  readonly title: string;
}): React.JSX.Element {
  return (
    <View style={styles.summary}>
      <Text numberOfLines={1} style={styles.title}>
        {title}
      </Text>
      <Text numberOfLines={SUMMARY_DETAIL_LINES} style={styles.meta}>
        {detail}
      </Text>
    </View>
  );
}

function PublishedDock({
  host,
  result,
}: {
  readonly host: string;
  readonly result: Extract<SubmitResult, { readonly kind: "published" }>;
}): React.JSX.Element {
  const reviewUrl = result.reviewUrl === null ? null : safeProviderUrl(result.reviewUrl, host);
  return (
    <View style={styles.dock} testID="review-dock-outcome">
      <DockSummary detail={publishedDetail(result)} title={publishedTitle(result.verdict, host)} />
      {reviewUrl === null ? null : (
        <AppButton
          onPress={() => {
            // Without a browser the outcome stays readable in the dock.
            Linking.openURL(reviewUrl).catch(() => undefined);
          }}
          size="sm"
          variant="outline"
        >
          View on forge
        </AppButton>
      )}
    </View>
  );
}
