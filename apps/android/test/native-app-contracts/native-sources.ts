import { readFileSync } from "node:fs";

export { default as appConfig } from "../../app.json";
export { default as appPackage } from "../../package.json";
export { default as rootPackage } from "../../../../package.json";
export const quickdrawPatch = readFileSync(
  new URL("../../../../patches/@quickdrawjs__react-native@0.2.0.patch", import.meta.url),
  "utf8",
);
export const appEntry = readFileSync(new URL("../../index.js", import.meta.url), "utf8");
export const rootLayout = readFileSync(new URL("../../app/_layout.tsx", import.meta.url), "utf8");
export const manifest = readFileSync(
  new URL("../../android/app/src/main/AndroidManifest.xml", import.meta.url),
  "utf8",
);
export const mainActivity = readFileSync(
  new URL("../../android/app/src/main/java/dev/codewide/app/MainActivity.kt", import.meta.url),
  "utf8",
);
export const mainApplication = readFileSync(
  new URL("../../android/app/src/main/java/dev/codewide/app/MainApplication.kt", import.meta.url),
  "utf8",
);
export const nativeStyles = readFileSync(
  new URL("../../android/app/src/main/res/values/styles.xml", import.meta.url),
  "utf8",
);
export const nativeColors = readFileSync(
  new URL("../../android/app/src/main/res/values/colors.xml", import.meta.url),
  "utf8",
);
export const splashMark = readFileSync(
  new URL("../../android/app/src/main/res/drawable/codewide_splash_mark.xml", import.meta.url),
  "utf8",
);
export const splashExitAnimation = readFileSync(
  new URL(
    "../../android/app/src/main/java/dev/codewide/app/SplashExitAnimation.kt",
    import.meta.url,
  ),
  "utf8",
);
export const gradle = readFileSync(
  new URL("../../android/app/build.gradle", import.meta.url),
  "utf8",
);
export const gradleProperties = readFileSync(
  new URL("../../android/gradle.properties", import.meta.url),
  "utf8",
);
export const strings = readFileSync(
  new URL("../../android/app/src/main/res/values/strings.xml", import.meta.url),
  "utf8",
);
export const connectionService = readFileSync(
  new URL(
    "../../android/app/src/main/java/dev/codewide/app/remote/CodexConnectionService.kt",
    import.meta.url,
  ),
  "utf8",
);
export const nativeFrameStore = readFileSync(
  new URL(
    "../../android/app/src/main/java/dev/codewide/app/remote/NativeFrameStore.kt",
    import.meta.url,
  ),
  "utf8",
);
export const nativeCommandStore = readFileSync(
  new URL(
    "../../android/app/src/main/java/dev/codewide/app/remote/NativeCommandStore.kt",
    import.meta.url,
  ),
  "utf8",
);
export const nativeCommandPolicy = readFileSync(
  new URL(
    "../../android/app/src/main/java/dev/codewide/app/remote/NativeCommandPolicy.kt",
    import.meta.url,
  ),
  "utf8",
);
export const nativeCredentialsStore = readFileSync(
  new URL(
    "../../android/app/src/main/java/dev/codewide/app/remote/NativeSessionCredentialsStore.kt",
    import.meta.url,
  ),
  "utf8",
);
export const nativeProtocolEngine = readFileSync(
  new URL(
    "../../android/app/src/main/java/dev/codewide/app/remote/NativeProtocolEngine.kt",
    import.meta.url,
  ),
  "utf8",
);
export const projectionBatchPolicy = readFileSync(
  new URL(
    "../../android/app/src/main/java/dev/codewide/app/remote/ProjectionBatchPolicy.kt",
    import.meta.url,
  ),
  "utf8",
);
export const sessionCredentialClient = readFileSync(
  new URL(
    "../../android/app/src/main/java/dev/codewide/app/remote/SessionCredentialClient.kt",
    import.meta.url,
  ),
  "utf8",
);
export const deviceKeyStore = readFileSync(
  new URL(
    "../../android/app/src/main/java/dev/codewide/app/remote/DeviceKeyStore.kt",
    import.meta.url,
  ),
  "utf8",
);
export const innerTlsTransport = readFileSync(
  new URL(
    "../../android/app/src/main/java/dev/codewide/app/remote/InnerTlsTransport.kt",
    import.meta.url,
  ),
  "utf8",
);
export const nativeTelemetry = readFileSync(
  new URL(
    "../../android/app/src/main/java/dev/codewide/app/remote/NativeTelemetry.kt",
    import.meta.url,
  ),
  "utf8",
);
export const nativeModule = readFileSync(
  new URL(
    "../../android/app/src/main/java/dev/codewide/app/remote/CodeWideModule.kt",
    import.meta.url,
  ),
  "utf8",
);
export const preparedMicrophone = readFileSync(
  new URL(
    "../../android/app/src/main/java/dev/codewide/app/remote/PreparedMicrophone.kt",
    import.meta.url,
  ),
  "utf8",
);
export const opusAudioEncoder = readFileSync(
  new URL(
    "../../android/app/src/main/java/dev/codewide/app/remote/OpusAudioEncoder.kt",
    import.meta.url,
  ),
  "utf8",
);
export const nativePackage = readFileSync(
  new URL(
    "../../android/app/src/main/java/dev/codewide/app/remote/CodeWidePackage.kt",
    import.meta.url,
  ),
  "utf8",
);
export const nativeCodeManager = readFileSync(
  new URL(
    "../../android/app/src/main/java/dev/codewide/app/rendering/NativeCodeBlockManager.kt",
    import.meta.url,
  ),
  "utf8",
);
export const nativeCodeView = readFileSync(
  new URL(
    "../../android/app/src/main/java/dev/codewide/app/rendering/NativeCodeBlockView.kt",
    import.meta.url,
  ),
  "utf8",
);
export const nativeCodeHighlighter = readFileSync(
  new URL(
    "../../android/app/src/main/java/dev/codewide/app/rendering/NativeCodeHighlighter.kt",
    import.meta.url,
  ),
  "utf8",
);
export const nativeShimmerView = readFileSync(
  new URL(
    "../../android/app/src/main/java/dev/codewide/app/rendering/NativeShimmerTextView.kt",
    import.meta.url,
  ),
  "utf8",
);
export const performanceModule = readFileSync(
  new URL(
    "../../android/app/src/main/java/dev/codewide/app/performance/CodexPerformanceModule.kt",
    import.meta.url,
  ),
  "utf8",
);
export const nativeTransport = readFileSync(
  new URL("../../src/native/native-transport.native.ts", import.meta.url),
  "utf8",
);
export const nativeTransportWeb = readFileSync(
  new URL("../../src/native/native-transport.web.ts", import.meta.url),
  "utf8",
);
export const nativeEngine = readFileSync(
  new URL("../../src/native/native-engine.native.ts", import.meta.url),
  "utf8",
);
export const mermaidDocument = readFileSync(
  new URL("../../android/app/src/main/assets/mermaid-renderer.html", import.meta.url),
  "utf8",
);
export const mermaidRuntime = readFileSync(
  new URL("../../android/app/src/main/assets/mermaid.min.js", import.meta.url),
  "utf8",
);
export const asciiDiagramDocument = readFileSync(
  new URL("../../android/app/src/main/assets/ascii-diagram-renderer.html", import.meta.url),
  "utf8",
);
export const asciiDiagramRuntime = readFileSync(
  new URL("../../android/app/src/main/assets/svgbob-wasm.js", import.meta.url),
  "utf8",
);
export const fileTransferNative = readFileSync(
  new URL("../../src/native/file-transfer.native.ts", import.meta.url),
  "utf8",
);
export const codeReviewAsset = readFileSync(
  new URL("../../android/app/src/main/assets/code-review-editor.html", import.meta.url),
  "utf8",
);
export const pairRoute = readFileSync(new URL("../../app/pair.tsx", import.meta.url), "utf8");
export const threadRoute = readFileSync(new URL("../../app/thread.tsx", import.meta.url), "utf8");
export const networkSecurity = readFileSync(
  new URL("../../android/app/src/main/res/xml/network_security_config.xml", import.meta.url),
  "utf8",
);
