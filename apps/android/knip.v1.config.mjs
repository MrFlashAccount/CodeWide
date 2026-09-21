export default {
  babel: false,
  "dependency-cruiser": false,
  eslint: false,
  expo: false,
  metro: false,
  node: false,
  typescript: false,
  ignoreDependencies: [
    // Kotlin imports SplashScreenManager directly; Knip cannot see native source consumers.
    "expo-splash-screen",
    // Expo applies this package as an auto-plugin for the configured system appearance.
    "expo-system-ui",
    // Babel resolves the compiler through babel-preset-expo's react-compiler option.
    "babel-plugin-react-compiler",
    // babel.config.js selects this preset by module name while Knip's Babel plugin is disabled.
    "babel-preset-expo",
    // Gradle copies the selected grammar files directly from this package into native assets.
    "tm-grammars",
  ],
  // WHY: Metro resolves these exact module names to native, Android, or web files before
  // the unsuffixed fallback. Knip does not model React Native platform resolution.
  ignoreUnresolved: [
    /^(?:\.\.?\/)+(?:[^/]+\/)*(?:ActionMenu|AppDialogSurface|BrowserDevToolsPane|CodeReviewEditor|CodeWideMenu|ComposerDeliveryMenu|ComposerEditorTrialEntry|ComposerMarkdownInput|Diagram|AppRootProviders|InternalBrowser|MermaidDiagram|MessageActionMenu|ReviewableText|SpeedscopeProfileViewer|TerminalWorkspace|TurnControlMenus|VoiceAura|account-rate-limits-database|connection-profile-database|file-transfer|globalSupervisorBindingDatabase|interactive-terminal-store|local-authentication|native-engine|nativeTerminalInventory|pending-request-database|performance-metrics|quickdraw-image-source|remoteProjectCatalogCache|send-feedback|thread-detail-database|thread-summary-database|thread-ui-state-database|turn-controls-collection|user-preferences-database)$/u,
  ],
  entry: [
    "app/legacy.tsx",
    "app/v1/**/*.{ts,tsx}",
    "test/**/*.{ts,tsx}",
    "app/**/*.{ts,tsx}",
    // WHY: This unsuffixed public fallback is selected only on unsupported Metro platforms.
    "src/native/authenticated-transport-lease.ts",
    // Metro owns platform selection; Knip cannot infer every native/web counterpart from one root.
    "src/**/*.native.{ts,tsx}",
    "src/**/*.android.{ts,tsx}",
    "src/**/*.web.{ts,tsx}",
  ],
  project: ["app/legacy.tsx", "app/v1/**/*.{ts,tsx}", "src/**/*.{ts,tsx}", "test/**/*.{ts,tsx}"],
};
