import { render } from "@testing-library/react-native";
import type * as ReactNative from "react-native";

import { ReviewableText } from "../src/rendering/ReviewableText.native";
import * as reviewBridge from "../src/rendering/content-review-native-module";

it("installs selection once and sends highlights only when the native spans change", () => {
  const install = jest.fn();
  const uninstall = jest.fn();
  const setHighlights = jest.fn();
  const tag = 37;
  const bridge = jest
    .spyOn(reviewBridge, "contentReviewNativeModule")
    .mockReturnValue({ install, uninstall, setHighlights });
  const native = jest.requireActual<typeof ReactNative>("react-native");
  const findTag = jest.spyOn(native, "findNodeHandle", "get").mockReturnValue(() => tag);
  const onReviewSelection = jest.fn();
  const line = (ranges: readonly { start: number; end: number }[]) => (
    <ReviewableText onReviewSelection={onReviewSelection} reviewHighlights={ranges}>
      first line
    </ReviewableText>
  );
  try {
    const view = render(line([]));
    expect(install).toHaveBeenCalledWith(tag, expect.any(String));
    const token = install.mock.calls[0]?.[1];
    // Installation establishes an empty native range set. Reapplying it invalidates the view.
    expect(setHighlights).not.toHaveBeenCalled();
    const ranges = [{ start: 0, end: 5 }];
    view.rerender(line(ranges));
    expect(setHighlights).toHaveBeenLastCalledWith(tag, token, ranges);
    view.rerender(line([{ start: 0, end: 5 }]));
    expect(setHighlights).toHaveBeenCalledTimes(1);
    view.rerender(line([]));
    expect(setHighlights).toHaveBeenLastCalledWith(tag, token, []);
    view.unmount();
    expect(uninstall).toHaveBeenCalledWith(tag, token);
  } finally {
    findTag.mockRestore();
    bridge.mockRestore();
  }
});
