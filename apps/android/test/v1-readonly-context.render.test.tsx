import { render } from "@testing-library/react-native";
import { Text, TextInput } from "react-native";
import { ReadOnlyComposerContext } from "../src/features/composer/ReadOnlyComposerContext";
import { createV1TestThread } from "./fixtures/v1Thread";

it("keeps execution metadata and supplied tool access without creating an editable composer", () => {
  const thread = createV1TestThread("child", "parent", 1, []);
  const view = render(<ReadOnlyComposerContext thread={thread}><Text>Terminal access</Text></ReadOnlyComposerContext>);
  expect(view.getByTestId("readonly-model-chip")).toBeVisible();
  expect(view.getByTestId("composer-model-label")).toHaveTextContent("Model not confirmed");
  expect(view.getByText("Terminal access")).toBeVisible();
  expect(view.UNSAFE_queryAllByType(TextInput)).toHaveLength(0);
  expect(view.queryByLabelText("Send message")).toBeNull();
});
