import { useState } from "react";
import { View } from "react-native";

import type { AuthMethod } from "../../../data/forgeContract";
import { AppButton } from "../../../presentation/controls/AppButton";
import { ProductText } from "../../../presentation/text/ProductText";
import { connectActionKey, otherActionLabel, type ConnectAction } from "./cardPlan";
import { InstructionsPanel } from "./InstructionsPanel";
import { onboardingStyles as styles } from "./onboarding.styles";

/** Callbacks shared by the primary and the quiet connect actions. */
export type ConnectHandlers = {
  readonly busy: boolean;
  readonly checking: boolean;
  readonly onAction: (action: ConnectAction) => void;
  readonly onCheckAgain: () => void;
  /** Key of the action whose start the companion has not answered yet. */
  readonly startingKey: string | null;
};

/**
 * Every other way to connect: a quiet label, then outline buttons from the
 * card's left edge, so a wrapped option lines up with the first one.
 */
export function OtherWays({
  actions,
  handlers,
}: {
  readonly actions: readonly ConnectAction[];
  readonly handlers: ConnectHandlers;
}): React.JSX.Element | null {
  const [steps, setSteps] = useState<AuthMethod | null>(null);
  if (actions.length === 0) {
    return null;
  }
  return (
    <View style={styles.section}>
      <ProductText style={styles.label}>Other ways</ProductText>
      <View style={styles.actions}>
        {actions.map((action) => (
          <AppButton
            accessibilityHint={action.method.detail}
            isDisabled={handlers.busy}
            key={connectActionKey(action)}
            onPress={() => {
              if (action.kind === "instructions") {
                setSteps(steps === null ? action.method : null);
              } else {
                handlers.onAction(action);
              }
            }}
            pending={handlers.startingKey === connectActionKey(action)}
            size="sm"
            variant="outline"
          >
            {otherActionLabel(action)}
          </AppButton>
        ))}
      </View>
      {steps === null ? null : (
        <InstructionsPanel
          checking={handlers.checking}
          method={steps}
          onCheckAgain={handlers.onCheckAgain}
        />
      )}
    </View>
  );
}
