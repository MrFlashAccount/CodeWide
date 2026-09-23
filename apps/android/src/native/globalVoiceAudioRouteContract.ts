import { unknownRecord } from "../data/unknownRecord";

/** Durable route intent; Android device ids are used only for the current connection. */
export type VoiceInputKind = "system" | "builtin" | "wired" | "usb" | "bluetooth" | "ble";

/** One currently connected, input-capable Android device. */
type VoiceInputDevice = {
  readonly id: number;
  readonly kind: Exclude<VoiceInputKind, "system">;
  readonly label: string;
};

/** Separates saved intent from Android's observed recording route. */
export type VoiceInputSnapshot = {
  readonly active: boolean;
  readonly bluetoothCoupled: boolean;
  readonly devices: readonly VoiceInputDevice[];
  readonly fallback: "none" | "unavailable" | "routeRejected";
  readonly muted: boolean;
  readonly preference: VoiceInputKind;
  readonly routedInput: VoiceInputDevice | null;
};

const MAX_DEVICE_LABEL_CHARACTERS = 512;
const MAX_CONNECTED_INPUTS = 128;

const inputKinds = ["builtin", "wired", "usb", "bluetooth", "ble"] as const;

function decodeDevice(value: unknown): VoiceInputDevice {
  const dto = unknownRecord(value);
  const kind = inputKinds.find((candidate) => candidate === dto?.kind);
  if (
    dto === null ||
    kind === undefined ||
    typeof dto.id !== "number" ||
    !Number.isSafeInteger(dto.id) ||
    dto.id < 0 ||
    typeof dto.label !== "string" ||
    dto.label.length > MAX_DEVICE_LABEL_CHARACTERS
  ) {
    throw new Error("Invalid native microphone device");
  }
  return { id: dto.id, kind, label: dto.label };
}

function decodeBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") {
    throw new Error("Invalid native microphone state");
  }
  return value;
}

function decodeFallback(value: unknown): VoiceInputSnapshot["fallback"] {
  if (value !== "none" && value !== "unavailable" && value !== "routeRejected") {
    throw new Error("Invalid native microphone fallback");
  }
  return value;
}

/** Validates native data before publishing it as the application route contract. */
export function decodeVoiceInputSnapshot(value: unknown): VoiceInputSnapshot {
  const dto = unknownRecord(value);
  const preference =
    dto?.preference === "system" ? "system" : inputKinds.find((kind) => kind === dto?.preference);
  if (
    dto === null ||
    preference === undefined ||
    !Array.isArray(dto.devices) ||
    dto.devices.length > MAX_CONNECTED_INPUTS
  ) {
    throw new Error("Invalid native microphone route");
  }
  return {
    active: decodeBoolean(dto.active),
    bluetoothCoupled: decodeBoolean(dto.bluetoothCoupled),
    devices: dto.devices.map(decodeDevice),
    fallback: decodeFallback(dto.fallback),
    muted: decodeBoolean(dto.muted),
    preference,
    routedInput: dto.routedInput === null ? null : decodeDevice(dto.routedInput),
  };
}

/** Scoped override of the process ADM; release restores the previous output policy. */
export type GlobalVoiceAudioRouteLease = {
  readonly release: () => Promise<void>;
  readonly setMuted: (muted: boolean) => Promise<void>;
};
