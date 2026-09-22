module.exports = {
  preset: "@react-native/jest-preset",
  // WHY: Worklets supplies a Node resolver for its non-native runtime.
  resolver: "react-native-worklets/jest/resolver.js",
  rootDir: ".",
  setupFiles: ["react-native-gesture-handler/jestSetup.js"],
  setupFilesAfterEnv: ["<rootDir>/test/setup-render-console.cjs"],
  // WHY: Shared UI keeps its original platform environment; V1 owns every suite matched by its config.
  testMatch: [
    "<rootDir>/test/**/*.render.test.tsx",
    "<rootDir>/test/compose-named-icon.native.test.tsx",
    "<rootDir>/test/app-dialog-window.native.test.tsx",
    "<rootDir>/test/settings-sheet.native.test.tsx",
    "<rootDir>/test/app-list-row.native.test.tsx",
    "<rootDir>/test/app-popover.native.test.tsx",
    "<rootDir>/test/codewide-menu.native.test.tsx",
    "<rootDir>/test/image-preview.native.test.tsx",
    "<rootDir>/test/content-review-keyboard-dock.native.test.tsx",
    "<rootDir>/test/composer-send-gesture.native.test.tsx",
    "<rootDir>/test/composer-mention-input.native.test.tsx",
    "<rootDir>/test/project-directory.native.test.tsx",
    "<rootDir>/test/wave-text.native.test.tsx",
    "<rootDir>/test/skills-picker.native.test.tsx",
    "<rootDir>/test/skill-picker-row.native.test.tsx",
  ],
  testPathIgnorePatterns: [
    "<rootDir>/test/v1-.*\\.render\\.test\\.tsx$",
    "<rootDir>/test/workspace-navigation\\.render\\.test\\.tsx$",
    "<rootDir>/test/root-keyboard-geometry\\.render\\.test\\.tsx$",
    "<rootDir>/test/global-search\\.render\\.test\\.tsx$",
    "<rootDir>/test/image-preview\\.native\\.test\\.tsx$",
    "<rootDir>/test/settings-sheet\\.native\\.test\\.tsx$",
    "<rootDir>/test/app-popover\\.native\\.test\\.tsx$",
  ],
  moduleNameMapper: {
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
    "^react-native-worklets$": "<rootDir>/test/mocks/Worklets.ts",
    "^react-native-keyboard-controller$": "<rootDir>/test/mocks/KeyboardController.tsx",
    "^.*/rendering/RichMarkdown$": "<rootDir>/test/mocks/RichMarkdown.tsx",
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
      {
        babelrc: false,
        configFile: false,
        presets: ["module:@react-native/babel-preset"],
        plugins: [[
          require.resolve("babel-plugin-react-compiler", { paths: [require.resolve("babel-preset-expo")] }),
          require("./react-compiler.config.cjs"),
        ]],
      },
    ],
  },
  // WHY: Private icons use ESM-only hashes; real TanStack collections depend on ESM-only fractional-indexing.
  transformIgnorePatterns: [
    "node_modules/(?!.*(?:react-native|@react-native|expo|@expo|@noble[+/]hashes|character-entities|decode-named-character-reference|fractional-indexing|marked))",
  ],
};
