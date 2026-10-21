import { useLayoutEffect, useRef, useState } from "react";
import { View, type TextInput } from "react-native";

import type { DraftDestination } from "../../../data/reviewDraftContract";
import { AppButton } from "../../../presentation/controls/AppButton";
import { useEvent } from "../../../react/useEvent";
import { colors } from "../../../theme";
import { AppSheet } from "../../../ui/AppSheet";
import { AppText as Text, AppTextInput } from "../../../ui/Typography";
import { commentSheetStyles as styles } from "./CommentSheet.styles";
import { DestinationSegments } from "./DestinationSegments";
import { destinationExplanation } from "./destinationPolicy";

/** What the sheet comments on. */
export type CommentSheetTarget = {
  readonly line: number;
  readonly path: string;
  readonly side: "new" | "old";
};

/** Props of the line comment sheet. */
export type CommentSheetProps = {
  /** Thread the agent half goes to, or `null` when no thread can receive it. */
  readonly agentThreadTitle: string | null;
  readonly destinations: readonly DraftDestination[];
  readonly host: string | null;
  readonly initialDestination: DraftDestination;
  readonly onDismiss: () => void;
  readonly onSubmit: (body: string, destination: DraftDestination) => Promise<void>;
  readonly ownPullRequest: boolean;
  readonly target: CommentSheetTarget;
};

/**
 * Line comment sheet: focus lands in the text field, "Send to" explains the
 * selected destination, and Agent | PR | Both choose it. PR and Both are
 * offered only for pull-request sources; Agent needs a target thread. Adding a
 * draft writes nothing to a forge: PR drafts leave only through Submit review.
 */
export function CommentSheet(props: CommentSheetProps): React.JSX.Element {
  const input = useRef<TextInput>(null);
  const [body, setBody] = useState("");
  const [destination, setDestination] = useState(props.initialDestination);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  // Focus is an imperative handle of the mounted field: the sheet opens to type.
  useLayoutEffect(() => {
    input.current?.focus();
  }, []);
  const submit = useEvent((): void => {
    const text = body.trim();
    if (text.length === 0 || busy) {
      return;
    }
    setBusy(true);
    setFailure(null);
    props
      .onSubmit(text, destination)
      .then(props.onDismiss, (error: unknown) => {
        setFailure(error instanceof Error ? error.message : "The draft was not saved");
      })
      .finally(() => {
        setBusy(false);
      });
  });
  return (
    <AppSheet
      contentProps={{ dismissLabel: "Close comment", enablePanDownToClose: !busy }}
      isOpen
      onOpenChange={(open) => {
        if (!open && !busy) {
          props.onDismiss();
        }
      }}
    >
      <View style={styles.content} testID="review-comment-sheet">
        <Text
          accessibilityRole="header"
          style={styles.title}
        >{`Comment on line ${String(props.target.line)}`}</Text>
        <Text ellipsizeMode="middle" numberOfLines={1} style={styles.path}>
          {`${props.target.path} · ${props.target.side} side`}
        </Text>
        <AppTextInput
          accessibilityLabel="Comment"
          editable={!busy}
          multiline
          onChangeText={setBody}
          placeholder="Comment"
          placeholderTextColor={colors.textDim}
          ref={input}
          style={styles.input}
          value={body}
        />
        <Text style={styles.label}>Send to</Text>
        <Text style={styles.explanation}>
          {destinationExplanation(destination, {
            host: props.host,
            ownPullRequest: props.ownPullRequest,
            threadTitle: props.agentThreadTitle,
          })}
        </Text>
        <CommentFooter
          addDisabled={busy || body.trim().length === 0}
          agentAvailable={props.agentThreadTitle !== null}
          destination={destination}
          destinations={props.destinations}
          onAdd={submit}
          onDestination={setDestination}
        />
        {failure === null ? null : (
          <Text accessibilityLiveRegion="polite" style={styles.error}>
            {failure}
          </Text>
        )}
      </View>
    </AppSheet>
  );
}

/** Destination segments beside the Add draft button. */
function CommentFooter({
  addDisabled,
  agentAvailable,
  destination,
  destinations,
  onAdd,
  onDestination,
}: {
  readonly addDisabled: boolean;
  readonly agentAvailable: boolean;
  readonly destination: DraftDestination;
  readonly destinations: readonly DraftDestination[];
  readonly onAdd: () => void;
  readonly onDestination: (destination: DraftDestination) => void;
}): React.JSX.Element {
  return (
    <View style={styles.footer}>
      <DestinationSegments
        agentAvailable={agentAvailable}
        destinations={destinations}
        onSelect={onDestination}
        selected={destination}
      />
      <AppButton isDisabled={addDisabled} onPress={onAdd}>
        Add draft
      </AppButton>
    </View>
  );
}
