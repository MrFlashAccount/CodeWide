import { Ionicons } from "@expo/vector-icons";
import { useState, type ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { useEvent } from "../../react/useEvent";
import { colors, iconSize, spacing, touchTarget, typeScale, typeWeight } from "../../theme";
import { AppListRow } from "../../ui/AppListRow";
import { listRowHeight, listRowPosition } from "../../ui/AppListRow.types";
import { AppSheet, AppSheetScrollView } from "../../ui/AppSheet";
import { SheetPageTransition } from "../../ui/sheetNavigation";
import { AppText as Text } from "../../ui/Typography";

/** Display content stays with its owner; this sheet owns only settings navigation. */
interface SettingsServer {
  readonly content: ReactNode;
  readonly description: string;
  readonly id: string;
  readonly leading: ReactNode;
  readonly statusIcon: ReactNode;
  readonly title: string;
}

interface SettingsSheetProps {
  readonly advanced: ReactNode;
  readonly entryPage?: "overview" | "voiceAssistant";
  readonly entryRequest?: string;
  readonly onAddServer: () => void;
  readonly onClose: () => void;
  readonly security: ReactNode;
  readonly servers: readonly SettingsServer[];
  readonly version: ReactNode;
  readonly visible: boolean;
  readonly voiceAssistant: {
    readonly content: ReactNode;
    readonly description: string;
  };
}

type SettingsPage =
  | { readonly kind: "overview" }
  | { readonly kind: "advanced" }
  | { readonly kind: "security" }
  | { readonly kind: "voiceAssistant" }
  | { readonly id: string; readonly kind: "server" };

type SettingsNavigation = {
  readonly direction: "back" | "forward" | null;
  readonly page: SettingsPage;
};

export function SettingsSheet(props: SettingsSheetProps) {
  const [navigation, setNavigation] = useState<SettingsNavigation>({
    direction: null,
    page: { kind: props.entryPage ?? "overview" },
  });
  const [entryRequest, setEntryRequest] = useState(props.entryRequest);
  if (entryRequest !== props.entryRequest) {
    setEntryRequest(props.entryRequest);
    setNavigation({ direction: null, page: { kind: props.entryPage ?? "overview" } });
  }
  const { page } = navigation;
  const selectedServer =
    page.kind === "server" ? props.servers.find((server) => server.id === page.id) : undefined;
  // A removed server returns to the overview without retaining its editor or account data.
  const overview =
    page.kind === "overview" || (page.kind === "server" && selectedServer === undefined);
  const title = overview
    ? "Settings"
    : page.kind === "advanced"
      ? "Advanced"
      : page.kind === "security"
        ? "Security"
        : page.kind === "voiceAssistant"
          ? "Voice Assistant"
          : (selectedServer?.title ?? "Settings");
  const back = useEvent(() => {
    setNavigation({ direction: "back", page: { kind: "overview" } });
  });
  const openAdvanced = useEvent(() => {
    setNavigation({ direction: "forward", page: { kind: "advanced" } });
  });
  const openServer = useEvent((id: string) => {
    setNavigation({ direction: "forward", page: { id, kind: "server" } });
  });
  const openSecurity = useEvent(() => {
    setNavigation({ direction: "forward", page: { kind: "security" } });
  });
  const openVoiceAssistant = useEvent(() => {
    setNavigation({ direction: "forward", page: { kind: "voiceAssistant" } });
  });
  const changeOpen = useEvent((open: boolean) => {
    if (!open) {
      props.onClose();
    }
  });

  return (
    <AppSheet
      contentProps={{
        contentContainerClassName: "h-full",
        dismissLabel: "Close settings",
        enableDynamicSizing: false,
        enableOverDrag: false,
        index: 0,
        performanceSurface: "settings",
        snapPoints: ["65%", "90%"],
      }}
      isOpen={props.visible}
      {...(overview ? {} : { onDismissRequest: back })}
      onOpenChange={changeOpen}
    >
      <SheetPageTransition
        direction={navigation.direction}
        routeKey={
          overview
            ? "overview"
            : page.kind === "advanced"
              ? "advanced"
              : page.kind === "security"
                ? "security"
                : page.kind === "voiceAssistant"
                  ? "voice-assistant"
                  : (selectedServer?.id ?? "overview")
        }
      >
        <View style={styles.header}>
          {!overview && (
            <Pressable
              accessibilityLabel="Back to settings"
              accessibilityRole="button"
              onPress={back}
              style={styles.back}
            >
              <Ionicons color={colors.text} name="arrow-back" size={iconSize.action} />
            </Pressable>
          )}
          <Text accessibilityRole="header" numberOfLines={1} style={styles.title}>
            {title}
          </Text>
        </View>
        <AppSheetScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          style={styles.scroll}
        >
          {overview ? (
            <>
              <SettingsSection title="Servers">
                {props.servers.length === 0 && <Text style={styles.notice}>No saved servers</Text>}
                {props.servers.map((server, index) => (
                  <AppListRow
                    accessibilityHint="Open connection and Codex accounts"
                    accessibilityLabel={`Settings for ${server.title}`}
                    description={server.description}
                    descriptionLeading={server.statusIcon}
                    fixedHeight={listRowHeight.double}
                    key={server.id}
                    leading={server.leading}
                    onPress={() => {
                      openServer(server.id);
                    }}
                    position={listRowPosition(index, props.servers.length + 1)}
                    title={server.title}
                    trailingIcon={{
                      color: colors.textMuted,
                      name: "chevron-forward",
                      size: iconSize.inline,
                    }}
                  />
                ))}
                <AppListRow
                  fixedHeight={listRowHeight.single}
                  leadingIcon={{ color: colors.textMuted, name: "add", size: iconSize.action }}
                  onPress={props.onAddServer}
                  position={props.servers.length === 0 ? "only" : "last"}
                  title="Add server"
                />
              </SettingsSection>
              <View testID="settings-navigation-list">
                {props.security === null ? null : (
                  <AppListRow
                    description="Biometric Lock"
                    fixedHeight={listRowHeight.double}
                    leadingIcon={{
                      color: colors.textMuted,
                      name: "shield-checkmark-outline",
                      size: iconSize.action,
                    }}
                    onPress={openSecurity}
                    position="first"
                    title="Security"
                    trailingIcon={{
                      color: colors.textMuted,
                      name: "chevron-forward",
                      size: iconSize.inline,
                    }}
                  />
                )}
                <AppListRow
                  description={props.voiceAssistant.description}
                  fixedHeight={listRowHeight.double}
                  leadingIcon={{
                    color: colors.textMuted,
                    name: "volume-medium-outline",
                    size: iconSize.action,
                  }}
                  onPress={openVoiceAssistant}
                  position={props.security === null ? "first" : "middle"}
                  title="Voice Assistant"
                  trailingIcon={{
                    color: colors.textMuted,
                    name: "chevron-forward",
                    size: iconSize.inline,
                  }}
                />
                <AppListRow
                  description="Performance diagnostics"
                  fixedHeight={listRowHeight.double}
                  leadingIcon={{
                    color: colors.textMuted,
                    name: "options-outline",
                    size: iconSize.action,
                  }}
                  onPress={openAdvanced}
                  position="last"
                  title="Advanced"
                  trailingIcon={{
                    color: colors.textMuted,
                    name: "chevron-forward",
                    size: iconSize.inline,
                  }}
                />
              </View>
              {props.version}
            </>
          ) : page.kind === "advanced" ? (
            props.advanced
          ) : page.kind === "security" ? (
            props.security
          ) : page.kind === "voiceAssistant" ? (
            props.voiceAssistant.content
          ) : (
            selectedServer?.content
          )}
        </AppSheetScrollView>
      </SheetPageTransition>
    </AppSheet>
  );
}

/** Section rhythm uses the same type and spacing tokens as the surrounding app lists. */
export function SettingsSection({ children, title }: { children: ReactNode; title: string }) {
  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.sectionTitle}>
        {title}
      </Text>
      <View>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  back: {
    alignItems: "center",
    height: touchTarget,
    justifyContent: "center",
    width: touchTarget,
  },
  content: {
    gap: spacing.md,
    paddingBottom: spacing.sm,
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.compact,
    marginBottom: spacing.xs,
    minHeight: touchTarget,
  },
  notice: {
    color: colors.textMuted,
    ...typeScale.body,
    paddingVertical: spacing.sm,
  },
  scroll: {
    flex: 1,
    minHeight: 0,
  },
  section: { gap: spacing.xs },
  sectionTitle: {
    color: colors.textMuted,
    ...typeScale.label,
    fontWeight: typeWeight.semibold,
    textTransform: "uppercase",
  },
  title: {
    color: colors.text,
    flex: 1,
    minWidth: 0,
    ...typeScale.heading,
  },
});
