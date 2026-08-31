export type SavedServerId = string & { readonly __savedServerId: unique symbol };
export type ThreadId = string & { readonly __threadId: unique symbol };

export function savedServerId(value: string): SavedServerId {
  if (value.length < 1 || value.length > 256) {
    throw new Error("SavedServerId is invalid");
  }
  return value as SavedServerId;
}

export function threadId(value: string): ThreadId {
  if (value.length < 1 || value.length > 256) {
    throw new Error("ThreadId is invalid");
  }
  return value as ThreadId;
}
