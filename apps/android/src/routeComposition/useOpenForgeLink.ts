import { useRouter } from "expo-router";
import { useRef } from "react";
import { Linking } from "react-native";

import {
  forgePageUrl,
  groupForgeLinkTargets,
  type LinkServer,
  type ForgeLinkTarget,
} from "../data/forgeLinkTargets";
import { forgeResources } from "../data/forgeRuntime";
import { useEvent } from "../react/useEvent";
import { useAppNotice } from "../ui/useAppNotice";
import { forgeLinkOptions } from "./forgeLinkOptions";

/** Carries the verified account-bound key and enough context to discover a review-chat server on demand. */
export function forgeTargetHref(
  target: ForgeLinkTarget,
  link: URL,
  fromChat: boolean,
): {
  readonly params: {
    readonly catalogPullRequestKey: string;
    readonly connectionId: string;
    readonly fromChat: string;
    readonly link: string;
    readonly pullRequestKey: string;
  };
  readonly pathname: "/pulls/[connectionId]/[pullRequestKey]";
} {
  return {
    params: {
      catalogPullRequestKey: target.canonical,
      connectionId: target.connectionId,
      fromChat: fromChat ? "1" : "0",
      link: link.href,
      pullRequestKey: target.pullRequest,
    },
    pathname: "/pulls/[connectionId]/[pullRequestKey]",
  } as const;
}

/** Preserve ordinary browser navigation when no provider recognizes the link. Newer taps supersede older reads. */
export function useOpenForgeLink(
  servers: readonly LinkServer[],
): (href: string, origin: string | null) => boolean {
  const router = useRouter();
  const notice = useAppNotice();
  const attempt = useRef(0);
  const open = useEvent((href: string, origin: string | null): boolean => {
    const url = forgePageUrl(href);
    if (url === null || !servers.some((server) => server.enabled)) {
      return false;
    }
    const id = ++attempt.current;
    const run = async (): Promise<void> => {
      const targets = await forgeResources.queryClient
        .query(forgeLinkOptions(servers, url, origin))
        .catch(() => []);
      if (attempt.current !== id) {
        return;
      }
      const groups = groupForgeLinkTargets(targets);
      const target = groups[0]?.[0];
      if (target === undefined) {
        await Linking.openURL(href);
        return;
      }
      if (groups.length > 1) {
        router.push({
          params: { url: url.href, ...(origin === null ? {} : { origin }), fromChat: "1" },
          pathname: "/openpr",
        });
        return;
      }
      if (origin !== null && origin !== target.connectionId) {
        notice.show({ label: `Opened via ${target.server}`, variant: "info" });
      }
      router.push(forgeTargetHref(target, url, true), { withAnchor: true });
    };
    void run().catch(() => {
      notice.show({ label: "Could not open this link", variant: "error" });
    });
    return true;
  });
  return open;
}
