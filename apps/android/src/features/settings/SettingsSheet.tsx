import { Ionicons } from "@expo/vector-icons";
import { startTransition, Suspense, useState, type ReactNode } from "react";
import { Platform, StyleSheet, View } from "react-native";

import { readAgentNotificationSettings } from "../../native/agentNotificationSettings";
import { useEvent } from "../../react/useEvent";
import { colors, iconSize, spacing, typeScale, typeWeight } from "../../theme";
import { AppListRow } from "../../ui/AppListRow";
import { listRowHeight, listRowPosition } from "../../ui/AppListRow.types";
import { AppSheet } from "../../ui/AppSheet";
import { SheetNavigationPage } from "../../ui/SheetNavigationPage";
import { SheetPageTransition } from "../../ui/sheetNavigation";
import { AppText as Text } from "../../ui/Typography";
import type {
  ForgeAccountSelection,
  ForgeAccountSettingsPage,
} from "../pullRequests/forgeAccountSettingsPage";
import { NotificationSettings } from "./NotificationSettings";

/** Display content stays with its owner; this sheet owns only settings navigation. */
interface SettingsServer {
  readonly content: ReactNode;
  readonly description: string;
  /** Shown at the right of the detail page's header, e.g. the server's refresh. */
  readonly headerAction?: ReactNode;
  readonly id: string;
  readonly leading: ReactNode;
  /** Detail-page open intent, for reads the page shows. */
  readonly onOpen?: () => void;
  readonly statusIcon: ReactNode;
  readonly title: string;
}

interface SettingsSheetProps {
  readonly advanced: ReactNode;
  readonly chats: ReactNode;
  readonly downloads: ReactNode;
  readonly entryPage?: "overview" | "voiceAssistant" | "pullRequests";
  readonly entryRequest?: string;
  readonly onAddServer: () => void;
  readonly onClose: () => void;
  readonly renderPullRequests?: (page: ForgeAccountSettingsPage) => ReactNode;
  readonly security: ReactNode;
  readonly servers: readonly SettingsServer[];
  readonly version: ReactNode;
  readonly visible: boolean;
  readonly voiceAssistant: {
    readonly content: ReactNode;
    readonly description: string;
    readonly onOpen: () => void;
  };
}

type SettingsPage =
  | { readonly kind: "overview" }
  | {
      readonly initial: ReturnType<typeof readAgentNotificationSettings>;
      readonly kind: "notifications";
    }
  | { readonly kind: "pullRequests" }
  | { readonly connectionId: string; readonly kind: "forgeConnect" }
  | { readonly kind: "forgeAccount"; readonly selection: ForgeAccountSelection }
  | { readonly kind: "advanced" }
  | { readonly kind: "security" }
  | { readonly kind: "voiceAssistant" }
  | { readonly id: string; readonly kind: "server" };

type SettingsNavigation = {
  readonly direction: "back" | "forward" | null;
  readonly page: SettingsPage;
};

export function SettingsSheet(props: SettingsSheetProps): React.JSX.Element {
  return (
    <Suspense fallback={null}>
      <SettingsSheetNavigation {...props} />
    </Suspense>
  );
}

const pageTitles = {
  advanced: "Advanced",
  forgeConnect: "Connect a provider",
  notifications: "Notifications",
  overview: "Settings",
  pullRequests: "Pull requests",
  security: "Security",
  voiceAssistant: "Voice Assistant",
} as const;

function SettingsSheetNavigation(props: SettingsSheetProps) {
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
  const title =
    page.kind === "forgeAccount"
      ? `@${page.selection.login}`
      : page.kind === "server"
        ? (selectedServer?.title ?? "Settings")
        : pageTitles[page.kind];
  const openNotifications = useEvent(() => {
    const initial = readAgentNotificationSettings();
    startTransition(() => {
      setNavigation({ direction: "forward", page: { initial, kind: "notifications" } });
    });
  });
  const back = useEvent(() => {
    setNavigation({
      direction: "back",
      page: {
        kind:
          page.kind === "forgeAccount" || page.kind === "forgeConnect"
            ? "pullRequests"
            : "overview",
      },
    });
  });
  const openPullRequests = useEvent(() => {
    setNavigation({ direction: "forward", page: { kind: "pullRequests" } });
  });
  const addForgeAccount = useEvent((connectionId: string) => {
    setNavigation({ direction: "forward", page: { connectionId, kind: "forgeConnect" } });
  });
  const openForgeAccount = useEvent((selection: ForgeAccountSelection) => {
    setNavigation({ direction: "forward", page: { kind: "forgeAccount", selection } });
  });
  const removedAccount = useEvent((selection: ForgeAccountSelection) => {
    if (
      page.kind === "forgeAccount" &&
      page.selection.account === selection.account &&
      page.selection.connectionId === selection.connectionId
    ) {
      back();
    }
  });
  const openAdvanced = useEvent(() => {
    setNavigation({ direction: "forward", page: { kind: "advanced" } });
  });
  const openServer = useEvent((id: string) => {
    props.servers.find((server) => server.id === id)?.onOpen?.();
    setNavigation({ direction: "forward", page: { id, kind: "server" } });
  });
  const openSecurity = useEvent(() => {
    setNavigation({ direction: "forward", page: { kind: "security" } });
  });
  const openVoiceAssistant = useEvent(() => {
    props.voiceAssistant.onOpen();
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
            : page.kind === "server"
              ? `server:${page.id}`
              : page.kind === "voiceAssistant"
                ? "voice-assistant"
                : page.kind
        }
      >
        {page.kind === "forgeConnect" ? (
          props.renderPullRequests?.({
            back,
            connectionId: page.connectionId,
            kind: "connect",
          })
        ) : (
          <SheetNavigationPage
            action={page.kind === "server" ? selectedServer?.headerAction : null}
            {...(overview
              ? {}
              : {
                  back: {
                    label:
                      page.kind === "forgeAccount" ? "Back to pull requests" : "Back to settings",
                    onPress: back,
                  },
                })}
            title={title}
          >
            {overview ? (
              <>
                <SettingsSection title="Servers">
                  {props.servers.length === 0 && (
                    <Text style={styles.notice}>No saved servers</Text>
                  )}
                  {props.servers.map((server, index) => (
                    <AppListRow
                      accessibilityHint="Open connection and agent accounts"
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
                <SettingsSection title="Chats">{props.chats}</SettingsSection>
                <SettingsSection title="Downloads">{props.downloads}</SettingsSection>
                {props.renderPullRequests === undefined ? null : (
                  <AppListRow
                    description="Connected accounts"
                    fixedHeight={listRowHeight.double}
                    leadingIcon={{ color: colors.textMuted, name: "git-branch-outline" }}
                    onPress={openPullRequests}
                    position="only"
                    title="Pull requests"
                    trailingIcon={{
                      color: colors.textMuted,
                      name: "chevron-forward",
                      size: iconSize.inline,
                    }}
                  />
                )}
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
                  {Platform.OS === "android" && (
                    <AppListRow
                      description="Agent activity and sounds"
                      fixedHeight={listRowHeight.double}
                      leading={
                        <Ionicons
                          color={colors.textMuted}
                          name="notifications-outline"
                          size={iconSize.action}
                        />
                      }
                      onPress={openNotifications}
                      position={props.security === null ? "first" : "middle"}
                      title="Notifications"
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
                    position={
                      props.security === null && Platform.OS !== "android" ? "first" : "middle"
                    }
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
            ) : page.kind === "notifications" ? (
              <NotificationSettings initial={page.initial} onRetry={openNotifications} />
            ) : page.kind === "forgeAccount" ? (
              props.renderPullRequests?.({
                back: () => {
                  removedAccount(page.selection);
                },
                kind: "account",
                selection: page.selection,
              })
            ) : page.kind === "pullRequests" ? (
              props.renderPullRequests?.({
                add: addForgeAccount,
                kind: "list",
                open: openForgeAccount,
              })
            ) : page.kind === "advanced" ? (
              props.advanced
            ) : page.kind === "security" ? (
              props.security
            ) : page.kind === "voiceAssistant" ? (
              props.voiceAssistant.content
            ) : (
              selectedServer?.content
            )}
          </SheetNavigationPage>
        )}
      </SheetPageTransition>
    </AppSheet>
  );
}

/** Section rhythm uses the same type and spacing tokens as the surrounding app lists. */
export function SettingsSection({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}): React.JSX.Element {
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
  notice: {
    color: colors.textMuted,
    ...typeScale.body,
    paddingVertical: spacing.sm,
  },
  section: { gap: spacing.xs },
  sectionTitle: {
    color: colors.textMuted,
    ...typeScale.label,
    fontWeight: typeWeight.semibold,
    textTransform: "uppercase",
  },
});
