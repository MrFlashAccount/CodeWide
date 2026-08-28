import Ionicons from "@expo/vector-icons/Ionicons";
import { useLiveQuery } from "@tanstack/react-db";
import { createContext, type ReactNode, use, useContext, useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, Pressable, StyleSheet, View } from "react-native";

import {
  APP_LOCK_PREFERENCE_ID,
  decodeAppLockPreferences,
  encodeAppLockPreferences,
} from "../data/app-lock-preferences";
import { getUserPreferencesDatabase } from "../data/user-preferences-database";
import { authenticateWithDevice } from "../native/local-authentication";
import { useEvent } from "../react/useEvent";
import { colors, radii, spacing, touchTarget } from "../theme";
import { AppText as Text } from "./Typography";

type AppLockContextValue = {
  enabled: boolean;
  setEnabled(enabled: boolean): Promise<void>;
};

const AppLockContext = createContext<AppLockContextValue | null>(null);
const database = getUserPreferencesDatabase();

export function AppLockGate({ children }: { children: ReactNode }) {
  use(database.ready);
  const query = useLiveQuery(() => database.collection);
  const row = query.data?.find((candidate) => candidate.id === APP_LOCK_PREFERENCE_ID)
    ?? database.collection.get(APP_LOCK_PREFERENCE_ID);
  const enabled = row === undefined ? false : decodeAppLockPreferences(row.value).enabled;
  const [unlocked, setUnlocked] = useState(false);
  const [authenticating, setAuthenticating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const authenticatingRef = useRef(false);

  const authenticate = useEvent(async () => {
    if (authenticatingRef.current) return;
    authenticatingRef.current = true;
    setAuthenticating(true);
    setMessage(null);
    try {
      const result = await authenticateWithDevice("Unlock CodeWide");
      if (result.success) setUnlocked(true);
      else setMessage(result.message);
    } catch {
      setMessage("Could not open system authentication.");
    }
    authenticatingRef.current = false;
    setAuthenticating(false);
  });

  const setEnabled = useEvent(async (nextEnabled: boolean) => {
    if (nextEnabled) {
      const result = await authenticateWithDevice("Turn on CodeWide app lock");
      if (!result.success) throw new Error(result.message);
    }
    await database.update(APP_LOCK_PREFERENCE_ID, () => (
      encodeAppLockPreferences({ enabled: nextEnabled })
    ));
    setUnlocked(true);
    setMessage(null);
  });

  useEffect(() => {
    if (enabled && !unlocked && AppState.currentState === "active") void authenticate();
  }, [authenticate, enabled, unlocked]);

  const handleAppStateChange = useEvent((state: string) => {
    if (!enabled) return;
    if (state === "active") void authenticate();
    else setUnlocked(false);
  });

  useEffect(() => {
    const subscription = AppState.addEventListener("change", handleAppStateChange);
    return () => subscription.remove();
  }, [handleAppStateChange]);

  const context: AppLockContextValue = { enabled, setEnabled };
  if (enabled && !unlocked) {
    return (
      <AppLockContext.Provider value={context}>
        <LockedSurface loading={authenticating} message={message} onUnlock={() => void authenticate()} />
      </AppLockContext.Provider>
    );
  }
  return <AppLockContext.Provider value={context}>{children}</AppLockContext.Provider>;
}

export function useAppLockSettings(): AppLockContextValue {
  const context = useContext(AppLockContext);
  if (context === null) throw new Error("useAppLockSettings must be used inside AppLockGate");
  return context;
}

function LockedSurface({ loading, message = null, onUnlock }: { loading: boolean; message?: string | null; onUnlock?(): void }) {
  return (
    <View accessibilityLabel="CodeWide is locked" style={styles.root} testID="app-lock-screen">
      <View style={styles.icon}>
        <Ionicons name="lock-closed" color={colors.text} size={34} />
      </View>
      <Text style={styles.title}>CodeWide is locked</Text>
      <Text style={styles.message}>{message ?? "Verify with your device to continue."}</Text>
      {loading ? <ActivityIndicator color={colors.textMuted} /> : onUnlock !== undefined && (
        <Pressable accessibilityRole="button" onPress={onUnlock} style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
          <Ionicons name="finger-print" color={colors.background} size={20} />
          <Text style={styles.buttonText}>Unlock</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: "center",
    backgroundColor: colors.background,
    flex: 1,
    gap: spacing.md,
    justifyContent: "center",
    padding: spacing.xl,
  },
  icon: {
    alignItems: "center",
    borderColor: colors.border,
    borderRadius: 36,
    borderWidth: 1,
    height: 72,
    justifyContent: "center",
    width: 72,
  },
  title: { color: colors.text, fontSize: 20, fontWeight: "700" },
  message: { color: colors.textMuted, maxWidth: 320, textAlign: "center" },
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
  buttonText: { color: colors.background, fontWeight: "700" },
  pressed: { opacity: 0.78 },
});
