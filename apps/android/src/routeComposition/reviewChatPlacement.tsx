import { useRouter } from "expo-router";
import { useLayoutEffect, useRef, useState } from "react";

import type { PullRequestKey } from "../data/forgeContract";
import { forgePageUrl, type ForgeLinkTarget, type LinkServer } from "../data/forgeLinkTargets";
import type { ReviewChatWorkspaceCandidate } from "../data/forgeMutationContract";
import { forgeResources } from "../data/forgeRuntime";
import type { ThreadId } from "../data/reviewContract";
import { workspaceFeatures } from "../features/workspace/createWorkspaceFeatures";
import { useEvent } from "../react/useEvent";
import { ServerIcon } from "../features/connections/ServerIcon";
import { listRowPosition } from "../ui/AppListRow.types";
import { AppListRow } from "../ui/AppListRow";
import { ForgeLinkPicker } from "./ForgeLinkPicker";
import { useAppDialog } from "../ui/AppDialog";
import { forgeLinkOptions } from "./forgeLinkOptions";
import { forgeTargetHref } from "./useOpenForgeLink";
import { linkedThreadSelectionKey, usePullRequestNavigation } from "./pullRequestNavigation";

interface Placement {
  readonly candidates: readonly ReviewChatWorkspaceCandidate[];
  readonly target: ForgeLinkTarget;
}

function placementKey(connectionId: string, pullRequest: PullRequestKey) {
  return ["reviewChatPlacement", connectionId, pullRequest];
}

/** Suggestions already obtained from the selected server before navigation into its empty draft. */
export function reviewChatRouteOptions(
  mode: string,
  target: { readonly connectionId: string; readonly pullRequest: PullRequestKey },
): {
  readonly composeReview: boolean;
  readonly initialProjects: readonly ReviewChatWorkspaceCandidate[];
} {
  if (mode !== "placed") {
    return { composeReview: mode === "1", initialProjects: [] };
  }
  const initialProjects =
    forgeResources.queryClient.getQueryData<readonly ReviewChatWorkspaceCandidate[]>(
      placementKey(target.connectionId, target.pullRequest),
    ) ?? [];
  return { composeReview: true, initialProjects };
}

/** Consult eligible servers only on chat intent. An existing linked thread takes precedence over creating a draft. */
export function useReviewChatPlacement(input: {
  readonly active: boolean;
  readonly connectionId: string;
  readonly fromChat: boolean;
  readonly link: string | null;
  readonly openChat: (thread: ThreadId | null) => void;
  readonly openDraft: (projects: readonly ReviewChatWorkspaceCandidate[]) => void;
  readonly prepareThread: (key: string) => void;
  readonly pullRequest: PullRequestKey;
  readonly servers: readonly LinkServer[];
}): {
  readonly open: (thread: ThreadId | null) => void;
  readonly picker: React.JSX.Element | null;
} {
  const router = useRouter();
  const navigation = usePullRequestNavigation();
  const dialog = useAppDialog();
  const [placements, setPlacements] = useState<readonly Placement[]>([]);
  const attempt = useRef(0);
  useLayoutEffect(
    () => () => {
      attempt.current++;
    },
    [input.active, input.connectionId, input.pullRequest],
  );
  const choose = useEvent((choice: Placement): void => {
    setPlacements([]);
    if (!input.active) {
      return;
    }
    if (choice.target.connectionId === input.connectionId) {
      input.openDraft(choice.candidates);
      return;
    }
    const url = forgePageUrl(input.link ?? "");
    if (url === null) {
      return;
    }
    forgeResources.queryClient.setQueryData(
      placementKey(choice.target.connectionId, choice.target.pullRequest),
      choice.candidates,
    );
    const href = forgeTargetHref(choice.target, url, input.fromChat);
    router.replace({ ...href, params: { ...href.params, composeReview: "placed" } });
  });
  const openExisting = useEvent((target: ForgeLinkTarget, thread: ThreadId): void => {
    if (target.connectionId === input.connectionId) {
      input.openChat(thread);
    } else {
      input.prepareThread(linkedThreadSelectionKey(target.connectionId, thread));
      navigation.navigateToLinkedThread(target.connectionId, thread, target.pullRequest);
    }
  });
  const presentChoices = useEvent((choices: readonly Placement[]): void => {
    if (choices.length > 1) {
      setPlacements(choices);
    } else if (choices[0] !== undefined) {
      choose(choices[0]);
    } else {
      dialog.alert(
        "Review chat unavailable",
        "No server could open the review chat. Check the connection and try again.",
      );
    }
  });
  const open = useEvent((thread: ThreadId | null): void => {
    const url = forgePageUrl(input.link ?? "");
    if (
      thread !== null ||
      url === null ||
      input.servers.filter((server) => server.enabled).length <= 1
    ) {
      input.openChat(thread);
      return;
    }
    const id = ++attempt.current;
    const run = async (): Promise<void> => {
      const matches = await forgeResources.queryClient.query(
        forgeLinkOptions(input.servers, url, null),
      );
      const peers = matches.filter((target) => target.pullRequest === input.pullRequest);
      const outcomes = await Promise.all(
        peers.map(async (target) => ({
          opening: await workspaceFeatures.pullRequestDetail
            .ensureReviewChat(target, { kind: "ask" })
            .catch(() => null),
          target,
        })),
      );
      if (attempt.current !== id) {
        return;
      }
      const choices: Placement[] = [];
      for (const { opening, target } of outcomes) {
        if (opening?.kind === "ready") {
          openExisting(target, opening.threadId);
          return;
        }
        if (opening?.kind === "needsWorkspace") {
          choices.push({ candidates: opening.candidates, target });
        }
      }
      presentChoices(choices);
    };
    void run().catch((error: unknown) => {
      if (attempt.current === id) {
        dialog.error("Could not open the review chat", error);
      }
    });
  });
  const closePicker = useEvent(() => {
    setPlacements([]);
  });
  const first = placements[0];
  const picker =
    first === undefined ? null : (
      <ForgeLinkPicker close={closePicker} target={first.target} title="Start chat on">
        {placements.map((choice, index) => (
          <AppListRow
            description={
              choice.target.connectionId === input.connectionId
                ? "Viewing this pull request here"
                : `@${choice.target.login}`
            }
            key={choice.target.connectionId}
            leading={<ServerIcon iconId={choice.target.serverIconId} />}
            onPress={() => {
              choose(choice);
            }}
            position={listRowPosition(index, placements.length)}
            title={choice.target.server}
            trailingIcon={{ name: "chevron-forward" }}
          />
        ))}
      </ForgeLinkPicker>
    );
  return { open, picker };
}
