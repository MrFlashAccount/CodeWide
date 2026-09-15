export default {
  babel: false,
  "dependency-cruiser": false,
  eslint: false,
  expo: false,
  metro: false,
  node: false,
  typescript: false,
  // WHY: Metro resolves these exact module names to native, Android, or web files before
  // the unsuffixed fallback. Knip does not model React Native platform resolution.
  ignoreUnresolved: [
    // WHY: The source-only V1 graph excludes this CommonJS test fixture owned by ESLint.
    /^\.\/eslint-presentation-tokens[.]cjs$/u,
    /^(?:\.\.?\/)+(?:[^/]+\/)*(?:ActionMenu|AppDialogSurface|BrowserDevToolsPane|CodeReviewEditor|CodeWideMenu|ComposerDeliveryMenu|ComposerEditorTrialEntry|ComposerMarkdownInput|Diagram|HeroUIRoot|InternalBrowser|MermaidDiagram|MessageActionMenu|ReviewableText|SpeedscopeProfileViewer|TerminalWorkspace|TurnControlMenus|VoiceAura|account-rate-limits-database|connection-profile-database|file-transfer|interactive-terminal-store|legacy-remote-store|local-authentication|native-engine|pending-request-database|performance-metrics|quickdraw-image-source|send-feedback|thread-detail-database|thread-summary-database|thread-ui-state-database|turn-controls-collection|user-preferences-database)$/u,
  ],
  entry: [
    "app/legacy.tsx",
    "test/**/*.{ts,tsx}",
    // WHY: These excluded Android owners are external consumers of V1 exports. Treating
    // them as roots prevents Knip from narrowing a cross-generation public contract.
    "app/**/*.{ts,tsx}",
    "src/boot/**/*.{ts,tsx}",
    "src/presentation/**/*.{ts,tsx}",
    "src/v2/**/*.{ts,tsx}",
    // WHY: This unsuffixed public fallback is selected only on unsupported Metro platforms.
    "src/native/authenticated-transport-lease.ts",
    // Metro owns platform selection; Knip cannot infer every native/web counterpart from one root.
    "src/**/*.native.{ts,tsx}",
    "src/**/*.android.{ts,tsx}",
    "src/**/*.web.{ts,tsx}",
  ],
  project: [
    "app/legacy.tsx",
    "src/**/*.{ts,tsx}",
    "test/**/*.{ts,tsx}",
    "!src/boot/**",
    "!src/presentation/**",
    "!src/v2/**",
  ],
};
