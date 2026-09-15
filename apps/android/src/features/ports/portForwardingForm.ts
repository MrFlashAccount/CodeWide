import type { PortForwardingDraft } from "./portForwardingContract";
export type FormState = {
  id: string | null;
  label: string;
  remotePort: string;
  localPort: string;
  startImmediately: boolean;
};

export const EMPTY_FORM: FormState = {
  id: null,
  label: "",
  remotePort: "3000",
  localPort: "",
  startImmediately: true,
};

export function parseForwardingDraft(
  form: Pick<FormState, "label" | "remotePort" | "localPort" | "startImmediately">,
): PortForwardingDraft {
  const remotePort = parsePort(form.remotePort, "Remote port");
  const preferredLocalPort =
    form.localPort.trim() === "" ? null : parsePort(form.localPort, "Phone port");
  return {
    label: form.label.trim() || `Port ${remotePort}`,
    remoteHost: "127.0.0.1",
    remotePort,
    preferredLocalPort,
    startImmediately: form.startImmediately,
  };
}

export function parsePort(raw: string, label: string): number {
  const port = Number(raw);
  if (!/^\d{1,5}$/u.test(raw.trim()) || !Number.isSafeInteger(port) || port < 1 || port > 65_535)
    throw new Error(`${label} must be between 1 and 65535`);
  return port;
}

export function message(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback;
}
