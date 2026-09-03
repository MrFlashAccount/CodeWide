import { useState, useTransition } from "react";

import { useEvent } from "../../../react/useEvent";

export interface AccountLoginStart {
  loginId: string;
  userCode: string;
  verificationUrl: string;
}

interface UseAccountLoginInput {
  cancel(loginId: string): Promise<void>;
  copy(value: string): Promise<void>;
  open(value: string): Promise<void>;
  start(): Promise<AccountLoginStart>;
}

export interface AccountLoginModel {
  begin(): void;
  close(): void;
  codeCopied: boolean;
  copyCode(): void;
  error: string | null;
  login: AccountLoginStart | null;
  openSignIn(): void;
  pending: boolean;
}

/** Owns one device-code login attempt without persisting the one-time code. */
export function useAccountLogin(input: UseAccountLoginInput): AccountLoginModel {
  const { cancel, copy, open, start } = input;
  const [login, setLogin] = useState<AccountLoginStart | null>(null);
  const [codeCopied, setCodeCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [starting, startLoginTransition] = useTransition();
  const [opening, startOpenTransition] = useTransition();
  const [closing, startCloseTransition] = useTransition();
  const begin = useEvent(() => {
    if (starting || login !== null) return;
    setError(null);
    startLoginTransition(async () => {
      try {
        const created = await start();
        setLogin(created);
        setCodeCopied(false);
      } catch (cause) {
        setError(errorMessage(cause, "Could not start Codex sign-in"));
      }
    });
  });
  const close = useEvent(() => {
    if (login === null || closing) return;
    const { loginId } = login;
    setLogin(null);
    setCodeCopied(false);
    startCloseTransition(async () => {
      try {
        await cancel(loginId);
      } catch {
        // The login sheet is already closed; the server also expires abandoned device codes.
      }
    });
  });
  const copyCode = useEvent(() => {
    if (login === null) return;
    setError(null);
    startOpenTransition(async () => {
      try {
        await copy(login.userCode);
        setCodeCopied(true);
      } catch (cause) {
        setError(errorMessage(cause, "Could not copy the sign-in code"));
      }
    });
  });
  const openSignIn = useEvent(() => {
    if (login === null || opening) return;
    setError(null);
    startOpenTransition(async () => {
      try {
        await copy(login.userCode);
        setCodeCopied(true);
        await open(login.verificationUrl);
      } catch (cause) {
        setError(errorMessage(cause, "Could not open Codex sign-in"));
      }
    });
  });
  return {
    begin,
    close,
    codeCopied,
    copyCode,
    error,
    login,
    openSignIn,
    pending: starting || opening || closing,
  };
}

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message.trim() !== "" ? cause.message : fallback;
}
