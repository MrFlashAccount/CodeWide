import { useQuery } from "@tanstack/react-query";

import type { ForgeProvider } from "../../../data/forgeContract";
import type { ConversationPage } from "../../../data/forgeConversationContract";
import type { OverviewParams } from "../../../data/forgeOverview";
import { forgeQueryRemoteValue } from "../../../data/forgeQueryResource";
import { remoteValue, type RemoteValue } from "../../../data/forgeRemoteValue";
import type { ForgeResources } from "../../../data/forgeResources";
import { useEvent } from "../../../react/useEvent";
import type { DirectImageSources } from "../../../rendering/directImageSources";
import { conversationImageSources, type ConversationImageOwner } from "./conversationImages";

/** Plugin capability that adds the conversation read and forge media. */
const CONVERSATION_CAPABILITY = "forge.conversation@1";
/** Plugin capability that adds top-level comments and thread replies. */
const COMMENTS_CAPABILITY = "forge.comments@1";

/**
 * What the Details tab shows in place of the activity list. `unsupported`
 * keeps the activity list: the plugin did not declare the conversation, or
 * this companion cannot serve it.
 */
export type PullRequestConversation =
  | { readonly status: "unsupported" }
  | { readonly status: "loading" }
  | {
      readonly message: string;
      readonly retry: () => void;
      readonly status: "failed";
    }
  | {
      /** `forge.comments@1` is declared, so comments and replies can be published. */
      readonly commentsEnabled: boolean;
      /** Images and avatars the plugin made directly loadable on the phone. */
      readonly images: DirectImageSources;
      readonly loadMore: (() => void) | null;
      readonly page: ConversationPage;
      readonly status: "ready";
    };

/**
 * Reads the conversation during render through the process-owned query when
 * the PR's plugin declares `forge.conversation@1`; otherwise the read never runs.
 * Android branches on declared capabilities only, never on the forge's name.
 */
export function usePullRequestConversation({
  forge,
  params,
  provider,
}: {
  readonly forge: Pick<ForgeResources, "conversation" | "loadMoreConversation">;
  readonly params: OverviewParams;
  readonly provider: ForgeProvider | null;
}): PullRequestConversation {
  const capabilities = provider?.capabilities ?? [];
  const declared = capabilities.includes(CONVERSATION_CAPABILITY);
  const query = useQuery(
    { ...forge.conversation.options(params), enabled: declared },
    forge.conversation.client,
  );
  const loadMore = useEvent((): void => {
    // A failed page keeps the entries already shown; the button stays to try again.
    forge.loadMoreConversation(params).catch(() => undefined);
  });
  const retry = useEvent((): void => {
    forge.conversation.refresh(params).catch(() => undefined);
  });
  const currentPage = useEvent((): ConversationPage | null => forge.conversation.data(params));
  // An expired signed image URL re-reads the conversation; joining an in-flight read keeps
  // several expired images on one read.
  const refreshImages = useEvent(async (): Promise<void> => {
    await forge.conversation.client.invalidateQueries(
      { exact: true, queryKey: forge.conversation.keyOf(params) },
      { cancelRefetch: false },
    );
  });
  if (!declared) {
    return { status: "unsupported" };
  }
  return conversationView(forgeQueryRemoteValue(query), {
    commentsEnabled: capabilities.includes(COMMENTS_CAPABILITY),
    images: {
      cacheScope: params.connectionId,
      current: currentPage,
      refresh: refreshImages,
    },
    loadMore,
    retry,
  });
}

/** Projects the declared conversation's query state into what the Details tab shows. */
function conversationView(
  live: RemoteValue<ConversationPage>,
  intents: {
    readonly commentsEnabled: boolean;
    readonly images: ConversationImageOwner;
    readonly loadMore: () => void;
    readonly retry: () => void;
  },
): PullRequestConversation {
  const page = remoteValue(live);
  if (page !== null) {
    return {
      commentsEnabled: intents.commentsEnabled,
      images: conversationImageSources(page, intents.images),
      loadMore: page.nextCursor === null ? null : intents.loadMore,
      page,
      status: "ready",
    };
  }
  if (live.status !== "failed") {
    return { status: "loading" };
  }
  // A companion without the method keeps the activity list instead of an error.
  if (live.failure.kind === "companionTooOld" || live.failure.kind === "capabilityUnavailable") {
    return { status: "unsupported" };
  }
  return {
    message: live.failure.message,
    retry: intents.retry,
    status: "failed",
  };
}
