import { Linking } from "react-native";

import { safeProviderUrl } from "../../../data/forgeProviderUrl";
import type { ExtraMenuItem } from "./OverflowActionsMenu";

/** "Open on <host>" only for an https page on the account's host; nothing for any other URL. */
export function openOnForge(webUrl: string, host: string): readonly ExtraMenuItem[] {
  const safe = safeProviderUrl(webUrl, host);
  if (safe === null) {
    return [];
  }
  return [
    {
      id: "open",
      label: `Open on ${host}`,
      onSelect: () => {
        // Without a browser the PR stays readable here.
        Linking.openURL(safe).catch(() => undefined);
      },
    },
  ];
}
