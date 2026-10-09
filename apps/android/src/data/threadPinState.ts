import { unknownRecord } from "./unknownRecord";

/** Server-owned pin state ordered by the Companion replay cursor. */
export type ThreadPinState = {
  readonly cursor: number;
  readonly pinned: boolean;
};

/** Replay cursors are nonnegative safe integers at the JS boundary. */
export function validPinCursor(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** Rejects malformed pin metadata; missing server state means unpinned. */
export function threadPinFromSnapshot(thread: unknown): ThreadPinState {
  const pin = unknownRecord(unknownRecord(unknownRecord(thread)?.codewide)?.threadPin);
  return pin?.version === 1 && typeof pin.pinned === "boolean" && validPinCursor(pin.cursor)
    ? { cursor: pin.cursor, pinned: pin.pinned }
    : { cursor: 0, pinned: false };
}
