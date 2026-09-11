import { describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render } from "@testing-library/react-native";

import { TurnChangesContext, type TurnChangesTarget } from "../src/rendering/TurnChangesContext";
import { TurnChangesFooter } from "../src/rendering/TurnChangesFooter";

describe("turn changes footer", () => {
  it("opens the shared Changes capability and keeps its icon at metadata scale", () => {
    const present = jest.fn();
    const target: TurnChangesTarget = { connectionId: "server-1", threadId: "thread-1", turnId: "turn-1" };
    const diff = "diff --git a/file.ts b/file.ts\n--- a/file.ts\n+++ b/file.ts\n@@ -1 +1 @@\n-old\n+new\n";
    const view = render(
      <TurnChangesContext.Provider value={present}>
        <TurnChangesFooter diff={diff} target={target} />
      </TurnChangesContext.Provider>,
    );

    expect(view.getByText("git-compare-outline")).toHaveStyle({ fontSize: 12 });
    fireEvent.press(view.getByLabelText("Changes in this turn"));
    expect(present).toHaveBeenCalledWith(target, [{
      path: "file.ts",
      patch: diff,
      kind: "update",
      itemId: "recorded-diff:0",
      additions: 1,
      deletions: 1,
    }]);
  });

  it("does not render when the turn has no concrete diff", () => {
    const present = jest.fn();
    const target: TurnChangesTarget = { connectionId: "server-1", threadId: "thread-1", turnId: "turn-2" };
    const view = render(
      <TurnChangesContext.Provider value={present}>
        <TurnChangesFooter diff="" target={target} />
      </TurnChangesContext.Provider>,
    );

    expect(view.queryByLabelText("Changes in this turn")).toBeNull();
    expect(present).not.toHaveBeenCalled();
  });
});
