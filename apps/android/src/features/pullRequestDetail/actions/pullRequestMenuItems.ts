import { setStringAsync } from "expo-clipboard";
import { Linking, Share } from "react-native";

import { pullRequestPageUrl } from "../../../data/forgeProviderUrl";
import type { PullRequestOverview } from "../../../data/forgePullRequestContract";
import type { ExtraMenuItem } from "./OverflowActionsMenu";

/**
 * Offers the displayed number and title for copying and the Companion-approved page for link
 * actions. The account host stands in until the provider's name is available.
 */
export function pullRequestMenuItems({
  forgeName,
  host,
  onError,
  overview,
}: {
  readonly forgeName: string | null;
  readonly host: string;
  readonly onError: (title: string, error: unknown) => void;
  readonly overview: Pick<PullRequestOverview, "number" | "title" | "webUrl">;
}): readonly ExtraMenuItem[] {
  function copy(value: string, errorTitle: string): void {
    setStringAsync(value).catch((error: unknown) => {
      onError(errorTitle, error);
    });
  }
  const metadata: readonly ExtraMenuItem[] = [
    {
      icon: "copy-outline",
      id: "copyId",
      label: "Copy ID",
      onSelect: () => {
        copy(overview.number, "Could not copy the ID");
      },
    },
    {
      icon: "text-outline",
      id: "copyTitle",
      label: "Copy title",
      onSelect: () => {
        copy(overview.title, "Could not copy the title");
      },
    },
  ];
  const safe = pullRequestPageUrl(overview);
  if (safe === null) {
    return metadata;
  }
  return [
    {
      icon: "link-outline",
      id: "copyLink",
      label: "Copy link",
      onSelect: () => {
        copy(safe, "Could not copy the link");
      },
    },
    {
      icon: "share-social-outline",
      id: "share",
      label: "Share",
      onSelect: () => {
        Share.share({ message: safe, url: safe }).catch((error: unknown) => {
          onError("Could not share the link", error);
        });
      },
    },
    ...metadata,
    {
      icon: "open-outline",
      id: "open",
      label: `Open in ${forgeName ?? host}`,
      onSelect: () => {
        // Without a browser the PR stays readable here.
        Linking.openURL(safe).catch(() => undefined);
      },
    },
  ];
}
