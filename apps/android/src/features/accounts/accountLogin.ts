/** V1 AccountPoolFeature owner, extracted without changing interaction or resource lifetime. */
import * as Clipboard from "expo-clipboard";
import { useRef, useState } from "react";
import { Linking } from "react-native";
import { useUnmount } from "../../ui/use-unmount";

import { useEvent } from "../../react/useEvent";
import type { AccountPoolProps } from "./accountCapabilities";

/** Explicit close cancels server login; unmount only clears the copied-code timer. */
export function useAccountLogin(
  {
    connectionId,
    onStartLogin,
    onCancelLogin,
  }: Pick<AccountPoolProps, "connectionId" | "onStartLogin" | "onCancelLogin">,
  profileIds: string,
  setError: (error: string | null) => void,
) {
  const [pendingAccountLoginState, setPendingAccountLogin] = useState<{
    loginId: string;
    verificationUrl: string;
    userCode: string;
    profileIds: string;
  } | null>(null);
  const [codeCopied, setCodeCopied] = useState(false);
  const codeCopiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [loginActionBusy, setLoginActionBusy] = useState(false);
  const pendingAccountLogin =
    pendingAccountLoginState?.profileIds === profileIds ? pendingAccountLoginState : null;

  useUnmount(() => {
    if (codeCopiedTimerRef.current !== null) clearTimeout(codeCopiedTimerRef.current);
  });

  const markCodeCopied = useEvent(() => {
    if (codeCopiedTimerRef.current !== null) clearTimeout(codeCopiedTimerRef.current);
    setCodeCopied(true);
    codeCopiedTimerRef.current = setTimeout(() => {
      codeCopiedTimerRef.current = null;
      setCodeCopied(false);
    }, 2_400);
  });

  const addAccount = useEvent(async () => {
    const login = await onStartLogin(connectionId);
    setCodeCopied(false);
    setPendingAccountLogin({ ...login, profileIds });
  });
  const closeAccountLogin = useEvent(() => {
    const login = pendingAccountLogin;
    setPendingAccountLogin(null);
    setCodeCopied(false);
    if (login !== null) void onCancelLogin(connectionId, login.loginId).catch(() => undefined);
  });
  const copyAccountCode = useEvent(async () => {
    if (pendingAccountLogin === null) return;
    await Clipboard.setStringAsync(pendingAccountLogin.userCode);
    markCodeCopied();
  });
  const openAccountSignIn = useEvent(async () => {
    if (pendingAccountLogin === null || loginActionBusy) return;
    setLoginActionBusy(true);
    setError(null);
    try {
      await Clipboard.setStringAsync(pendingAccountLogin.userCode);
      markCodeCopied();
      await Linking.openURL(pendingAccountLogin.verificationUrl);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not open Codex sign-in");
    }
    setLoginActionBusy(false);
  });
  return {
    pendingAccountLogin,
    codeCopied,
    loginActionBusy,
    addAccount,
    closeAccountLogin,
    copyAccountCode,
    openAccountSignIn,
  };
}
