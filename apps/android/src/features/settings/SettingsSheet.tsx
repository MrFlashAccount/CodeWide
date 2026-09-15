import { Ionicons } from "@expo/vector-icons";
import { useState, type ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { useEvent } from "../../react/useEvent";
import { colors, iconSize, spacing, touchTarget, typeScale, typeWeight } from "../../theme";
import { AppListRow } from "../../ui/AppListRow";
import { listRowHeight, listRowPosition } from "../../ui/AppListRow.types";
import { AppSheet, AppSheetScrollView } from "../../ui/AppSheet";
import { AppText as Text } from "../../ui/Typography";

/** Display content stays with its owner; this sheet owns only settings navigation. */
interface SettingsServer {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly leading: ReactNode;
  readonly statusIcon: ReactNode;
  readonly content: ReactNode;
}

interface SettingsSheetProps {
  readonly servers: readonly SettingsServer[];
  readonly security: ReactNode;
  readonly advanced: ReactNode;
  readonly version: ReactNode;
  readonly onAddServer: () => void;
  readonly onClose: () => void;
}

type SettingsPage =
  | { readonly kind: "overview" }
  | { readonly kind: "advanced" }
  | { readonly kind: "server"; readonly id: string };

export function SettingsSheet(props: SettingsSheetProps) {
  const [page, setPage] = useState<SettingsPage>({ kind: "overview" });
  const selectedServer =
    page.kind === "server" ? props.servers.find((server) => server.id === page.id) : undefined;
  // A removed server returns to the overview without retaining its editor or account data.
  const overview =
    page.kind === "overview" || (page.kind === "server" && selectedServer === undefined);
  const title = overview
    ? "Settings"
    : page.kind === "advanced"
      ? "Advanced"
      : (selectedServer?.title ?? "Settings");
  const back = useEvent(() => setPage({ kind: "overview" }));
  const openAdvanced = useEvent(() => setPage({ kind: "advanced" }));
  const openServer = useEvent((id: string) => setPage({ kind: "server", id }));
  const changeOpen = useEvent((open: boolean) => {
    if (!open) props.onClose();
  });

  return (
    <AppSheet
      isOpen
      onOpenChange={changeOpen}
      contentProps={{
        dismissLabel: "Close settings",
        performanceSurface: "settings",
        index: 0,
        snapPoints: ["65%", "90%"],
        enableDynamicSizing: false,
        enableOverDrag: false,
        contentContainerClassName: "h-full",
      }}
    >
      <View style={styles.header}>
        {!overview && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to settings"
            onPress={back}
            style={styles.back}
          >
            <Ionicons name="arrow-back" size={iconSize.action} color={colors.text} />
          </Pressable>
        )}
        <Text accessibilityRole="header" numberOfLines={1} style={styles.title}>
          {title}
        </Text>
      </View>
      <AppSheetScrollView
        key={overview ? "overview" : page.kind === "advanced" ? "advanced" : selectedServer?.id}
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {overview ? (
          <>
            <SettingsSection title="Servers">
              {props.servers.length === 0 && <Text style={styles.notice}>No saved servers</Text>}
              {props.servers.map((server, index) => (
                <AppListRow
                  key={server.id}
                  title={server.title}
                  description={server.description}
                  fixedHeight={listRowHeight.double}
                  descriptionLeading={server.statusIcon}
                  leading={server.leading}
                  trailingIcon={{
                    name: "chevron-forward",
                    size: iconSize.inline,
                    color: colors.textMuted,
                  }}
                  position={listRowPosition(index, props.servers.length + 1)}
                  accessibilityLabel={`Settings for ${server.title}`}
                  accessibilityHint="Open connection and Codex accounts"
                  onPress={() => openServer(server.id)}
                />
              ))}
              <AppListRow
                title="Add server"
                fixedHeight={listRowHeight.single}
                position={props.servers.length === 0 ? "only" : "last"}
                onPress={props.onAddServer}
                leadingIcon={{ name: "add", size: iconSize.action, color: colors.textMuted }}
              />
            </SettingsSection>
            {props.security === null ? null : (
              <SettingsSection title="Security">{props.security}</SettingsSection>
            )}
            <AppListRow
              title="Advanced"
              description="Interface, experiments and diagnostics"
              fixedHeight={listRowHeight.double}
              onPress={openAdvanced}
              leadingIcon={{
                name: "options-outline",
                size: iconSize.action,
                color: colors.textMuted,
              }}
              trailingIcon={{
                name: "chevron-forward",
                size: iconSize.inline,
                color: colors.textMuted,
              }}
            />
            {props.version}
          </>
        ) : page.kind === "advanced" ? (
          props.advanced
        ) : (
          selectedServer?.content
        )}
      </AppSheetScrollView>
    </AppSheet>
  );
}

/** Section rhythm uses the same type and spacing tokens as the surrounding app lists. */
export function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
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
  header: {
    minHeight: touchTarget,
    marginBottom: spacing.xs,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.compact,
  },
  back: {
    width: touchTarget,
    height: touchTarget,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    minWidth: 0,
    flex: 1,
    color: colors.text,
    ...typeScale.heading,
  },
  scroll: {
    flex: 1,
    minHeight: 0,
  },
  content: {
    gap: spacing.md,
    paddingBottom: spacing.sm,
  },
  section: { gap: spacing.xs },
  sectionTitle: {
    color: colors.textMuted,
    ...typeScale.label,
    fontWeight: typeWeight.semibold,
    textTransform: "uppercase",
  },
  notice: {
    color: colors.textMuted,
    ...typeScale.body,
    paddingVertical: spacing.sm,
  },
});
