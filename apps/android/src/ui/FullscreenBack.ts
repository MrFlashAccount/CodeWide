import { createContext, useContext } from "react";

/**
 * The Back owner of one fullscreen modal window. Its native dialog receives
 * Android Back instead of the Activity, so the surfaces inside it register here
 * rather than with `BackHandler`; the newest handler takes Back first, and the
 * modal closes itself when none is registered.
 */
export class FullscreenBackStack {
  private readonly handlers: (() => void)[] = [];

  /** Adds a Back handler above the others; the returned function removes it. */
  register(handler: () => void): () => void {
    this.handlers.push(handler);
    return () => {
      const index = this.handlers.lastIndexOf(handler);
      if (index !== -1) {
        this.handlers.splice(index, 1);
      }
    };
  }

  /** Runs the newest handler; `false` when no surface claims Back. */
  handleBack(): boolean {
    const handler = this.handlers.at(-1);
    if (handler === undefined) {
      return false;
    }
    handler();
    return true;
  }
}

const FullscreenBackContext = createContext<FullscreenBackStack | null>(null);

/** Provides the Back owner of the fullscreen modal the children render in. */
export const FullscreenBackProvider = FullscreenBackContext.Provider;

/** The Back owner of the enclosing fullscreen modal, or `null` outside one. */
export function useFullscreenBack(): FullscreenBackStack | null {
  return useContext(FullscreenBackContext);
}
