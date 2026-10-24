import { fireEvent, render } from "@testing-library/react-native";
import { Linking } from "react-native";

import { openOnForge } from "../src/features/pullRequestDetail/actions/openOnForge";
import { ReviewDock } from "../src/features/pullRequestDetail/changes/ReviewDock";

// A review URL comes from the provider plugin; the dock opens it only as an
// https page on the account's host and otherwise shows no button at all.
const counts = { agentOnly: 0, bothPending: 0, toPr: 0, total: 0 };

function renderDock(reviewUrl: string) {
  return render(
    <ReviewDock
      counts={counts}
      disabled={false}
      host="github.com"
      onOpenSubmit={jest.fn()}
      onSelectVerdict={jest.fn()}
      result={{
        kind: "published",
        left: 0,
        published: 2,
        reviewUrl,
        toAgent: 0,
        verdict: "Approve",
      }}
      verdict={null}
      verdicts={[]}
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

it("offers Open on the account host for the PR page only", () => {
  const [open] = openOnForge("https://github.com/acme/app/pull/91", "github.com");
  open?.onSelect();
  expect(Linking.openURL).toHaveBeenCalledWith("https://github.com/acme/app/pull/91");
  for (const url of UNSAFE_URLS) {
    expect(openOnForge(url, "github.com")).toEqual([]);
  }
});

it.each(UNSAFE_URLS)("shows no forge link for %s", (reviewUrl) => {
  const view = renderDock(reviewUrl);
  expect(view.queryByText("View on forge")).toBeNull();
  expect(Linking.openURL).not.toHaveBeenCalled();
});
