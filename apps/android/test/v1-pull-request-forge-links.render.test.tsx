import { fireEvent, render } from "@testing-library/react-native";
import * as Clipboard from "expo-clipboard";
import { Linking, Share } from "react-native";

import { pullRequestMenuItems } from "../src/features/pullRequestDetail/actions/pullRequestMenuItems";
import { ReviewOutcome } from "../src/features/pullRequestDetail/changes/ReviewOutcome";

// A review URL comes from the provider plugin; the Submit outcome opens it only
// as an https page on the account's host and otherwise shows no link at all.

function renderDock(reviewUrl: string) {
  return render(
    <ReviewOutcome
      host="github.com"
      result={{
        kind: "published",
        left: 0,
        published: 2,
        reviewUrl,
        toAgent: 0,
        verdict: "Approve",
      }}
    />,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Linking, "openURL").mockResolvedValue(true);
});

it("opens an https review page on the account host", () => {
  const view = renderDock("https://github.com/acme/app/pull/91#pullrequestreview-1");
  fireEvent.press(view.getByText("View on forge"));
  expect(Linking.openURL).toHaveBeenCalledWith(
    "https://github.com/acme/app/pull/91#pullrequestreview-1",
  );
});

const UNSAFE_URLS = [
  "codewide://pair?token=x",
  "http://github.com/acme/app/pull/91",
  "https://github.com.evil.example/acme/app/pull/91",
  "https://user:secret@github.com/acme/app/pull/91",
];

const metadata = { number: "91", title: "Fix отображения ⋮ в PR" };

function menu(webUrl: string, forgeName: string | null = "GitHub") {
  return pullRequestMenuItems({
    forgeName,
    host: "github.com",
    onError: () => undefined,
    overview: { ...metadata, webUrl },
  });
}

it("copies the PR metadata verbatim and copies, shares and opens its forge link", async () => {
  const copy = jest.spyOn(Clipboard, "setStringAsync").mockResolvedValue(true);
  const share = jest.spyOn(Share, "share").mockResolvedValue({ action: "sharedAction" });
  const items = menu("https://github.com/acme/app/pull/91");
  for (const item of items) {
    item.onSelect();
  }
  await Promise.resolve();
  expect(copy).toHaveBeenCalledWith("https://github.com/acme/app/pull/91");
  expect(copy).toHaveBeenCalledWith(metadata.number);
  expect(copy).toHaveBeenCalledWith(metadata.title);
  expect(share).toHaveBeenCalledWith(
    expect.objectContaining({ message: "https://github.com/acme/app/pull/91" }),
  );
  expect(Linking.openURL).toHaveBeenCalledWith("https://github.com/acme/app/pull/91");
  // Until the accounts snapshot names the forge, the host stands in.
  expect(menu("https://github.com/acme/app/pull/91", null).at(-1)?.label).toBe(
    "Open in github.com",
  );
});

it.each(UNSAFE_URLS)("keeps only the local copy actions for %s", (url) => {
  const copy = jest.spyOn(Clipboard, "setStringAsync").mockResolvedValue(true);
  const items = menu(url);
  expect(items.map((item) => item.label)).toEqual(["Copy ID", "Copy title"]);
  items[0]?.onSelect();
  expect(copy).toHaveBeenLastCalledWith(metadata.number);
  items[1]?.onSelect();
  expect(copy).toHaveBeenLastCalledWith(metadata.title);
});

it("reports a failed copy with its real error", async () => {
  const failure = new Error("clipboard unavailable");
  jest.spyOn(Clipboard, "setStringAsync").mockRejectedValue(failure);
  const onError = jest.fn<undefined, [string, unknown]>();
  const [copy] = pullRequestMenuItems({
    forgeName: "GitHub",
    host: "github.com",
    onError,
    overview: { ...metadata, webUrl: "https://github.com/acme/app/pull/91" },
  });
  copy?.onSelect();
  await Promise.resolve();
  await Promise.resolve();
  expect(onError).toHaveBeenCalledWith("Could not copy the link", failure);
});

it.each(UNSAFE_URLS)("shows no forge link for %s", (reviewUrl) => {
  const view = renderDock(reviewUrl);
  expect(view.queryByText("View on forge")).toBeNull();
  expect(Linking.openURL).not.toHaveBeenCalled();
});
