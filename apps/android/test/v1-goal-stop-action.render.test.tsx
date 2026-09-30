import { render } from "@testing-library/react-native";

import { ComposerSubmitAction } from "../src/features/composer/ComposerSubmitAction";

it("names the active-goal stop action before dispatch", () => {
  const screen = render(
    <ComposerSubmitAction
      activatePrimaryAction={jest.fn()}
      composerDiscardEnabled={false}
      currentTurnId="turn"
      deliveryActions={[]}
      discardComposer={jest.fn()}
      dismissComposerKeyboardForOverlay={jest.fn()}
      editingQueuedMessage={false}
      goalAttachmentVisible={false}
      handleDeliveryAction={jest.fn()}
      queuedComposerEditBusy={false}
      sendDisabled={false}
      steerComposer={jest.fn()}
      stopAction="goalAndResponse"
      threadLifecycleActive
      voicePhase="idle"
    />,
  );

  expect(screen.getByLabelText("Pause goal and stop response")).toBeVisible();
  expect(screen.queryByLabelText("Stop response")).toBeNull();
});
