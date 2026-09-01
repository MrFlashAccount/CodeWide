import { router, useFocusEffect } from "expo-router";
import { useState, useSyncExternalStore, useTransition, type ReactNode } from "react";

import {
  ConnectionSettingsView,
  type ConnectionSettingsServerAction,
} from "../../presentation/settings/ConnectionSettingsView";
import { useEvent } from "../../../react/useEvent";
import { useAppDialog } from "../../ui/AppDialog";
import { useAppLockSettings } from "../../../ui/AppLockGate";
import { savedServerId } from "../../domain/ids";
import { useV2Runtime } from "../../V2Application";
import { V2PresentationProvider } from "../../platform/rendering/V2PresentationProvider";
import { serverSettingsDestination } from "../navigation/routeDestinations";

interface SettingsScreenProps {
  generationControl: ReactNode;
  onClose(): void;
  version: string;
}

type SettingsDestination = ReturnType<typeof serverSettingsDestination>;

export function SettingsScreen(props: SettingsScreenProps): React.JSX.Element {
  const { generationControl, onClose, version } = props;
  const runtime = useV2Runtime();
  const appLock = useAppLockSettings();
  const alert = useAppDialog();
  const servers = useSyncExternalStore(
    runtime.savedServers.subscribe,
    runtime.savedServers.snapshot,
    runtime.savedServers.snapshot,
  );
  const [error, setError] = useState<string | null>(null);
  const [sheetMounted, setSheetMounted] = useState(true);
  const [pending, startTransition] = useTransition();
  const navigateFromSheet = useEvent((destination: SettingsDestination) => {
    setSheetMounted(false);
    router.push(destination);
  });
  const showSheetOnFocus = useEvent(() => {
    setSheetMounted(true);
  });
  useFocusEffect(showSheetOnFocus);
  const changeAppLock = useEvent((enabled: boolean) => {
    setError(null);
    startTransition(async () => {
      try {
        await appLock.setEnabled(enabled);
      } catch {
        setError("Could not update app lock.");
      }
    });
  });
  const changeServerEnabled = useEvent((id: string, enabled: boolean) => {
    setError(null);
    startTransition(async () => {
      try {
        await runtime.setSavedServerEnabled(savedServerId(id), enabled);
      } catch {
        setError("Could not update this server.");
      }
    });
  });
  const runServerAction = useEvent((id: string, action: ConnectionSettingsServerAction) => {
    const parsedId = savedServerId(id);
    if (action === "reconnect") {
      runtime.reconnect(parsedId);
      return;
    }
    if (action === "edit") {
      navigateFromSheet(serverSettingsDestination(parsedId));
      return;
    }
    if (action === "moveUp" || action === "moveDown") {
      const direction = action === "moveUp" ? -1 : 1;
      startTransition(async () => {
        try {
          await runtime.moveSavedServer(parsedId, direction);
        } catch {
          setError("Could not reorder saved servers.");
        }
      });
      return;
    }
    const server = servers.value.find((candidate) => candidate.id === parsedId);
    alert("Delete server?", `Remove ${server?.displayName ?? "this server"} from this device?`, [
      { text: "Cancel", style: "cancel" },
      {
        onPress: () => {
          startTransition(async () => {
            try {
              await runtime.deleteSavedServer(parsedId);
            } catch {
              setError("Could not delete this saved server.");
            }
          });
        },
        style: "destructive",
        text: "Delete",
      },
    ]);
  });
  return (
    <V2PresentationProvider>
      {sheetMounted ? (
        <ConnectionSettingsView
          appLockBusy={pending}
          appLockEnabled={appLock.enabled}
          error={error}
          generationControl={generationControl}
          onAppLockChange={changeAppLock}
          onClose={onClose}
          onServerAction={runServerAction}
          onServerEnabledChange={changeServerEnabled}
          servers={servers.value.map((server) => ({
            detail: server.endpoint,
            emoji: server.emoji,
            enabled: server.enabled,
            id: server.id,
            label: server.displayName,
            pending,
            state: server.enabled ? "connected" : "disabled",
          }))}
          version={version}
        />
      ) : null}
    </V2PresentationProvider>
  );
}
