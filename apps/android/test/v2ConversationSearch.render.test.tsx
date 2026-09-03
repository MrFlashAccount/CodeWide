import { describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react-native";

import { ConversationSearchView } from "../src/v2/presentation/conversation/ConversationSearchView";

describe("V2 conversation search", () => {
  it("focuses the current-thread search input when it opens", () => {
    render(
      <ConversationSearchView
        canMoveNewer={false}
        canMoveOlder={false}
        error={null}
        loading={false}
        matchCount={0}
        onChangeText={jest.fn()}
        onClose={jest.fn()}
        onMoveNewer={jest.fn()}
        onMoveOlder={jest.fn()}
        query=""
      />,
    );

    expect(screen.getByLabelText("Search current thread").props.autoFocus).toBe(true);
  });

  it("exposes bounded previous and next navigation without hiding search errors", () => {
    const moveNewer = jest.fn<() => void>();
    const moveOlder = jest.fn<() => void>();

    render(
      <ConversationSearchView
        canMoveNewer
        canMoveOlder
        error="Could not search thread history"
        loading={false}
        matchCount={1}
        onChangeText={jest.fn()}
        onClose={jest.fn()}
        onMoveNewer={moveNewer}
        onMoveOlder={moveOlder}
        query="needle"
      />,
    );

    fireEvent.press(screen.getByLabelText("Previous thread match"));
    fireEvent.press(screen.getByLabelText("Next thread match"));

    expect(moveOlder).toHaveBeenCalledTimes(1);
    expect(moveNewer).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Could not search thread history")).toBeTruthy();
  });

  it("disables traversal while an authoritative page is loading", () => {
    render(
      <ConversationSearchView
        canMoveNewer
        canMoveOlder
        error={null}
        loading
        matchCount={0}
        onChangeText={jest.fn()}
        onClose={jest.fn()}
        onMoveNewer={jest.fn()}
        onMoveOlder={jest.fn()}
        query="needle"
      />,
    );

    expect(screen.getByLabelText("Previous thread match").props.accessibilityState).toEqual({
      disabled: true,
      selected: false,
    });
    expect(screen.getByLabelText("Next thread match").props.accessibilityState).toEqual({
      disabled: true,
      selected: false,
    });
  });
});
