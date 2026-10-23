import { Ionicons } from "@expo/vector-icons";
import { Pressable, View } from "react-native";

import type { ForgeProvider } from "../../../data/forgeContract";
import { AppButton } from "../../../presentation/controls/AppButton";
import { ProductText } from "../../../presentation/text/ProductText";
import { useEvent } from "../../../react/useEvent";
import { colors, iconSize } from "../../../theme";
import { AppText } from "../../../ui/AppText";
import { ForgeIcon } from "../../../ui/ForgeIcon";
import { connectActionKey, otherActionLabel, type CardPlan, type ConnectAction } from "./cardPlan";
import type { ConnectHandlers } from "./ConnectActions";
import { onboardingStyles as styles } from "./onboarding.styles";

type MethodsPlan = Extract<CardPlan, { readonly kind: "methods" }>;
type TrayActionIcon = React.ComponentProps<typeof Ionicons>["name"];

const ACTION_ICONS: Readonly<Record<ConnectAction["kind"], TrayActionIcon>> = {
  hostLogin: "terminal-outline",
  instructions: "document-text-outline",
  link: "person-outline",
  pasteToken: "key-outline",
};

/** Provider methods arranged for the Tray's dedicated method-selection step. */
export function TrayConnectMethods({
  handlers,
  plan,
  provider,
}: {
  readonly handlers: ConnectHandlers;
  readonly plan: MethodsPlan;
  readonly provider: ForgeProvider;
}): React.JSX.Element {
  return (
    <View style={styles.trayMethods}>
      {plan.primary === null ? null : (
        <TrayPrimaryAction action={plan.primary} handlers={handlers} provider={provider} />
      )}
      <TrayOtherWays actions={plan.others} handlers={handlers} />
      {plan.unavailable.map((method) => (
        <ProductText key={method.methodId} style={styles.body} tone="dim">
          {`${method.label}: ${method.unavailableReason ?? "Unavailable on this host"}`}
        </ProductText>
      ))}
    </View>
  );
}

function TrayOtherWays({
  actions,
  handlers,
}: {
  readonly actions: readonly ConnectAction[];
  readonly handlers: ConnectHandlers;
}): React.JSX.Element | null {
  if (actions.length === 0) {
    return null;
  }
  return (
    <View style={styles.trayAlternatives}>
      <OtherWaysHeading />
      {actions.map((action, index) => (
        <TrayActionRow
          action={action}
          handlers={handlers}
          key={connectActionKey(action)}
          separated={index > 0}
        />
      ))}
    </View>
  );
}

function OtherWaysHeading(): React.JSX.Element {
  return (
    <View style={styles.otherWaysHeading}>
      <View style={styles.otherWaysDivider} />
      <ProductText style={styles.label}>Other ways</ProductText>
      <View style={styles.otherWaysDivider} />
    </View>
  );
}

function TrayPrimaryAction({
  action,
  handlers,
  provider,
}: {
  readonly action: ConnectAction;
  readonly handlers: ConnectHandlers;
  readonly provider: ForgeProvider;
}): React.JSX.Element {
  if (action.kind === "instructions") {
    return <TrayActionRow action={action} handlers={handlers} separated={false} />;
  }
  if (action.kind !== "link") {
    return <TrayActionRow action={action} handlers={handlers} separated={false} />;
  }
  return <TrayAccountAction action={action} handlers={handlers} provider={provider} />;
}

function TrayAccountAction({
  action,
  handlers,
  provider,
}: {
  readonly action: Extract<ConnectAction, { readonly kind: "link" }>;
  readonly handlers: ConnectHandlers;
  readonly provider: ForgeProvider;
}): React.JSX.Element {
  const onPress = useEvent((): void => {
    handlers.onAction(action);
  });
  return (
    <View style={styles.trayAccountRow}>
      <View style={styles.trayAccountIcon}>
        <ForgeIcon
          color={colors.text}
          glyph={provider.icon.glyph}
          iconKey={provider.icon.iconKey}
          size={iconSize.navigation}
        />
      </View>
      <View style={styles.providerIdentity}>
        <ProductText numberOfLines={1} style={styles.providerTitle}>
          {`@${action.login}`}
        </ProductText>
        <ProductText numberOfLines={1} style={styles.providerCaption}>
          Available on this Companion
        </ProductText>
      </View>
      <AppButton
        accessibilityLabel={`Use @${action.login}`}
        isDisabled={handlers.busy}
        onPress={onPress}
        pending={handlers.startingKey === connectActionKey(action)}
        size="sm"
        style={styles.trayAccountButton}
        variant="primary"
      >
        Use account
      </AppButton>
    </View>
  );
}

function TrayActionRow({
  action,
  handlers,
  separated,
}: {
  readonly action: ConnectAction;
  readonly handlers: ConnectHandlers;
  readonly separated: boolean;
}): React.JSX.Element {
  const onPress = useEvent((): void => {
    handlers.onAction(action);
  });
  return (
    <Pressable
      accessibilityHint={action.method.detail}
      accessibilityRole="button"
      disabled={handlers.busy}
      onPress={onPress}
      style={[styles.trayMethodRow, separated ? styles.trayMethodRowSeparated : null]}
    >
      <Ionicons color={colors.textMuted} name={actionIcon(action)} size={iconSize.action} />
      <AppText
        shimmering={handlers.startingKey === connectActionKey(action)}
        style={styles.trayMethodLabel}
      >
        {otherActionLabel(action)}
      </AppText>
      <Ionicons color={colors.textMuted} name="chevron-forward" size={iconSize.inline} />
    </Pressable>
  );
}

function actionIcon(action: ConnectAction): React.ComponentProps<typeof Ionicons>["name"] {
  return ACTION_ICONS[action.kind];
}
