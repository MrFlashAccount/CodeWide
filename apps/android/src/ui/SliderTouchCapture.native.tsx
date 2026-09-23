import { requireNativeComponent, UIManager, View, type ViewProps } from "react-native";

const NativeCapture =
  // WHY: An OTA can run this JavaScript on a native shell released before the capture view.
  // oxlint-disable-next-line typescript/no-unnecessary-condition
  UIManager.getViewManagerConfig("CodeWideSliderTouchCapture") !== null
    ? requireNativeComponent<ViewProps>("CodeWideSliderTouchCapture")
    : null;

/** Keeps the slider's touch stream captured by the menu for the whole drag. */
export function SliderTouchCapture(props: ViewProps): React.JSX.Element {
  return NativeCapture === null ? <View {...props} /> : <NativeCapture {...props} />;
}
