import { View } from "react-native";

import type { ForgeAccountsSnapshot } from "../../../data/forgeContract";
import type { RemoteValue } from "../../../data/forgeRemoteValue";
import { AppButton } from "../../../presentation/controls/AppButton";
import { ProductText } from "../../../presentation/text/ProductText";
import { ListSkeleton } from "../list/ListSkeleton";
import { CompanionUpdateCard } from "./CompanionUpdateCard";
import { onboardingStyles as styles } from "./onboarding.styles";

/**
 * What the tab shows before any accounts snapshot exists: the update card for
 * a companion without forge methods, the companion's reason with Retry after a
 * failure, otherwise the local skeleton.
 */
export function AccountsPlaceholder({
  onRetry,
  state,
}: {
  readonly onRetry: () => void;
  readonly state: RemoteValue<ForgeAccountsSnapshot> | undefined;
}): React.JSX.Element {
  if (state?.status !== "failed") {
    return <ListSkeleton />;
  }
  if (state.failure.kind === "companionTooOld") {
    return <CompanionUpdateCard />;
  }
  return (
    <View style={[styles.list, styles.fill]} testID="forge-accounts-failed">
      <ProductText style={styles.body}>{state.failure.message}</ProductText>
      <AppButton onPress={onRetry} size="sm" variant="secondary">
        Retry
      </AppButton>
    </View>
  );
}
