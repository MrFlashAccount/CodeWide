import { Pressable, View } from "react-native";
import { AppText as Text } from "../../ui/Typography";
import { styles } from "./BrowserPageFeedback.styles";

/** Page recovery is separate from HTTP response content and unobtrusive action notices. */
export type BrowserPageStatus =
  | { readonly kind: "ready" }
  | { readonly kind: "failed"; readonly message: string; readonly recovery: "reload" | "recreate" }
  | { readonly kind: "http"; readonly statusCode: number }
  | { readonly kind: "notice"; readonly message: string };

/** Keeps failure/retry inside the page viewport, never in an extra loading or error panel. */
export function BrowserPageFeedback(props: {
  readonly onBack: () => void;
  readonly onRetry: () => void;
  readonly status: BrowserPageStatus;
}): React.JSX.Element | null {
  const { status } = props;
  if (status.kind === "ready") {
    return null;
  }
  const message = status.kind === "http" ? `HTTP ${String(status.statusCode)}` : status.message;
  return (
    <View
      style={status.kind === "failed" ? styles.failure : styles.notice}
      testID="browser-page-feedback"
    >
      <Text accessibilityRole="alert" style={styles.message}>
        {message}
      </Text>
      {status.kind !== "notice" && (
        <Pressable accessibilityRole="button" onPress={props.onRetry} style={styles.action}>
          <Text style={styles.actionText}>Retry</Text>
        </Pressable>
      )}
      {status.kind === "failed" && (
        <Pressable accessibilityRole="button" onPress={props.onBack} style={styles.action}>
          <Text style={styles.actionText}>Back</Text>
        </Pressable>
      )}
    </View>
  );
}
