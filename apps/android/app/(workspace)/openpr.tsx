import { useQuery } from "@tanstack/react-query";
import { Redirect, useIsFocused, useLocalSearchParams, useRouter } from "expo-router";

import { RouteUnavailable } from "../../src/components/navigation/RouteUnavailable";
import {
  ForgeLinkUnsupportedError,
  forgePageUrl,
  groupForgeLinkTargets,
  type ForgeLinkTarget,
} from "../../src/data/forgeLinkTargets";
import { forgeResources } from "../../src/data/forgeRuntime";
import { useEvent } from "../../src/react/useEvent";
import { forgeLinkOptions } from "../../src/routeComposition/forgeLinkOptions";
import { forgeTargetHref } from "../../src/routeComposition/useOpenForgeLink";
import { useWorkspaceRouteResources } from "../../src/services/workspace/workspaceRouteResources";
import { ForgeLinkPicker } from "../../src/routeComposition/ForgeLinkPicker";
import { ServerIcon } from "../../src/features/connections/ServerIcon";
import { listRowPosition } from "../../src/ui/AppListRow.types";
import { AppListRow } from "../../src/ui/AppListRow";
import { PullRequestScreenSkeleton } from "../../src/features/pullRequestDetail/PullRequestScreenSkeleton";
import { SafeAreaView } from "react-native-safe-area-context";
import { StyleSheet } from "react-native";
import { colors } from "../../src/theme";
import { startupSurfaceProps } from "../../src/boot/startupSplash";
import { useAppNotice } from "../../src/ui/useAppNotice";

/** Receives an explicit Android share or an ambiguous in-app link. Only the plugin interprets its path. */
export default function SharedPullRequest(): React.JSX.Element {
  const params = useLocalSearchParams<{ fromChat?: string; origin?: string; url?: string }>();
  const router = useRouter();
  const close = useEvent(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/");
    }
  });
  const url = typeof params.url === "string" ? forgePageUrl(params.url) : null;
  return url === null ? (
    <RouteUnavailable
      message="Share one HTTPS pull request link to open it in CodeWide."
      onBack={close}
      title="Share a pull request"
    />
  ) : (
    <ResolveLink
      close={close}
      fromChat={params.fromChat === "1"}
      origin={params.origin ?? null}
      url={url}
    />
  );
}

function ResolveLink({
  close,
  fromChat,
  origin,
  url,
}: {
  readonly close: () => void;
  readonly fromChat: boolean;
  readonly origin: string | null;
  readonly url: URL;
}): React.JSX.Element {
  const { list, runtime } = useWorkspaceRouteResources();
  const notice = useAppNotice();
  const router = useRouter();
  const active = useIsFocused();
  const result = useQuery(
    {
      ...forgeLinkOptions(list.settingsConnections, url, origin),
      enabled: runtime.ready && active,
    },
    forgeResources.queryClient,
  );
  const choose = useEvent((target: ForgeLinkTarget) => {
    if (!active) {
      return;
    }
    if (origin !== null && target.connectionId !== origin) {
      notice.show({ label: `Opened via ${target.server}`, variant: "info" });
    }
    router.replace(forgeTargetHref(target, url, fromChat), { withAnchor: true });
  });
  if (result.error instanceof ForgeLinkUnsupportedError) {
    return (
      <RouteUnavailable
        message={`Update the ${result.error.provider} plugin on your Companion to open shared pull request links.`}
        onBack={close}
        title="Provider update needed"
      />
    );
  }
  if (result.isError) {
    return (
      <RouteUnavailable
        actionLabel="Retry"
        message="Check the server connection and try again."
        onBack={() => {
          result.refetch().catch(() => undefined);
        }}
        title="Could not check access"
      />
    );
  }
  if (result.data?.length === 0) {
    return (
      <RouteUnavailable
        message="No available account can open this pull request. Check the accounts in Pull requests settings."
        onBack={close}
        title="No matching account"
      />
    );
  }
  return (
    <ResolvedAccounts
      choose={choose}
      close={close}
      fromChat={fromChat}
      targets={result.data ?? []}
      url={url}
    />
  );
}

function ResolvedAccounts({
  choose,
  close,
  fromChat,
  targets,
  url,
}: {
  readonly choose: (target: ForgeLinkTarget) => void;
  readonly close: () => void;
  readonly fromChat: boolean;
  readonly targets: readonly ForgeLinkTarget[];
  readonly url: URL;
}): React.JSX.Element {
  const groups = groupForgeLinkTargets(targets);
  const firstTarget = groups[0]?.[0];
  if (firstTarget === undefined) {
    return (
      <SafeAreaView {...startupSurfaceProps} style={styles.loading}>
        <PullRequestScreenSkeleton />
      </SafeAreaView>
    );
  }
  if (groups.length === 1) {
    return <Redirect href={forgeTargetHref(firstTarget, url, fromChat)} withAnchor />;
  }
  return (
    <ForgeLinkPicker close={close} target={firstTarget} title="Choose account">
      {groups.map((group, index) => {
        const first = group[0];
        return (
          <AppListRow
            description={group.map((target) => target.server).join(" · ")}
            descriptionLeading={
              group.length === 1 ? (
                <ServerIcon iconId={first.serverIconId} metric="label" />
              ) : undefined
            }
            key={first.pullRequest}
            leadingIcon={{ name: "person-circle-outline" }}
            onPress={() => {
              choose(first);
            }}
            position={listRowPosition(index, groups.length)}
            title={`@${first.login} · ${first.provider}`}
            trailingIcon={{ name: "chevron-forward" }}
          />
        );
      })}
    </ForgeLinkPicker>
  );
}

const styles = StyleSheet.create({
  loading: {
    backgroundColor: colors.background,
    flex: 1,
  },
});
