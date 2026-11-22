import { render } from "@testing-library/react-native";
import * as SplashScreen from "expo-splash-screen";

import "../index";
import RootLayout, { ErrorBoundary, SuspenseFallback } from "../app/_layout";

jest.mock("expo-router/entry", () => {
  // Router registers the root as soon as its entry is evaluated.
  const splash = jest.requireMock<typeof import("expo-splash-screen")>("expo-splash-screen");
  expect(splash.preventAutoHideAsync).toHaveBeenCalled();
  return {};
});
jest.mock("expo-splash-screen", () => ({
  hide: jest.fn(),
  preventAutoHideAsync: jest.fn().mockResolvedValue(true),
}));
jest.mock("expo-font", () => ({ useFonts: () => [false, null] }));
// Metro gives the native font loader asset IDs. Jest cannot load the font binaries.
jest.mock("../assets/fonts/RobotoFlex-Regular.ttf", () => 1);
jest.mock("../assets/fonts/RobotoFlex-Medium.ttf", () => 2);
jest.mock("../assets/fonts/RobotoFlex-SemiBold.ttf", () => 3);
jest.mock("expo-local-authentication", () => ({}));
jest.mock("expo-updates", () => ({}));
jest.mock("../src/data/androidReleaseAvailability", () => ({
  startAndroidReleaseCheckRuntime: jest.fn(),
}));
jest.mock("../src/data/use-ota-prefetch", () => ({ startOtaPrefetchRuntime: jest.fn() }));

it("keeps the native launch screen through font loading and root suspense", () => {
  expect(SplashScreen.preventAutoHideAsync).toHaveBeenCalled();
  const view = render(<RootLayout />);
  expect(view.toJSON()).toBeNull();
  view.rerender(<SuspenseFallback />);
  expect(view.toJSON()).toBeNull();
  expect(SplashScreen.hide).not.toHaveBeenCalled();
});

it("exposes the recovery screen to Android before fonts or a workspace are ready", () => {
  const view = render(<ErrorBoundary error={new Error("Startup failed")} retry={jest.fn()} />);
  expect(view.getByText("Interface crashed")).toBeTruthy();
  // The Android pre-draw observer recognizes this native ID on the mounted recovery screen.
  expect(view.getByTestId("root-error-boundary")).toHaveProp("nativeID", "codewide-startup-surface");
  expect(SplashScreen.hide).not.toHaveBeenCalled();
});
