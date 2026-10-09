import { useEffect } from "react";
import { readBrowserFavicon } from "../../native/browserFavicon";
import { useConstant } from "../../react/useConstant";
import { useEvent } from "../../react/useEvent";
import { BrowserFaviconSession } from "./browserFaviconSession";

/** Native page events drive reads; unmount only revokes that page's outstanding result. */
export function useBrowserFavicon(
  onFavicon: ((icon: string | null) => void) | undefined,
): BrowserFaviconSession {
  const publish = useEvent((icon: string | null) => onFavicon?.(icon));
  const read = useEvent(async (target: number, url: string): Promise<string | null> =>
    onFavicon === undefined ? Promise.resolve(null) : readBrowserFavicon(target, url),
  );
  const session = useConstant(() => new BrowserFaviconSession(read, publish));
  useEffect(
    () => () => {
      session.reset();
    },
    [session],
  );
  return session;
}
