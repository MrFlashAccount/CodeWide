import { Pressable, Text } from "react-native";

import type { DeferReviewChatScenario } from "../../src/features/pullRequestDetail/pullRequestScreenContract";

type DeferredScenario = Parameters<DeferReviewChatScenario>[0];

/** The scenario the next `defer-review-scenario` press defers, and what that deferral settled. */
export const routeScreenScenario: {
  request: DeferredScenario | null;
  result: ReturnType<DeferReviewChatScenario> | null;
} = { request: null, result: null };

type PullRequestRouteScreenNavigation = {
  readonly back: () => void;
  readonly closeChanges: () => void;
  readonly deferReviewChatScenario: DeferReviewChatScenario;
  readonly openPullRequestFullscreen: (() => void) | null;
  readonly openReviewChat: (reviewThread: string | null) => void;
  readonly openChanges: (view: "files" | "guide") => void;
  readonly openThread: (threadId: string) => void;
  readonly pullRequestFullscreen: boolean;
};

/** Minimal PR detail surface exposing route intents to route-composition render tests. */
export function PullRequestScreen({
  navigation,
}: {
  readonly navigation: PullRequestRouteScreenNavigation;
}): React.JSX.Element {
  return (
    <>
      <Pressable accessibilityRole="button" onPress={navigation.back} testID="close-pull-request">
        <Text>Close pull request</Text>
      </Pressable>
      <Pressable
        onPress={() => {
          navigation.openChanges("files");
        }}
        testID="open-changes"
      >
        <Text>Open changes</Text>
      </Pressable>
      <Pressable
        onPress={() => {
          navigation.openChanges("guide");
        }}
        testID="open-guide"
      >
        <Text>Open guide</Text>
      </Pressable>
      <Pressable onPress={navigation.closeChanges} testID="open-details">
        <Text>Open details</Text>
      </Pressable>
      <Pressable
        onPress={() => {
          navigation.openThread("linked-thread");
        }}
        testID="open-linked-thread"
      >
        <Text>Open linked thread</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          navigation.openReviewChat(null);
        }}
        testID="open-review-chat"
      >
        <Text>Open review chat</Text>
      </Pressable>
      <Pressable
        onPress={() => {
          navigation.openReviewChat("existing-thread");
        }}
        testID="open-existing-review-chat"
      >
        <Text>Open existing review chat</Text>
      </Pressable>
      <Pressable
        onPress={() => {
          const request = routeScreenScenario.request;
          if (request !== null) {
            routeScreenScenario.result = navigation.deferReviewChatScenario(request);
          }
        }}
        testID="defer-review-scenario"
      >
        <Text>Defer review scenario</Text>
      </Pressable>
      {navigation.openPullRequestFullscreen === null ? null : (
        <Pressable
          accessibilityLabel={
            navigation.pullRequestFullscreen
              ? "Exit pull request fullscreen"
              : "Open pull request fullscreen"
          }
          accessibilityRole="button"
          onPress={navigation.openPullRequestFullscreen}
        >
          <Text>Toggle pull request fullscreen</Text>
        </Pressable>
      )}
    </>
  );
}
