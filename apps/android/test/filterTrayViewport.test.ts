import { describe, expect, it } from "vitest";

import { filterTrayViewportGeometry } from "../src/features/pullRequests/list/filterTrayViewport";

describe("filter tray viewport geometry", () => {
  it("keeps the preferred height while the unobscured viewport can contain it", () => {
    expect(
      filterTrayViewportGeometry({
        bottomInset: 24,
        keyboardHeight: 0,
        topInset: 24,
        windowHeight: 1_000,
      }),
    ).toStrictEqual({ bottomInsetCompensation: 0, height: 720 });
  });

  it("caps the tray above the keyboard and removes the duplicated navigation inset", () => {
    expect(
      filterTrayViewportGeometry({
        bottomInset: 24,
        keyboardHeight: 300,
        topInset: 24,
        windowHeight: 800,
      }),
    ).toStrictEqual({ bottomInsetCompensation: 24, height: 464 });
  });

  it("never produces negative geometry for a fully obscured viewport", () => {
    expect(
      filterTrayViewportGeometry({
        bottomInset: 24,
        keyboardHeight: 900,
        topInset: 24,
        windowHeight: 800,
      }),
    ).toStrictEqual({ bottomInsetCompensation: 24, height: 0 });
  });
});
