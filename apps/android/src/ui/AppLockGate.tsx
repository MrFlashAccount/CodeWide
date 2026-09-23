import Ionicons from "@expo/vector-icons/Ionicons";
import { useLiveQuery } from "@tanstack/react-db";
import { createContext, type ReactNode, use, useContext, useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, Pressable, StyleSheet, View } from "react-native";

import {
  APP_LOCK_PREFERENCE_ID,
  decodeAppLockPreferences,
  encodeAppLockPreferences,
} from "../data/app-lock-preferences";
import { appLockVoiceLifecycle } from "../data/appLockVoiceLifecycle";
import { getUserPreferencesDatabase } from "../data/user-preferences-database";
import { authenticateWithDevice } from "../native/local-authentication";
import { useEvent } from "../react/useEvent";
import {
  colors,
  radii,
  spacing,
  touchTarget,
  typeScale,
  typeWeight,
  iconSize,
  layoutSize,
} from "../theme";
import { AppText as Text } from "./Typography";
import { appNoticeStore } from "./appNoticeStore";

type AppLockContextValue = {
  enabled: boolean;
  setEnabled: (enabled: boolean) => Promise<void>;
};
type AppLockState = {
  authenticating: boolean;
  message: string | null;
  unlocked: boolean;
};

const AppLockContext = createContext<AppLockContextValue | null>(null);
const database = getUserPreferencesDatabase();

export function AppLockGate({ children }: { children: ReactNode }) {
  use(database.ready);
  const query = useLiveQuery(() => database.collection);
  const row =
    query.data?.find((candidate) => candidate.id === APP_LOCK_PREFERENCE_ID) ??
    database.collection.get(APP_LOCK_PREFERENCE_ID);
  const enabled = row === undefined ? false : decodeAppLockPreferences(row.value).enabled;
  const [lockState, setLockState] = useState<AppLockState>({
    authenticating: false,
    message: null,
    unlocked: false,
  });
  const { authenticating, message, unlocked } = lockState;
  const authenticatingRef = useRef(false);
  const authenticationTaskRef = useRef<Promise<void> | null>(null);

  const authenticate = useEvent((): void => {
    if (authenticatingRef.current) {
      return;
    }
    authenticatingRef.current = true;
    setLockState((current) => ({ ...current, authenticating: true, message: null }));
    const task: Promise<void> = (async () => {
      let result: Awaited<ReturnType<typeof authenticateWithDevice>>;
      try {
        result = await authenticateWithDevice("Unlock CodeWide");
      } catch {
        setLockState({
          authenticating: false,
          message: "Could not open system authentication.",
          unlocked: false,
        });
        authenticatingRef.current = false;
        return;
      }
      if (result.success && AppState.currentState === "active") {
        setLockState({ authenticating: false, message: null, unlocked: true });
        void appLockVoiceLifecycle.resumeAfterAppUnlock().catch(() => undefined);
      } else {
        setLockState({
          authenticating: false,
          message: result.success ? null : result.message,
          unlocked: false,
        });
      }
      authenticatingRef.current = false;
    })();
    authenticationTaskRef.current = task;
  });

  const setEnabled = useEvent(async (nextEnabled: boolean) => {
    if (nextEnabled) {
      const result = await authenticateWithDevice("Turn on CodeWide app lock");
      if (!result.success) {
        throw new Error(result.message);
      }
    }
    await database.update(APP_LOCK_PREFERENCE_ID, () =>
      encodeAppLockPreferences({ enabled: nextEnabled }),
    );
    setLockState({ authenticating: false, message: null, unlocked: true });
  });

  useEffect(() => {
    if (enabled && !unlocked && AppState.currentState === "active") {
      // WHY: entering the active app state must synchronize with the device authentication UI.
      // oxlint-disable-next-line react-doctor/no-chain-state-updates
      authenticate();
    }
  }, [authenticate, enabled, unlocked]);

  const handleAppStateChange = useEvent((state: string) => {
    if (!enabled) {
      return;
    }
    if (state === "active") {
      authenticate();
    } else {
      appNoticeStore.clear();
      void appLockVoiceLifecycle.pauseForAppLock().catch(() => undefined);
      setLockState((current) => ({ ...current, unlocked: false }));
    }
  });

  useEffect(() => {
    const subscription = AppState.addEventListener("change", handleAppStateChange);
    return () => {
      subscription.remove();
    };
  }, [handleAppStateChange]);

  const context: AppLockContextValue = { enabled, setEnabled };
  if (enabled && !unlocked) {
    return (
      <AppLockContext.Provider value={context}>
        <LockedSurface loading={authenticating} message={message} onUnlock={authenticate} />
      </AppLockContext.Provider>
    );
  }
  return <AppLockContext.Provider value={context}>{children}</AppLockContext.Provider>;
}

export function useAppLockSettings(): AppLockContextValue {
  const context = useContext(AppLockContext);
  if (context === null) {
    throw new Error("useAppLockSettings must be used inside AppLockGate");
  }
  return context;
}

function LockedSurface({
  loading,
  message = null,
  onUnlock,
}: {
  loading: boolean;
  message?: string | null;
  onUnlock?: () => void;
}) {
  return (
    <View accessibilityLabel="CodeWide is locked" style={styles.root} testID="app-lock-screen">
      <View style={styles.icon}>
        <Ionicons color={colors.text} name="lock-closed" size={iconSize.illustration} />
      </View>
      <Text style={styles.title}>CodeWide is locked</Text>
      <Text style={styles.message}>{message ?? "Verify with your device to continue."}</Text>
      {loading ? (
        <ActivityIndicator color={colors.textMuted} />
      ) : (
        onUnlock !== undefined && (
          <Pressable
            accessibilityRole="button"
            onPress={onUnlock}
            style={({ pressed }) => [styles.button, pressed && styles.pressed]}
          >
            <Ionicons color={colors.background} name="finger-print" size={iconSize.action} />
            <Text style={styles.buttonText}>Unlock</Text>
          </Pressable>
        )
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: "center",
    backgroundColor: colors.text,
    borderRadius: radii.large,
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "center",
    minHeight: touchTarget,
    paddingHorizontal: spacing.lg,
  },
  buttonText: {
    color: colors.background,
    fontWeight: typeWeight.semibold,
  },
  icon: {
    alignItems: "center",
    borderColor: colors.border,
    borderRadius: radii.pill,
    borderWidth: 1,
    height: layoutSize.row,
    justifyContent: "center",
    width: 72,
  },
  message: {
    color: colors.textMuted,
    maxWidth: 320,
    textAlign: "center",
  },
  pressed: { opacity: 0.78 },
  root: {
    alignItems: "center",
    backgroundColor: colors.background,
    flex: 1,
    gap: spacing.md,
    justifyContent: "center",
    padding: spacing.xl,
  },
  title: {
    color: colors.text,
    ...typeScale.heading,
    fontWeight: typeWeight.semibold,
  },
});
