module.exports = {
  preset: "@react-native/jest-preset",
  rootDir: ".",
  testMatch: ["<rootDir>/test/**/*.render.test.tsx"],
  moduleNameMapper: {
    "^@expo/vector-icons$": "<rootDir>/test/mocks/ExpoVectorIcons.tsx",
    "^@expo/vector-icons/.*$": "<rootDir>/test/mocks/ExpoVectorIcons.tsx",
    "^expo-clipboard$": "<rootDir>/test/mocks/ExpoClipboard.ts",
    "^expo-haptics$": "<rootDir>/test/mocks/ExpoHaptics.ts",
    "^@legendapp/list/react-native$": "<rootDir>/test/mocks/LegendNativeList.tsx",
    "^@legendapp/list/keyboard$": "<rootDir>/test/mocks/LegendKeyboardList.tsx",
    "^.*/rendering/RichMarkdown$": "<rootDir>/test/mocks/RichMarkdown.tsx",
    "^.*/surfaces/PresentationSheetView$": "<rootDir>/test/mocks/PresentationSheetView.tsx",
    "^.*/ui/ActionMenu$": "<rootDir>/test/mocks/ActionMenu.tsx",
    "^.*/ui/AppDialog$": "<rootDir>/test/mocks/AppDialog.ts",
    "^.*/ui/MessageActionMenu$": "<rootDir>/test/mocks/MessageActionMenu.tsx",
    "^.*/ui/RecoverableRenderBoundary$": "<rootDir>/test/mocks/RecoverableRenderBoundary.tsx",
    "^.*/data/native-port-forwarding-store$": "<rootDir>/test/mocks/nativePortForwardingStore.ts",
  },
  transform: {
    "^.+\\.(js|ts|tsx)$": [
      "babel-jest",
      { babelrc: false, configFile: false, presets: ["module:@react-native/babel-preset"] },
    ],
  },
  transformIgnorePatterns: ["node_modules/(?!.*(?:react-native|@react-native|expo|@expo))"],
};
