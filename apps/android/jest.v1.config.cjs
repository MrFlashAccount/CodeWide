const path = require("node:path");

const expoModulesCoreRoot = path.dirname(require.resolve("expo-modules-core/package.json"));

module.exports = {
  preset: "@react-native/jest-preset",
  haste: { defaultPlatform: "android", platforms: ["android", "ios", "native"] },
  // WHY: Worklets supplies a Node resolver for its non-native runtime.
  resolver: "<rootDir>/test/android-jest-resolver.cjs",
  rootDir: ".",
  setupFiles: [
    "<rootDir>/test/setup-expo-render-runtime.cjs",
    "react-native-gesture-handler/jestSetup.js",
  ],
  setupFilesAfterEnv: ["<rootDir>/test/setup-v2-render-console.cjs"],
  testMatch: [
    "<rootDir>/test/app-popover.native.test.tsx",
    "<rootDir>/test/v1-*.render.test.tsx",
    "<rootDir>/test/root-generation-gate.render.test.tsx",
    "<rootDir>/test/workspace-navigation.render.test.tsx",
  ],
  moduleNameMapper: {
    "^\\./NativeViewManagerAdapter$": path.join(
      expoModulesCoreRoot,
      "src/NativeViewManagerAdapter.native.tsx",
    ),
    "^@expo/vector-icons$": "<rootDir>/test/mocks/ExpoVectorIcons.tsx",
    "^@expo/vector-icons/.*$": "<rootDir>/test/mocks/ExpoVectorIcons.tsx",
    "^expo-clipboard$": "<rootDir>/test/mocks/ExpoClipboard.ts",
    "^expo-crypto$": "<rootDir>/test/mocks/ExpoCrypto.ts",
    "^expo-haptics$": "<rootDir>/test/mocks/ExpoHaptics.ts",
    "^expo-router$": "<rootDir>/test/mocks/ExpoRouter.ts",
    "^@legendapp/list/react-native$": "<rootDir>/test/mocks/LegendNativeList.tsx",
    "^@legendapp/list/keyboard$": "<rootDir>/test/mocks/LegendKeyboardList.tsx",
    "^@quickdrawjs/react-native$": "<rootDir>/test/mocks/QuickdrawReactNative.tsx",
    "^react-native-webview$": "<rootDir>/test/mocks/ReactNativeWebView.tsx",
    "^react-native-gesture-handler/ReanimatedSwipeable$":
      "<rootDir>/test/mocks/ReanimatedSwipeable.tsx",
    // WHY: Reanimated's native worklet runtime cannot initialize in the Node render-test process.
    "^react-native-reanimated$": "<rootDir>/test/mocks/Reanimated.ts",
    "^react-native-keyboard-controller$": "<rootDir>/test/mocks/KeyboardController.tsx",
    "^.*/V2Application$": "<rootDir>/test/mocks/V2Application.ts",
    "^(?:.*/rendering/|\\./)RichMarkdown$": "<rootDir>/test/mocks/RichMarkdown.tsx",
    "^.*/surfaces/PresentationSheetView$": "<rootDir>/test/mocks/PresentationSheetView.tsx",
    "^(?:.*/ui/|\\./)ActionMenu$": "<rootDir>/test/mocks/ActionMenu.tsx",
    "^.*/ui/AppDialog$": "<rootDir>/test/mocks/AppDialog.ts",
    "^.*/ui/MessageActionMenu$": "<rootDir>/test/mocks/MessageActionMenu.tsx",
    "^.*/ui/RecoverableRenderBoundary$": "<rootDir>/test/mocks/RecoverableRenderBoundary.tsx",
    "^.*/data/native-port-forwarding-store$": "<rootDir>/test/mocks/nativePortForwardingStore.ts",
  },
  transform: {
    // WHY: Compose Icon consumes XML drawables as Metro assets, not executable modules.
    "^.+\\.xml$": "@react-native/jest-preset/jest/assetFileTransformer.js",
    "^.+\\.(js|ts|tsx)$": [
      "babel-jest",
      { babelrc: false, configFile: false, presets: ["module:@react-native/babel-preset"] },
    ],
  },
  // WHY: Private icons use ESM-only hashes; real TanStack collections depend on ESM-only fractional-indexing.
  transformIgnorePatterns: [
    "node_modules/(?!.*(?:react-native|@react-native|expo|@expo|@op-engineering[+/]op-sqlite|@noble[+/]hashes|character-entities|decode-named-character-reference|fractional-indexing|marked))",
  ],
};
