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
  acquireAuthenticatedTransportLease: (savedServerId: string) => Promise<string>;
  addListener: (eventName: string) => void;
  authenticatedRequest: (
    leaseHandle: string,
    purpose: AuthenticatedRequestPurpose,
    input: string,
  ) => Promise<string>;
  // WHY: This signature mirrors an established storage or native compatibility contract; parameter order is part of every current implementation and caller.
  // oxlint-disable-next-line eslint/max-params
  closeAuthenticatedDuplex: (
    leaseHandle: string,
    channelId: string,
    code: number,
    reason: string,
  ) => void;
  openAuthenticatedDuplex: (
    leaseHandle: string,
    channelId: string,
    purpose: AuthenticatedChannelPurpose,
  ) => Promise<void>;
  releaseAuthenticatedTransportLease: (leaseHandle: string) => void;
  removeListeners: (count: number) => void;
  sendAuthenticatedDuplex: (leaseHandle: string, channelId: string, data: string) => Promise<void>;
};

type NativeLeaseEvent = {
  channelId: string;
  code?: number;
  data?: string;
  leaseHandle: string;
  type: "open" | "message" | "binary" | "close" | "error";
};

type ListenerMap = {
  close: Set<() => void>;
  error: Set<() => void>;
  message: Set<(event: { data: unknown }) => void>;
  open: Set<() => void>;
};

// WHY: React Native's module registry is untyped; this assertion narrows only the named bridge methods.
// oxlint-disable-next-line typescript/no-unsafe-type-assertion
const bridge = NativeModules.CodeWideNative as NativeLeaseBridge | undefined;
const emitter = bridge === undefined ? null : new NativeEventEmitter(bridge);
const channels = new Map<string, NativeAuthenticatedDuplexChannel>();

class NativeAuthenticatedDuplexChannel implements AuthenticatedDuplexChannel {
  readyState = 0;
  readonly #leaseHandle: string;
  readonly #channelId: string;
  readonly #nativeBridge: NativeLeaseBridge;
  readonly #key: string;
  readonly #onFinish: () => void;
  readonly #listeners: ListenerMap = {
    close: new Set(),
    error: new Set(),
    message: new Set(),
    open: new Set(),
  };

  // WHY: This signature mirrors an established storage or native compatibility contract; parameter order is part of every current implementation and caller.
  // oxlint-disable-next-line eslint/max-params
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
    void nativeBridge.openAuthenticatedDuplex(leaseHandle, channelId, purpose).catch(() => {
      this.fail();
    });
  }

  addEventListener(type: "open", listener: () => void): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  addEventListener(type: "close", listener: () => void): void;
  addEventListener(type: "error", listener: () => void): void;
  addEventListener(
    ...args:
      | [type: "open" | "close" | "error", listener: () => void]
      | [type: "message", listener: (event: { data: unknown }) => void]
  ): void {
    const [type, listener] = args;
    if (type === "message") {
      // WHY: overload dispatch proves this branch receives the message listener shape.
      this.#listeners.message.add(listener);
    } else if (type === "open") {
      this.#listeners.open.add(listener);
    } else if (type === "close") {
      this.#listeners.close.add(listener);
    } else {
      this.#listeners.error.add(listener);
    }
  }

  send(data: string): void {
    if (this.readyState !== 1) {
      throw new Error("Authenticated channel is not open");
    }
    void this.#nativeBridge
      .sendAuthenticatedDuplex(this.#leaseHandle, this.#channelId, data)
      .catch(() => {
        this.fail();
      });
  }

  close(code = 1000, reason = "client_closed"): void {
    if (this.readyState >= 2) {
      return;
    }
    this.readyState = 2;
    this.#nativeBridge.closeAuthenticatedDuplex(this.#leaseHandle, this.#channelId, code, reason);
    this.finish();
  }

  // WHY: One channel instance owns the ordered native lifecycle transition and listener delivery;
  // splitting event branches could publish data after close or finish the lease twice.
  // oxlint-disable-next-line eslint/complexity
  receive(event: NativeLeaseEvent): void {
    if (this.readyState === 3) {
      return;
    }
    if (event.type === "open") {
      this.readyState = 1;
      for (const listener of this.#listeners.open) {
        listener();
      }
      return;
    }
    if (event.type === "message" || event.type === "binary") {
      for (const listener of this.#listeners.message) {
        listener({ data: event.data });
      }
      return;
    }
    if (event.type === "error") {
      for (const listener of this.#listeners.error) {
        listener();
      }
    }
    this.finish();
  }

  fail(): void {
    if (this.readyState === 3) {
      return;
    }
    for (const listener of this.#listeners.error) {
      listener();
    }
    this.finish();
  }

  private finish(): void {
    if (this.readyState === 3) {
      return;
    }
    this.readyState = 3;
    channels.delete(this.#key);
    this.#onFinish();
    for (const listener of this.#listeners.close) {
      listener();
    }
  }
}

emitter?.addListener("CodeWideAuthenticatedTransportEvent", (value: unknown) => {
  const event = parseNativeLeaseEvent(value);
  if (event !== null) {
    channels.get(channelKey(event.leaseHandle, event.channelId))?.receive(event);
  }
});

export async function acquireAuthenticatedTransportLease(
  savedServerId: string,
): Promise<AuthenticatedTransportLease> {
  if (bridge === undefined || Platform.OS !== "android") {
    throw new Error("Authenticated transport leases are unavailable");
  }
  if (savedServerId.length < 1 || savedServerId.length > 256) {
    throw new Error("SavedServerId is invalid");
  }
  const leaseHandle = await bridge.acquireAuthenticatedTransportLease(savedServerId);
  if (!uuidV4(leaseHandle)) {
    throw new Error("Native authenticated lease handle is invalid");
  }
  let released = false;
  const ownedChannels = new Set<NativeAuthenticatedDuplexChannel>();
  return {
    openDuplex(purpose) {
      if (released) {
        throw new Error("Authenticated transport lease is released");
      }
      const channel = new NativeAuthenticatedDuplexChannel(
        leaseHandle,
        globalThis.crypto.randomUUID(),
        purpose,
        bridge,
        () => {
          ownedChannels.delete(channel);
        },
      );
      ownedChannels.add(channel);
      return channel;
    },
    async release() {
      await Promise.resolve().then(() => {
        if (released) {
          return;
        }
        released = true;
        for (const channel of ownedChannels) {
          channel.close(1000, "lease_released");
        }
        ownedChannels.clear();
        bridge.releaseAuthenticatedTransportLease(leaseHandle);
      });
    },
    async request(purpose, input) {
      if (released) {
        throw new Error("Authenticated transport lease is released");
      }
      const raw = await bridge.authenticatedRequest(leaseHandle, purpose, JSON.stringify(input));
      return parseAuthenticatedResponse(raw);
    },
    savedServerId,
  };
}

// WHY: This boundary validates and constructs one complete persisted or native payload atomically; its field precedence must remain in one owner.
// oxlint-disable-next-line eslint/complexity
function parseNativeLeaseEvent(value: unknown): NativeLeaseEvent | null {
  let candidate: unknown = value;
  if (typeof candidate === "string") {
    try {
      candidate = JSON.parse(candidate);
    } catch {
      return null;
    }
  }
  if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) {
    return null;
  }
  const leaseHandle = "leaseHandle" in candidate ? candidate.leaseHandle : undefined;
  const channelId = "channelId" in candidate ? candidate.channelId : undefined;
  const type = "type" in candidate ? candidate.type : undefined;
  const data = "data" in candidate ? candidate.data : undefined;
  const code = "code" in candidate ? candidate.code : undefined;
  if (!uuidV4(leaseHandle) || !uuidV4(channelId)) {
    return null;
  }
  if (
    type !== "open" &&
    type !== "message" &&
    type !== "binary" &&
    type !== "close" &&
    type !== "error"
  ) {
    return null;
  }
  if (data !== undefined && typeof data !== "string") {
    return null;
  }
  if (
    code !== undefined &&
    (typeof code !== "number" || !Number.isInteger(code) || code < 0 || code > 4999)
  ) {
    return null;
  }
  return {
    channelId,
    leaseHandle,
    type,
    ...(data === undefined ? {} : { data }),
    ...(code === undefined ? {} : { code }),
  };
}

// WHY: This boundary validates and constructs one complete persisted or native payload atomically; its field precedence must remain in one owner.
// oxlint-disable-next-line eslint/complexity
function parseAuthenticatedResponse(raw: string): AuthenticatedResponse {
  const value: unknown = JSON.parse(raw);
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Authenticated response is invalid");
  }
  const status = "status" in value ? value.status : undefined;
  const contentType = "contentType" in value ? value.contentType : undefined;
  const bodyBase64 = "bodyBase64" in value ? value.bodyBase64 : undefined;
  if (
    typeof status !== "number" ||
    !Number.isInteger(status) ||
    status < 100 ||
    status > 599 ||
    typeof contentType !== "string" ||
    typeof bodyBase64 !== "string"
  ) {
    throw new Error("Authenticated response is invalid");
  }
  return { bodyBase64, contentType, status };
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
