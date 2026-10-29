import { act, fireEvent, render, within } from "@testing-library/react-native";
import * as Clipboard from "expo-clipboard";
import { KeyboardAvoidingView, StyleSheet } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
  State,
} from "react-native-gesture-handler";
import { fireGestureHandler } from "react-native-gesture-handler/jest-utils";

import {
  parseForgeAccounts,
  type AuthStartResult,
  type ForgeAccountsSnapshot,
} from "../src/data/forgeContract";
import { parsePullRequestListPage } from "../src/data/forgePullRequestContract";
import { createForgeResources } from "../src/data/forgeResources";
import { PullRequestsCatalog } from "../src/features/pullRequests/PullRequestsFeature";
import { OnboardingScreen } from "../src/features/pullRequests/onboarding/OnboardingScreen";
import {
  defaultPullRequestFilter,
  forgeAccountsSheetOpen,
  pullRequestListModel,
} from "../src/features/pullRequests/pullRequestListModel";
import type { PullRequestsWorkspaceCapabilities } from "../src/features/pullRequests/workspaceCapabilities";
import { Tray } from "../src/vendor/reacticx/tray";
import { shouldMountTrayView } from "../vendor/reacticx/src/components/organisms/tray/helper";
import {
  connectedAccount,
  githubProvider,
  hostLoginFlow,
  onboardingAccounts,
  reviewRequestedPage,
} from "./fixtures/forgeWireFixtures";
import { createMemoryQueryPersister } from "./fixtures/queryPersister";

const MULTIPLE_PROVIDERS = requiredSnapshot(onboardingAccounts);
const SINGLE_PROVIDER = requiredSnapshot({
  ...onboardingAccounts,
  providers: [githubProvider],
});
const HOST_LOGIN = requiredSnapshot({
  ...onboardingAccounts,
  flows: [hostLoginFlow],
  providers: [githubProvider],
});
const CONNECTED_ACCOUNT = requiredSnapshot({
  ...onboardingAccounts,
  accounts: [connectedAccount],
  providers: [githubProvider],
}).accounts[0];
const CONNECTED_SNAPSHOT = requiredSnapshot({
  ...onboardingAccounts,
  accounts: [connectedAccount],
  providers: [githubProvider],
});
const CONNECTED_MULTIPLE_PROVIDERS = requiredSnapshot({
  ...onboardingAccounts,
  accounts: [connectedAccount],
});

afterEach(() => {
  forgeAccountsSheetOpen.set(false);
  pullRequestListModel.set(defaultPullRequestFilter());
});

if (CONNECTED_ACCOUNT === undefined) {
  throw new Error("The connected account fixture is invalid");
}

function requiredSnapshot(value: unknown): ForgeAccountsSnapshot {
  const snapshot = parseForgeAccounts(value);
  if (snapshot === null) {
    throw new Error("The pull request onboarding fixture is invalid");
  }
  return snapshot;
}

function capabilities(_snapshot: ForgeAccountsSnapshot): PullRequestsWorkspaceCapabilities {
  return {
    cancelAuth: () => Promise.resolve(),
    checkAgain: () => Promise.resolve(),
    disconnect: () => Promise.resolve(),
    setAccountEnabled: () => Promise.reject(new Error("Not used by this render test")),
    startAuth: () => Promise.reject(new Error("Not used by this render test")),
    submitToken: () => Promise.reject(new Error("Not used by this render test")),
  };
}

function renderWelcome(
  snapshot: ForgeAccountsSnapshot,
  workspaceCapabilities = capabilities(snapshot),
  onTrayOpenChange: (open: boolean) => void = () => undefined,
): ReturnType<typeof render> {
  return render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { height: 800, width: 400, x: 0, y: 0 },
        insets: { bottom: 0, left: 0, right: 0, top: 0 },
      }}
    >
      <OnboardingScreen
        capabilities={workspaceCapabilities}
        connectionId="server"
        onTrayOpenChange={onTrayOpenChange}
        snapshot={snapshot}
      />
    </SafeAreaProvider>,
  );
}

function forgeResources() {
  return createForgeResources({
    getSession: () => undefined,
    persister: createMemoryQueryPersister().persister,
    reportDroppedAction: () => undefined,
    rpcAfterAttach: async <Result,>(): Promise<Result> => {
      throw new Error("Unexpected forge read");
    },
  });
}

it("keeps provider choices behind one welcome action", () => {
  const view = renderWelcome(MULTIPLE_PROVIDERS);

  expect(view.getByText("Your review inbox")).toBeOnTheScreen();
  expect(view.queryByText("GitHub")).toBeNull();

  fireEvent.press(view.getByRole("button", { name: "Connect a provider" }));

  expect(view.getByText("GitHub")).toBeOnTheScreen();
  expect(view.getByText("Arcanum")).toBeOnTheScreen();
  expect(view.queryByText("Connect GitHub")).toBeNull();
  const firstHeader = within(view.getByTestId("provider-tray-header-left-step-1"));
  expect(firstHeader.getByText("Connect a provider")).toBeOnTheScreen();
  expect(firstHeader.getByText("1 of 4")).toBeOnTheScreen();
  expect(firstHeader.queryByRole("button", { name: "Close" })).toBeNull();
  expect(
    StyleSheet.flatten(view.getByTestId("provider-tray-header-copy-step-1").props.style),
  ).toMatchObject({ alignItems: "baseline", flexDirection: "row" });
});

it("opens provider management from a connected review inbox", async () => {
  const forge = forgeResources();
  const filter = defaultPullRequestFilter();
  const page = parsePullRequestListPage(reviewRequestedPage);
  if (page === null) {
    throw new Error("The pull-request fixture is invalid");
  }
  pullRequestListModel.set(filter);
  forge.accounts.publish({ connectionId: "server" }, CONNECTED_MULTIPLE_PROVIDERS);
  forge.lists.publish({ connectionId: "server", filter }, page);
  const view = render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { height: 800, width: 400, x: 0, y: 0 },
        insets: { bottom: 0, left: 0, right: 0, top: 0 },
      }}
    >
      <PullRequestsCatalog
        capabilities={capabilities(CONNECTED_MULTIPLE_PROVIDERS)}
        connectionId="server"
        forge={forge}
        isThreadUnread={() => false}
        onOpenPullRequest={() => undefined}
      />
    </SafeAreaProvider>,
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  fireEvent.press(view.getByRole("button", { name: "Add or manage pull request providers" }));

  expect(view.getByTestId("forge-accounts-sheet")).toBeOnTheScreen();
  expect(view.getByText("Pull request accounts")).toBeOnTheScreen();
  expect(view.getByTestId("forge-provider-group-github")).toBeOnTheScreen();
  expect(view.getByTestId("forge-provider-group-arcanum")).toBeOnTheScreen();

  act(() => {
    forgeAccountsSheetOpen.set(false);
  });
  expect(view.queryByTestId("forge-accounts-sheet")).toBeNull();
  view.unmount();
});

it("mounts an incoming tray view before passive effects can update retention", () => {
  expect(shouldMountTrayView(true, false)).toBe(true);
  expect(shouldMountTrayView(false, true)).toBe(true);
  expect(shouldMountTrayView(false, false)).toBe(false);
});

it("uses the tray navigation stack and resets it after dismissal", () => {
  const view = renderWelcome(MULTIPLE_PROVIDERS);

  fireEvent.press(view.getByRole("button", { name: "Connect a provider" }));
  fireEvent.press(view.getByRole("button", { name: "GitHub" }));

  expect(view.getByTestId("forge-provider-card-github")).toBeOnTheScreen();
  const secondHeader = within(view.getByTestId("provider-tray-header-left-step-2"));
  expect(secondHeader.getByRole("button", { name: "Back" })).toBeOnTheScreen();
  expect(secondHeader.getByText("Connect GitHub")).toBeOnTheScreen();
  expect(secondHeader.getByText("2 of 4")).toBeOnTheScreen();
  expect(secondHeader.queryByRole("button", { name: "Close" })).toBeNull();
  fireEvent.press(secondHeader.getByRole("button", { name: "Back" }));
  expect(view.getByText("Choose where CodeWide should look for pull requests.")).toBeOnTheScreen();

  fireEvent.press(view.getByRole("button", { name: "GitHub" }));
  const closeButtons = view.getAllByRole("button", { name: "Close" });
  fireEvent.press(closeButtons[closeButtons.length - 1]);
  fireEvent.press(view.getByRole("button", { name: "Connect a provider" }));

  expect(view.getByText("Choose where CodeWide should look for pull requests.")).toBeOnTheScreen();
  expect(view.queryByRole("button", { name: "Back" })).toBeNull();
});

it("keeps the provider step when only one provider is available", () => {
  const view = renderWelcome(SINGLE_PROVIDER);

  fireEvent.press(view.getByRole("button", { name: "Connect a provider" }));

  expect(view.getByRole("button", { name: "GitHub" })).toBeOnTheScreen();
  expect(view.queryByTestId("forge-provider-card-github")).toBeNull();

  fireEvent.press(view.getByRole("button", { name: "GitHub" }));

  expect(view.getByTestId("forge-provider-card-github")).toBeOnTheScreen();
  expect(view.getByRole("button", { name: "Use @sergeigarin" })).toBeOnTheScreen();
  expect(view.getByText("Other ways")).toBeOnTheScreen();
});

it("keeps the one-time code separate from the compact copy and browser actions", () => {
  const copy = jest.spyOn(Clipboard, "setStringAsync");
  const view = renderWelcome(HOST_LOGIN);

  fireEvent.press(view.getByRole("button", { name: "Connect a provider" }));
  fireEvent.press(view.getByRole("button", { name: "GitHub" }));
  fireEvent.press(view.getByRole("button", { name: "Sign in with GitHub" }));

  const authHeader = within(view.getByTestId("provider-tray-header-left-step-3"));
  expect(authHeader.getByText("Sign in to GitHub")).toBeOnTheScreen();
  expect(authHeader.getByText("3 of 4")).toBeOnTheScreen();
  expect(view.queryByText("Finish sign-in")).toBeNull();
  expect(view.getByText("ABCD-1234")).toBeOnTheScreen();
  expect(view.getByText("Waiting for authorization…")).toBeOnTheScreen();
  expect(view.getByTestId("forge-host-login-controls")).toHaveStyle({
    flexDirection: "row",
    flexWrap: "wrap",
  });
  const actions = within(view.getByTestId("forge-host-login-actions"));
  expect(view.getByTestId("forge-host-login-actions")).toHaveStyle({ marginLeft: "auto" });
  expect(view.getByRole("button", { name: "Cancel sign-in" })).toBeOnTheScreen();
  expect(actions.getByRole("button", { name: "Copy one-time code" })).toBeOnTheScreen();
  expect(
    actions.getByRole("button", { name: "Open github.com verification page" }),
  ).toBeOnTheScreen();

  fireEvent.press(actions.getByRole("button", { name: "Copy one-time code" }));
  expect(copy).toHaveBeenCalledWith("ABCD-1234");
});

it("binds each authentication method to its own view and keeps Back on the selected step", () => {
  const view = renderWelcome(HOST_LOGIN);

  fireEvent.press(view.getByRole("button", { name: "Connect a provider" }));
  fireEvent.press(view.getByRole("button", { name: "GitHub" }));
  expect(view.getByText("2 of 4")).toBeOnTheScreen();

  fireEvent.press(view.getByRole("button", { name: "Paste a token" }));
  expect(view.getByTestId("forge-tray-token-panel")).toBeOnTheScreen();
  expect(view.queryByText("Finish sign-in")).toBeNull();

  fireEvent.press(
    within(view.getByTestId("provider-tray-header-left-step-3")).getByRole("button", {
      name: "Back",
    }),
  );
  fireEvent.press(view.getByRole("button", { name: "Sign in with GitHub" }));
  expect(view.queryByText("Finish sign-in")).toBeNull();
  expect(view.getByText("ABCD-1234")).toBeOnTheScreen();
  expect(view.queryByTestId("forge-tray-token-panel")).toBeNull();

  fireEvent.press(
    within(view.getByTestId("provider-tray-header-left-step-3")).getByRole("button", {
      name: "Back",
    }),
  );
  fireEvent.press(
    within(view.getByTestId("provider-tray-header-left-step-2")).getByRole("button", {
      name: "Back",
    }),
  );
  fireEvent.press(view.getByRole("button", { name: "GitHub" }));

  expect(view.getByText("2 of 4")).toBeOnTheScreen();
  expect(view.getByRole("button", { name: "Sign in with GitHub" })).toBeOnTheScreen();
  expect(view.queryByTestId("forge-tray-token-panel")).toBeNull();
});

it("keeps all four onboarding steps through the terminal success state", async () => {
  let resolveStart: ((result: AuthStartResult) => void) | null = null;
  const workspaceCapabilities: PullRequestsWorkspaceCapabilities = {
    ...capabilities(SINGLE_PROVIDER),
    startAuth: () =>
      new Promise<AuthStartResult>((resolve) => {
        resolveStart = resolve;
      }),
  };
  const view = renderWelcome(SINGLE_PROVIDER, workspaceCapabilities);

  fireEvent.press(view.getByRole("button", { name: "Connect a provider" }));
  expect(view.getByText("1 of 4")).toBeOnTheScreen();

  fireEvent.press(view.getByRole("button", { name: "GitHub" }));
  expect(view.getByText("2 of 4")).toBeOnTheScreen();

  fireEvent.press(view.getByRole("button", { name: "Use @sergeigarin" }));
  const authHeader = within(view.getByTestId("provider-tray-header-left-step-3"));
  expect(authHeader.getByText("Connect GitHub")).toBeOnTheScreen();
  expect(authHeader.getByText("3 of 4")).toBeOnTheScreen();
  expect(view.getByText("Connecting @sergeigarin")).toBeOnTheScreen();

  await act(async () => {
    if (resolveStart === null) {
      throw new Error("The connect request did not start");
    }
    resolveStart({ account: CONNECTED_ACCOUNT, kind: "connected" });
    await Promise.resolve();
  });

  const successHeader = within(view.getByTestId("provider-tray-header-left-step-4"));
  expect(successHeader.getByText("Connected")).toBeOnTheScreen();
  expect(successHeader.getByText("4 of 4")).toBeOnTheScreen();
  expect(view.queryByText("GitHub is connected")).toBeNull();
  expect(
    view.getByText("Pull requests from this provider are ready in your review inbox."),
  ).toBeOnTheScreen();
  expect(view.getByRole("button", { name: "View pull requests" })).toBeOnTheScreen();
});

it("recovers the host-login code when the mutation reply is lost but accounts resynchronize", async () => {
  const forge = forgeResources();
  const connectionId = "recovered-auth-server";
  forge.accounts.publish({ connectionId }, SINGLE_PROVIDER);
  const pendingStart = new Promise<AuthStartResult>(() => undefined);
  const workspaceCapabilities: PullRequestsWorkspaceCapabilities = {
    ...capabilities(SINGLE_PROVIDER),
    startAuth: () => pendingStart,
  };
  const view = render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { height: 800, width: 400, x: 0, y: 0 },
        insets: { bottom: 0, left: 0, right: 0, top: 0 },
      }}
    >
      <PullRequestsCatalog
        capabilities={workspaceCapabilities}
        connectionId={connectionId}
        forge={forge}
        isThreadUnread={() => false}
        onOpenPullRequest={() => undefined}
      />
    </SafeAreaProvider>,
  );

  fireEvent.press(view.getByRole("button", { name: "Connect a provider" }));
  fireEvent.press(view.getByRole("button", { name: "GitHub" }));
  fireEvent.press(view.getByRole("button", { name: "Sign in with GitHub" }));
  expect(view.getByText("Starting GitHub sign-in")).toBeOnTheScreen();

  act(() => {
    forge.accounts.publish({ connectionId }, HOST_LOGIN);
  });

  expect(await view.findByText("ABCD-1234")).toBeOnTheScreen();
  expect(view.getByRole("button", { name: "Copy one-time code" })).toBeOnTheScreen();
  expect(view.getByRole("button", { name: "Open github.com verification page" })).toBeOnTheScreen();
  expect(view.queryByText("Starting GitHub sign-in")).toBeNull();
});

it("keeps the terminal success visible after the authoritative account snapshot settles", async () => {
  const forge = forgeResources();
  forge.accounts.publish({ connectionId: "server" }, SINGLE_PROVIDER);
  const workspaceCapabilities: PullRequestsWorkspaceCapabilities = {
    ...capabilities(SINGLE_PROVIDER),
    startAuth: () => Promise.resolve({ account: CONNECTED_ACCOUNT, kind: "connected" }),
  };
  const view = render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { height: 800, width: 400, x: 0, y: 0 },
        insets: { bottom: 0, left: 0, right: 0, top: 0 },
      }}
    >
      <PullRequestsCatalog
        capabilities={workspaceCapabilities}
        connectionId="server"
        forge={forge}
        isThreadUnread={() => false}
        onOpenPullRequest={() => undefined}
      />
    </SafeAreaProvider>,
  );

  fireEvent.press(view.getByRole("button", { name: "Connect a provider" }));
  fireEvent.press(view.getByRole("button", { name: "GitHub" }));
  await act(async () => {
    fireEvent.press(view.getByRole("button", { name: "Use @sergeigarin" }));
    await Promise.resolve();
  });
  expect(view.queryByText("GitHub is connected")).toBeNull();
  expect(
    view.getByText("Pull requests from this provider are ready in your review inbox."),
  ).toBeOnTheScreen();

  act(() => {
    forge.accounts.publish({ connectionId: "server" }, CONNECTED_SNAPSHOT);
  });

  expect(view.queryByText("GitHub is connected")).toBeNull();
  expect(
    view.getByText("Pull requests from this provider are ready in your review inbox."),
  ).toBeOnTheScreen();
  expect(view.getByText("4 of 4")).toBeOnTheScreen();
});

it("caps the tray at the same width as an Android Material sheet", () => {
  const view = renderWelcome(SINGLE_PROVIDER);

  expect(StyleSheet.flatten(view.UNSAFE_getByType(Tray.Content).props.style)).toMatchObject({
    alignSelf: "center",
    maxWidth: 640,
    width: "100%",
  });
});

it("dismisses from the full-screen backdrop and opens again", () => {
  const onOpenChange = jest.fn();
  const view = renderWelcome(SINGLE_PROVIDER, capabilities(SINGLE_PROVIDER), onOpenChange);

  fireEvent.press(view.getByRole("button", { name: "Connect a provider" }));
  expect(view.getByText("Choose where CodeWide should look for pull requests.")).toBeOnTheScreen();

  fireEvent.press(view.getByTestId("tray-backdrop"));
  expect(view.queryByText("Choose where CodeWide should look for pull requests.")).toBeNull();

  fireEvent.press(view.getByRole("button", { name: "Connect a provider" }));
  expect(view.getByText("Choose where CodeWide should look for pull requests.")).toBeOnTheScreen();
  expect(onOpenChange.mock.calls).toEqual([[true], [false], [true]]);
});

it("moves the modal tray out of keyboard overlap", () => {
  const view = renderWelcome(SINGLE_PROVIDER);

  fireEvent.press(view.getByRole("button", { name: "Connect a provider" }));

  expect(view.UNSAFE_getByType(KeyboardAvoidingView).props).toMatchObject({
    behavior: "padding",
    testID: "tray-keyboard-layout",
  });
});

it("dismisses the Android modal tray with a downward swipe", () => {
  const view = renderWelcome(SINGLE_PROVIDER);

  fireEvent.press(view.getByRole("button", { name: "Connect a provider" }));

  expect(view.UNSAFE_getByType(GestureHandlerRootView)).toBeTruthy();
  const pan = view.UNSAFE_getByType(GestureDetector).props.gesture;
  act(() => {
    fireGestureHandler<ReturnType<typeof Gesture.Pan>>(pan, [
      { state: State.BEGAN, translationX: 0, translationY: 0, velocityY: 0 },
      { state: State.ACTIVE, translationX: 0, translationY: 10, velocityY: 0 },
      { state: State.ACTIVE, translationX: 0, translationY: 140, velocityY: 0 },
      { state: State.ACTIVE, translationX: 0, translationY: 280, velocityY: 0 },
      { state: State.END, translationX: 0, translationY: 280, velocityY: 0 },
    ]);
  });

  expect(view.queryByTestId("forge-provider-card-github")).toBeNull();
});
