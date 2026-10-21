import { View } from "react-native";

import type { AuthFlow } from "../../../data/forgeContract";
import { AppButton } from "../../../presentation/controls/AppButton";
import { ProductText } from "../../../presentation/text/ProductText";
import { onboardingStyles as styles } from "./onboarding.styles";

/**
 * A host login that failed after its code was shown. The companion's reason
 * stays visible; Try again is offered only when the companion says a retry can
 * work, otherwise the user follows the host steps. Dismiss clears the flow.
 */
export function FailedFlowPanel({
  busy,
  flow,
  onDismiss,
  onRetry,
}: {
  readonly busy: boolean;
  readonly flow: Extract<AuthFlow, { readonly state: "failed" }>;
  readonly onDismiss: () => void;
  readonly onRetry: () => void;
}): React.JSX.Element {
  return (
    <View accessibilityRole="alert" style={styles.section} testID="forge-host-login-failed">
      <ProductText style={styles.error}>{`✕ Sign-in on ${flow.host} did not finish`}</ProductText>
      <ProductText selectable style={styles.body}>
        {flow.retryable
          ? flow.reason
          : `${flow.reason} Run gh auth login on the companion host, then tap Check again.`}
      </ProductText>
      <View style={styles.actions}>
        {flow.retryable ? (
          <AppButton isDisabled={busy} onPress={onRetry} variant="primary">
            Try again
          </AppButton>
        ) : null}
        <AppButton isDisabled={busy} onPress={onDismiss} variant="ghost">
          Dismiss
        </AppButton>
      </View>
    </View>
  );
}
