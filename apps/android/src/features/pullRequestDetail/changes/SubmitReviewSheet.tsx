import { useRef, useState } from "react";
import { View, type Text as NativeText } from "react-native";

import type { ActionDescriptor } from "../../../data/forgeActionCatalog";
import { AppButton } from "../../../presentation/controls/AppButton";
import { PresentationTextInput } from "../../../presentation/text/ProductText";
import { useEvent } from "../../../react/useEvent";
import { colors } from "../../../theme";
import { AppSheet } from "../../../ui/AppSheet";
import { TextShimmer } from "../../../ui/TextShimmer";
import { AppText as Text } from "../../../ui/Typography";
import type { DockCounts } from "./dockCounts";
import { submitSheetStyles as styles } from "./SubmitReviewSheet.styles";
import { SubmitSummaryLines } from "./SubmitSummaryLines";
import { VerdictRow } from "./VerdictRow";

/** Props of the Submit review sheet. */
export type SubmitReviewSheetProps = {
  readonly bothTargetTitle: string | null;
  readonly counts: DockCounts;
  readonly host: string;
  readonly onDismiss: () => void;
  readonly onSelectVerdict: (actionId: string) => void;
  readonly onSubmit: (body: string | null, forwardBothToAgent: boolean) => Promise<void>;
  readonly verdict: ActionDescriptor;
  readonly verdicts: readonly ActionDescriptor[];
};

/**
 * Submit review: the only control that publishes review comments and the
 * verdict. It lists what goes to the forge, the "Also send Both comments to
 * agent" switch (on by default) and the agent-only drafts that stay. The sheet
 * is the verdict's confirmation; a destructive verdict has a red label and a
 * consequence line. Busy disables every dismissal.
 */
export function SubmitReviewSheet(props: SubmitReviewSheetProps): React.JSX.Element {
  const { verdict } = props;
  const [body, setBody] = useState("");
  const [forward, setForward] = useState(true);
  const [busy, setBusy] = useState(false);
  const submit = useEvent((): void => {
    setBusy(true);
    const summary = body.trim();
    props
      .onSubmit(summary.length === 0 ? null : summary, forward && props.counts.bothPending > 0)
      .then(props.onDismiss)
      .catch(() => undefined)
      .finally(() => {
        setBusy(false);
      });
  });
  return (
    <AppSheet
      contentProps={{ dismissLabel: "Close submit review", enablePanDownToClose: !busy }}
      isOpen
      onOpenChange={(open) => {
        if (!open && !busy) {
          props.onDismiss();
        }
      }}
    >
      <View style={styles.content} testID="submit-review-sheet">
        <Text accessibilityRole="header" style={styles.title}>
          Submit review
        </Text>
        <VerdictRow
          busy={busy}
          host={props.host}
          onSelect={props.onSelectVerdict}
          verdict={verdict}
          verdicts={props.verdicts}
        />
        <PresentationTextInput
          accessibilityLabel="Summary comment"
          editable={!busy}
          multiline
          onChangeText={setBody}
          placeholder="Summary comment (optional)"
          placeholderTextColor={colors.textDim}
          style={styles.input}
          value={body}
        />
        <SubmitSummaryLines
          bothTargetTitle={props.bothTargetTitle}
          busy={busy}
          counts={props.counts}
          forward={forward}
          host={props.host}
          onForwardChange={setForward}
        />
        <SubmitButton busy={busy} onSubmit={submit} verdict={verdict} />
      </View>
    </AppSheet>
  );
}

/**
 * The final Submit: the sheet's one filled neutral primary (N-03). A
 * destructive verdict drops the fill and keeps a red label, never a red fill.
 * While publishing, the label shimmers in place.
 */
function SubmitButton({
  busy,
  onSubmit,
  verdict,
}: {
  readonly busy: boolean;
  readonly onSubmit: () => void;
  readonly verdict: ActionDescriptor;
}): React.JSX.Element {
  const label = `Submit review · ${verdict.label}`;
  const disabled = busy || verdict.availability.state === "disabled";
  if (verdict.confirm === "destructive") {
    return (
      <AppButton
        isDisabled={disabled}
        onPress={onSubmit}
        testID="submit-review-confirm"
        variant="outline"
      >
        <DangerLabel label={label} pending={busy} />
      </AppButton>
    );
  }
  return (
    <AppButton
      isDisabled={disabled}
      onPress={onSubmit}
      pending={busy}
      testID="submit-review-confirm"
      variant="primary"
    >
      {label}
    </AppButton>
  );
}

/** Red label of a destructive Submit; it shimmers in place while publishing. */
function DangerLabel({
  label,
  pending,
}: {
  readonly label: string;
  readonly pending: boolean;
}): React.JSX.Element {
  const text = useRef<NativeText>(null);
  return (
    <>
      <Text ref={text} style={[styles.submitLabel, styles.dangerLabel]}>
        {label}
      </Text>
      <TextShimmer shimmering={pending} target={text} />
    </>
  );
}
