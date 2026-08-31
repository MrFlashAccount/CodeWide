import { NativeEventEmitter, NativeModules, Platform } from "react-native";

import type {
  AuthenticatedDuplexChannel,
  AuthenticatedResponse,
  AuthenticatedTransportLease,
} from "./authenticated-transport-lease.contract";

type AuthenticatedChannelPurpose = "sync-v2" | "terminal-v2" | "voice-v2";
type AuthenticatedRequestPurpose = "files-v2" | "media-v2" | "ports-v2" | "tunnels-v2";

export type {
  AuthenticatedDuplexChannel,
  AuthenticatedRequest,
  AuthenticatedResponse,
  AuthenticatedTransportLease,
} from "./authenticated-transport-lease.contract";

type NativeLeaseBridge = {
  acquireAuthenticatedTransportLease(savedServerId: string): Promise<string>;
  openAuthenticatedDuplex(
    leaseHandle: string,
    channelId: string,
    purpose: AuthenticatedChannelPurpose,
  ): Promise<void>;
  sendAuthenticatedDuplex(leaseHandle: string, channelId: string, data: string): Promise<void>;
  closeAuthenticatedDuplex(
    leaseHandle: string,
    channelId: string,
    code: number,
    reason: string,
  ): void;
  authenticatedRequest(
    leaseHandle: string,
    purpose: AuthenticatedRequestPurpose,
    input: string,
  ): Promise<string>;
  releaseAuthenticatedTransportLease(leaseHandle: string): void;
};

type NativeLeaseEvent = {
  leaseHandle: string;
  channelId: string;
  type: "open" | "message" | "binary" | "close" | "error";
  data?: string;
  code?: number;
};

type ListenerMap = {
  open: Set<() => void>;
  message: Set<(event: { data: unknown }) => void>;
  close: Set<() => void>;
  error: Set<() => void>;
};

// WHY: React Native's module registry is untyped; this assertion narrows only the named bridge methods.
const bridge = NativeModules["CodeWideNative"] as NativeLeaseBridge | undefined;
const emitter =
  bridge === undefined ? null : new NativeEventEmitter(NativeModules["CodeWideNative"]);
const channels = new Map<string, NativeAuthenticatedDuplexChannel>();

class NativeAuthenticatedDuplexChannel implements AuthenticatedDuplexChannel {
  readyState = 0;
  readonly #leaseHandle: string;
  readonly #channelId: string;
  readonly #nativeBridge: NativeLeaseBridge;
  readonly #key: string;
  readonly #onFinish: () => void;
  readonly #listeners: ListenerMap = {
    open: new Set(),
    message: new Set(),
    close: new Set(),
    error: new Set(),
  };

  constructor(
    leaseHandle: string,
    channelId: string,
    purpose: AuthenticatedChannelPurpose,
    nativeBridge: NativeLeaseBridge,
    onFinish: () => void,
  ) {
    this.#leaseHandle = leaseHandle;
    this.#channelId = channelId;
    this.#nativeBridge = nativeBridge;
    this.#onFinish = onFinish;
    this.#key = channelKey(leaseHandle, channelId);
    channels.set(this.#key, this);
    void nativeBridge
      .openAuthenticatedDuplex(leaseHandle, channelId, purpose)
      .catch(() => this.fail());
  }

  addEventListener(type: "open", listener: () => void): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  addEventListener(type: "close", listener: () => void): void;
  addEventListener(type: "error", listener: () => void): void;
  addEventListener(
    type: keyof ListenerMap,
    listener: (() => void) | ((event: { data: unknown }) => void),
  ): void {
    if (type === "message") {
      // WHY: overload dispatch proves this branch receives the message listener shape.
      this.#listeners.message.add(listener as (event: { data: unknown }) => void);
    } else {
      // WHY: overload dispatch proves every non-message branch receives a zero-argument listener.
      this.#listeners[type].add(listener as () => void);
    }
  }

  send(data: string): void {
    if (this.readyState !== 1) throw new Error("Authenticated channel is not open");
    void this.#nativeBridge
      .sendAuthenticatedDuplex(this.#leaseHandle, this.#channelId, data)
      .catch(() => this.fail());
  }

  close(code = 1000, reason = "client_closed"): void {
    if (this.readyState >= 2) return;
    this.readyState = 2;
    this.#nativeBridge.closeAuthenticatedDuplex(this.#leaseHandle, this.#channelId, code, reason);
    this.finish();
  }

  receive(event: NativeLeaseEvent): void {
    if (this.readyState === 3) return;
    if (event.type === "open") {
      this.readyState = 1;
      for (const listener of this.#listeners.open) listener();
      return;
    }
    if (event.type === "message" || event.type === "binary") {
      for (const listener of this.#listeners.message) listener({ data: event.data });
      return;
    }
    if (event.type === "error") {
      for (const listener of this.#listeners.error) listener();
    }
    this.finish();
  }

  fail(): void {
    if (this.readyState === 3) return;
    for (const listener of this.#listeners.error) listener();
    this.finish();
  }

  private finish(): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    channels.delete(this.#key);
    this.#onFinish();
    for (const listener of this.#listeners.close) listener();
  }
}

emitter?.addListener("CodeWideAuthenticatedTransportEvent", (value: unknown) => {
  const event = parseNativeLeaseEvent(value);
  if (event !== null) channels.get(channelKey(event.leaseHandle, event.channelId))?.receive(event);
});

export async function acquireAuthenticatedTransportLease(
  savedServerId: string,
): Promise<AuthenticatedTransportLease> {
  if (bridge === undefined || Platform.OS !== "android")
    throw new Error("Authenticated transport leases are unavailable");
  if (savedServerId.length < 1 || savedServerId.length > 256)
    throw new Error("SavedServerId is invalid");
  const leaseHandle = await bridge.acquireAuthenticatedTransportLease(savedServerId);
  if (!uuidV4(leaseHandle)) throw new Error("Native authenticated lease handle is invalid");
  let released = false;
  const ownedChannels = new Set<NativeAuthenticatedDuplexChannel>();
  return {
    savedServerId,
    openDuplex(purpose) {
      if (released) throw new Error("Authenticated transport lease is released");
      const channel = new NativeAuthenticatedDuplexChannel(
        leaseHandle,
        globalThis.crypto.randomUUID(),
        purpose,
        bridge,
        () => ownedChannels.delete(channel),
      );
      ownedChannels.add(channel);
      return channel;
    },
    async request(purpose, input) {
      if (released) throw new Error("Authenticated transport lease is released");
      const raw = await bridge.authenticatedRequest(leaseHandle, purpose, JSON.stringify(input));
      return parseAuthenticatedResponse(raw);
    },
    async release() {
      if (released) return;
      released = true;
      for (const channel of ownedChannels) channel.close(1000, "lease_released");
      ownedChannels.clear();
      bridge.releaseAuthenticatedTransportLease(leaseHandle);
    },
  };
}

function parseNativeLeaseEvent(value: unknown): NativeLeaseEvent | null {
  let candidate: unknown = value;
  if (typeof candidate === "string") {
    try {
      candidate = JSON.parse(candidate);
    } catch {
      return null;
    }
  }
  if (candidate === null || typeof candidate !== "object") return null;
  const leaseHandle = Reflect.get(candidate, "leaseHandle");
  const channelId = Reflect.get(candidate, "channelId");
  const type = Reflect.get(candidate, "type");
  const data = Reflect.get(candidate, "data");
  const code = Reflect.get(candidate, "code");
  if (!uuidV4(leaseHandle) || !uuidV4(channelId)) return null;
  if (
    type !== "open" &&
    type !== "message" &&
    type !== "binary" &&
    type !== "close" &&
    type !== "error"
  )
    return null;
  if (data !== undefined && typeof data !== "string") return null;
  if (code !== undefined && (!Number.isInteger(code) || code < 0 || code > 4_999)) return null;
  return {
    leaseHandle,
    channelId,
    type,
    ...(data === undefined ? {} : { data }),
    ...(code === undefined ? {} : { code }),
  };
}

function parseAuthenticatedResponse(raw: string): AuthenticatedResponse {
  const value: unknown = JSON.parse(raw);
  if (value === null || typeof value !== "object")
    throw new Error("Authenticated response is invalid");
  const status = Reflect.get(value, "status");
  const contentType = Reflect.get(value, "contentType");
  const bodyBase64 = Reflect.get(value, "bodyBase64");
  if (
    !Number.isInteger(status) ||
    status < 100 ||
    status > 599 ||
    typeof contentType !== "string" ||
    typeof bodyBase64 !== "string"
  ) {
    throw new Error("Authenticated response is invalid");
  }
  return { status, contentType, bodyBase64 };
}

function channelKey(leaseHandle: string, channelId: string): string {
  return `${leaseHandle}:${channelId}`;
}

function uuidV4(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value)
  );
}
