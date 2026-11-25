import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";

import { parsePullRequestListPage } from "../src/data/forgePullRequestContract";
import { createForgeResources } from "../src/data/forgeResources";
import { defaultPullRequestFilter } from "../src/features/pullRequests/pullRequestListModel";
import { ThreadHeaderMenu } from "../src/features/turnActions/ThreadActions";
import { ThreadPullRequestPickerContext } from "../src/features/turnActions/threadHeaderContract";
import { AppNoticeProvider } from "../src/ui/AppNotice";
import { connectedAccount, involvedPage, listRow } from "./fixtures/forgeWireFixtures";
import { createMemoryQueryPersister } from "./fixtures/queryPersister";

// Android owns the sheet window and its viewport. Keep the real menu, picker, rows and query cache.
jest.mock("@expo/ui/jetpack-compose", () => {
  const { View } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    ...jest.requireActual<typeof import("@expo/ui/jetpack-compose")>("@expo/ui/jetpack-compose"),
    Host: ({ children }: { readonly children: ReactNode }) => <>{children}</>,
    ModalBottomSheet: View,
    RNHostView: View,
  };
});

it("attaches only the chosen PR in the thread menu and keeps the picker available after a failed write", async () => {
  const forge = createForgeResources({
    getSession: () => undefined,
    persister: createMemoryQueryPersister().persister,
    reportDroppedAction: () => undefined,
    rpcAfterAttach: async () => {
      throw new Error("Unexpected RPC");
    },
  });
  const otherAccount = { ...connectedAccount, account: "github:github.com:work", login: "work" };
  const page = parsePullRequestListPage({
    ...involvedPage,
    category: "authored",
    sections: [
      { account: connectedAccount, number: "1", updatedAt: "2026-10-21T10:00:00+03:00" },
      { account: otherAccount, number: "2", updatedAt: "2026-10-21T09:00:00Z" },
    ].map(({ account, number, updatedAt }) => ({
      account,
      rows: [
        listRow(number, {
          account: account.account,
          author: account.login,
          updatedAt,
        }),
      ],
      supportedCategories: ["involved", "authored"],
    })),
  });
  const older = page?.sections[0]?.rows[0];
  const first = page?.sections[1]?.rows[0];
  if (!page || !older || !first) throw new Error("Invalid PR catalog fixture");
  const defaults = defaultPullRequestFilter();
  forge.lists.publish(
    {
      connectionId: "server",
      filter: {
        ...defaults,
        query: {
          ...defaults.query,
          category: "authored",
          sort: { field: "updated", direction: "descending" },
        },
      },
    },
    page,
  );
  const complete = Promise.withResolvers<void>();
  const onAttach = jest
    .fn()
    .mockRejectedValueOnce(new Error("Write refused"))
    .mockReturnValue(complete.promise);
  const view = render(
    <ThreadPullRequestPickerContext.Provider
      value={{ badges: [], connectionId: "server", forge, onAttach, threadId: "thread" }}
    >
      <ThreadHeaderMenu
        archived={false}
        onRenameRequest={jest.fn()}
        pinned={false}
        threadId="thread"
      />
    </ThreadPullRequestPickerContext.Provider>,
    { wrapper: AppNoticeProvider },
  );
  fireEvent.press(view.getByLabelText("Thread menu"));
  fireEvent.press(view.getByLabelText("Thread menu: Attach pull request"));
  expect(view.getByRole("button", { name: "Mine", selected: true })).toBeTruthy();
  expect(
    view
      .getAllByLabelText(/, MrFlashAccount\/CodeWide #/u)
      .map((item) => item.props.accessibilityLabel),
  ).toEqual([first, older].map((item) => `${item.title}, ${item.repository} #${item.number}`));
  const row = () => view.getByLabelText(`${first.title}, ${first.repository} #${first.number}`);
  fireEvent.press(row());
  await waitFor(() => expect(onAttach).toHaveBeenCalledWith(first.pullRequest));
  await waitFor(() => expect(row()).toBeEnabled());
  fireEvent.press(row());
  await waitFor(() => expect(onAttach).toHaveBeenCalledTimes(2));
  expect(row()).toBeDisabled();
  await act(async () => {
    complete.resolve();
    await complete.promise;
  });
  await waitFor(() => expect(view.queryByLabelText("Search pull requests")).toBeNull());
  view.unmount();
  forge.queryClient.clear();
});
