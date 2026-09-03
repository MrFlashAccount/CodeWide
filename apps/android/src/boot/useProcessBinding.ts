import { useEffect } from "react";

/** Binds render callbacks to a process owner without transferring process lifetime to React. */
export function useProcessBinding(identity: string, bind: () => () => void): void {
  useEffect(() => bind(), [bind, identity]);
}
