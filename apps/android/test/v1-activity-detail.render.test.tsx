import { render } from "@testing-library/react-native";
import type { ReactNode } from "react";

import { ActivityDetailSheet } from "../src/features/conversation/turns/ActivityDetailSheet";
import { colors, typeScale } from "../src/theme";

// WHY: Node cannot mount the native bottom-sheet window. Keep the real Activity header and list.
jest.mock("@expo/ui/community/bottom-sheet", () => {
  const { ScrollView, View } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    BottomSheet: ({ children }: { readonly children: ReactNode }) => <View>{children}</View>,
    BottomSheetScrollView: ScrollView,
    BottomSheetView: View,
  };
});

it("uses a readable stable Activity heading instead of the block summary", () => {
  const view = render(
    <ActivityDetailSheet
      blocks={[]}
      onClose={() => undefined}
      turnKey="turn-1"
      turnStatus="completed"
      visible
    />,
  );

  const heading = view.getByRole("header", { name: "Activity" });
  expect(heading).toHaveStyle({ color: colors.text, fontSize: typeScale.heading.fontSize });
  expect(view.queryByText("File, Run, Comments 18")).toBeNull();
});
