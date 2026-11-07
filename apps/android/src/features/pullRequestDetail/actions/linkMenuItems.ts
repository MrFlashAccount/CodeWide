import { setStringAsync } from "expo-clipboard";
import { Linking, Share } from "react-native";

import { safeProviderUrl } from "../../../data/forgeProviderUrl";
import type { ExtraMenuItem } from "./OverflowActionsMenu";

/**
 * Copy link, Share and "Open in <forge>" for the pull request's page, only when it is an https
 * page on the account's host; nothing for any other URL, so no foreign link is copied, shared or
 * opened. `forgeName` is the plugin's declared name; the host stands in until the accounts
 * snapshot names it. A failed copy or share reports the real error through `onError`.
 */
export function linkMenuItems({
  forgeName,
  host,
  onError,
  webUrl,
}: {
  readonly forgeName: string | null;
  readonly host: string;
  readonly onError: (title: string, error: unknown) => void;
  readonly webUrl: string;
}): readonly ExtraMenuItem[] {
  const safe = safeProviderUrl(webUrl, host);
  if (safe === null) {
    return [];
  }
  return [
    {
      id: "copyLink",
      label: "Copy link",
      onSelect: () => {
        setStringAsync(safe).catch((error: unknown) => {
          onError("Could not copy the link", error);
        });
      },
    },
    {
      id: "share",
      label: "Share",
      onSelect: () => {
        Share.share({ message: safe, url: safe }).catch((error: unknown) => {
          onError("Could not share the link", error);
        });
      },
    },
    {
      id: "open",
      label: `Open in ${forgeName ?? host}`,
      onSelect: () => {
        // Without a browser the PR stays readable here.
        Linking.openURL(safe).catch(() => undefined);
      },
    },
  ];
}
