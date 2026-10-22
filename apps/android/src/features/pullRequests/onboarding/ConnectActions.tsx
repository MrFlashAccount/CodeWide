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

/** The card's one prominent action; host steps render as their own panel with Check again. */
export function PrimaryConnect({
  action,
  handlers,
}: {
  readonly action: ConnectAction;
  readonly handlers: ConnectHandlers;
}): React.JSX.Element {
  if (action.kind === "instructions") {
    return (
      <InstructionsPanel
        checking={handlers.checking}
        method={action.method}
        onCheckAgain={handlers.onCheckAgain}
      />
    );
  }
  return (
    <AppButton
      accessibilityHint={action.method.detail}
      isDisabled={handlers.busy}
      onPress={() => {
        handlers.onAction(action);
      }}
      pending={handlers.startingKey === connectActionKey(action)}
      style={styles.primaryButton}
      variant="primary"
    >
      {action.kind === "link" ? `Link @${action.login}` : action.method.label}
    </AppButton>
  );
}

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

/** Methods the host cannot offer right now, each with its reason. */
export function UnavailableMethods({
  methods,
}: {
  readonly methods: readonly AuthMethod[];
}): React.JSX.Element | null {
  if (methods.length === 0) {
    return null;
  }
  return (
    <View style={styles.section}>
      {methods.map((method) => (
        <ProductText key={method.methodId} style={styles.body} tone="dim">
          {`${method.label}: ${method.unavailableReason ?? "Unavailable on this host"}`}
        </ProductText>
      ))}
    </View>
  );
}
