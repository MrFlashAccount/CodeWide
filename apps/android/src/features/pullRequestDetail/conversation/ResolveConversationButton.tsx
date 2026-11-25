import { useState } from "react";
import { StyleSheet, View } from "react-native";

import { useEvent } from "../../../react/useEvent";
import { colors, typeScale } from "../../../theme";
import { AppText as Text } from "../../../ui/Typography";
import { PillButton } from "../sections/PillButton";
import type { ThreadResolveOutcome } from "./useConversationWrites";

/** Where one resolve or unresolve tap stands; the thread's resolution itself is the query's. */
type ResolveState =
  | { readonly message: string; readonly status: "failed" }
  | { readonly status: "idle" }
  | { readonly status: "pending" };

const IDLE: ResolveState = { status: "idle" };

/**
 * "Resolve conversation" or "Unresolve conversation" for one review thread.
 * A pending write keeps its label and shimmers in place; a failure stops the
 * shimmer and shows the forge's reason below, while the conversation query
 * reconciles the authoritative state.
 */
export function ResolveConversationButton({
  onResolve,
  onSettled,
  resolved,
  testID,
}: {
  readonly onResolve: (resolved: boolean) => Promise<ThreadResolveOutcome>;
  /** Called once the forge accepted the new state. */
  readonly onSettled: (resolved: boolean) => void;
  readonly resolved: boolean;
  readonly testID: string;
}): React.JSX.Element {
  const [state, setState] = useState<ResolveState>(IDLE);
  const press = useEvent((): void => {
    if (state.status === "pending") {
      return;
    }
    setState({ status: "pending" });
    onResolve(!resolved)
      .then((outcome) => {
        if (outcome.status === "failed") {
          setState({ message: outcome.message, status: "failed" });
          return;
        }
        setState(IDLE);
        if (outcome.status === "settled") {
          onSettled(outcome.resolved);
        }
      })
      .catch(() => {
        setState({ message: "The conversation could not be updated", status: "failed" });
      });
  });
  return (
    <View style={styles.column}>
      <PillButton
        icon={resolved ? "arrow-undo-outline" : "checkmark-circle-outline"}
        label={resolved ? "Unresolve conversation" : "Resolve conversation"}
        onPress={press}
        pending={state.status === "pending"}
        testID={testID}
        variant="outlined"
      />
      {state.status === "failed" ? (
        <Text accessibilityRole="alert" style={styles.error} testID={`${testID}-error`}>
          {state.message}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  column: {
    alignItems: "flex-start",
  },
  error: {
    ...typeScale.label,
    color: colors.error,
  },
});
