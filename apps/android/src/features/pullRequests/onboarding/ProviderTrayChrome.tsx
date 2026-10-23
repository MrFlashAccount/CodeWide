import { Ionicons } from "@expo/vector-icons";
import { View } from "react-native";

import { ProductText } from "../../../presentation/text/ProductText";
import { colors, iconSize } from "../../../theme";
import { Tray } from "../../../vendor/reacticx/tray";
import { onboardingStyles as styles } from "./onboarding.styles";
import {
  PROVIDER_ONBOARDING_STEP_COUNT,
  type ProviderOnboardingStep,
} from "./providerTrayNavigation";

/** Reacticx Tray header: Back belongs to the left title group; Close stays alone on the right. */
export function ProviderTrayHeader({
  back = false,
  step,
  title,
}: {
  readonly back?: boolean;
  readonly step: ProviderOnboardingStep;
  readonly title: string;
}): React.JSX.Element {
  return (
    <Tray.Header>
      <View
        style={styles.trayHeaderIdentity}
        testID={`provider-tray-header-left-step-${String(step)}`}
      >
        {back ? <ProviderTrayBack /> : null}
        <Tray.Title>{title}</Tray.Title>
        <ProductText style={styles.trayStep}>
          {`${String(step)} of ${String(PROVIDER_ONBOARDING_STEP_COUNT)}`}
        </ProductText>
      </View>
      <TrayClose />
    </Tray.Header>
  );
}

export function TrayTrust(): React.JSX.Element {
  return (
    <View style={styles.trayTrust}>
      <Ionicons color={colors.textMuted} name="shield-checkmark-outline" size={iconSize.inline} />
      <ProductText style={styles.providerCaption}>Credentials stay on your Companion.</ProductText>
    </View>
  );
}

function ProviderTrayBack(): React.JSX.Element {
  return (
    <Tray.Back>
      {({ color, size }) => <Ionicons color={color} name="chevron-back" size={size} />}
    </Tray.Back>
  );
}

function TrayClose(): React.JSX.Element {
  return (
    <Tray.Close>
      {({ color, size }) => <Ionicons color={color} name="close" size={size} />}
    </Tray.Close>
  );
}
