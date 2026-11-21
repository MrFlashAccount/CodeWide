import { TurboModuleRegistry, type TurboModule } from "react-native";
import { unknownRecord } from "../data/unknownRecord";

export const notificationModes = ["system", "silent", "off"] as const;
export type NotificationMode = (typeof notificationModes)[number];
export type NotificationEvent = "answer" | "input" | "failure";

/** Device-local choices preserved even while the master switch is off. */
export type AgentNotificationSettings = Readonly<Record<NotificationEvent, NotificationMode>> & {
  readonly enabled: boolean;
};

interface NotificationBridge extends TurboModule {
  readonly read: () => Promise<unknown>;
  readonly setEnabled: (enabled: boolean) => Promise<unknown>;
  readonly setMode: (event: NotificationEvent, mode: NotificationMode) => Promise<unknown>;
}

function bridge(): NotificationBridge {
  const module = TurboModuleRegistry.get<NotificationBridge>("CodeWideAgentNotificationSettings");
  if (module === null) {
    throw new Error("Notification settings require an updated CodeWide app");
  }
  return module;
}

export function isNotificationMode(value: unknown): value is NotificationMode {
  return notificationModes.some((mode) => mode === value);
}

function decode(value: unknown): AgentNotificationSettings {
  const data = unknownRecord(value);
  if (
    data === null ||
    typeof data.enabled !== "boolean" ||
    !isNotificationMode(data.answer) ||
    !isNotificationMode(data.input) ||
    !isNotificationMode(data.failure)
  ) {
    throw new Error("Android returned invalid notification settings");
  }
  return { answer: data.answer, enabled: data.enabled, failure: data.failure, input: data.input };
}

/** Reads on navigation intent so the sheet can keep the overview visible until ready. */
export async function readAgentNotificationSettings(): Promise<
  | { readonly kind: "ready"; readonly settings: AgentNotificationSettings }
  | { readonly kind: "error"; readonly message: string }
> {
  try {
    return { kind: "ready", settings: decode(await bridge().read()) };
  } catch (error) {
    return {
      kind: "error",
      message: error instanceof Error ? error.message : "Could not read notification settings",
    };
  }
}

/** Updates only the master switch and returns the native owner's current choices. */
export async function setAgentNotificationsEnabled(
  enabled: boolean,
): Promise<AgentNotificationSettings> {
  return decode(await bridge().setEnabled(enabled));
}

/** Updates one event without overwriting other notification settings. */
export async function setAgentNotificationMode(
  event: NotificationEvent,
  mode: NotificationMode,
): Promise<AgentNotificationSettings> {
  return decode(await bridge().setMode(event, mode));
}
