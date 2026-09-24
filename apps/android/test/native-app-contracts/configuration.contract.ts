import { expect, it } from "vitest";
import {
  gradle,
  appConfig,
  manifest,
  strings,
  appPackage,
  appEntry,
  nativeTransport,
  nativeTransportWeb,
  mainActivity,
  splashExitAnimation,
  connectionService,
  nativeStyles,
  nativeColors,
  splashMark,
  rootLayout,
  networkSecurity,
} from "./native-sources";
import { secureCryptoPolyfill, screen } from "./platform-sources";
import { voiceWorkspace, ownerWorkspaceRuntime, otaPrefetch } from "./runtime-sources";
import { ownerNewServerRoute } from "./workspace-sources";
import { appErrorBoundary, crashRecovery, globalErrorStore } from "./presentation-sources";

it("keeps identity, scheme, orientation and predictive back in sync", () => {
  expect(gradle).toContain(`applicationId '${appConfig.expo.android.package}'`);
  expect(appConfig.expo.android.package).toBe("dev.codexremote.app");
  expect(manifest).toContain('android:name="dev.codewide.app.MainApplication"');
  expect(manifest).toContain('android:name="dev.codewide.app.MainActivity"');
  expect(manifest).toContain('android:name="dev.codewide.app.remote.CodexConnectionService"');
  expect(gradle).toContain(
    `project.findProperty("codewideVersionCode") ?: "${appConfig.expo.android.versionCode}"`,
  );
  expect(gradle).toContain(
    `project.findProperty("codewideVersionName") ?: "${appConfig.expo.version}"`,
  );
  expect(appConfig.expo.runtimeVersion).toBe(
    `${appConfig.expo.version}-native-${appConfig.expo.android.versionCode}`,
  );
  const schemes = Array.isArray(appConfig.expo.scheme)
    ? appConfig.expo.scheme
    : [appConfig.expo.scheme];
  for (const scheme of schemes) expect(manifest).toContain(`<data android:scheme="${scheme}"/>`);
  expect(manifest).toContain('android:screenOrientation="unspecified"');
  expect(appConfig.expo.orientation).toBe("default");
  expect(manifest).toContain('android:enableOnBackInvokedCallback="false"');
  expect(appConfig.expo.android.predictiveBackGestureEnabled).toBe(false);
  expect(strings).toContain(`<string name="app_name">${appConfig.expo.name}</string>`);
});

it("keeps native permissions explicit", () => {
  expect(manifest).toContain('<uses-permission android:name="android.permission.CAMERA"/>');
  expect(manifest).toContain('<uses-permission android:name="android.permission.RECORD_AUDIO"/>');
  for (const permission of appConfig.expo.android.blockedPermissions) {
    expect(manifest).not.toContain(`<uses-permission android:name="${permission}"`);
  }
});

it("installs secure UUID primitives before Expo Router loads TanStack DB", () => {
  expect(appPackage.main).toBe("index.js");
  expect(appEntry.indexOf('import "./src/polyfills/secure-crypto"')).toBeLessThan(
    appEntry.indexOf('import "expo-router/entry"'),
  );
  expect(secureCryptoPolyfill).toContain('from "expo-crypto"');
  expect(secureCryptoPolyfill).toContain('Object.defineProperty(globalThis, "crypto"');
  expect(secureCryptoPolyfill).toContain("assertSecureCryptoRuntime");
  expect(voiceWorkspace).not.toContain("preflightNativeTransport");
  expect(nativeTransport).not.toContain("preflightNativeTransport");
  expect(nativeTransportWeb).not.toContain("preflightNativeTransport");
  expect(ownerWorkspaceRuntime).toContain("Publish the local-first stores before hydration");
  expect(ownerWorkspaceRuntime).toContain("Local runtime startup failed (${startupStage})");
  expect(screen).not.toContain("StartupPreflightView");
  expect(screen).not.toContain("Checking local runtime");
  expect(ownerNewServerRoute).toContain("onRetryStartup={retryStartup}");
  expect(ownerWorkspaceRuntime).toContain("const retryStartup = async");
  expect(ownerWorkspaceRuntime).toContain("workspaceRuntime.startPromise = null");
});

it("uses a native splash and a matching spinner-free React boot surface", () => {
  expect(appPackage.dependencies["expo-splash-screen"]).toMatch(/^~57/);
  expect(manifest).toContain('android:theme="@style/Theme.App.SplashScreen"');
  expect(mainActivity).toContain("SplashScreenManager.registerOnActivity(this)");
  expect(mainActivity.indexOf("SplashExitAnimation.install(this)")).toBeGreaterThan(
    mainActivity.indexOf("SplashScreenManager.registerOnActivity(this)"),
  );
  expect(splashExitAnimation).toContain("DURATION_MS = 100L");
  expect(splashExitAnimation).toContain(".setDuration(DURATION_MS)");
  expect(splashExitAnimation).toContain("NativeStartupTrace.markSplashAnimationStarted()");
  expect(
    splashExitAnimation.indexOf("NativeStartupTrace.markSplashRemoved(cancelled)"),
  ).toBeGreaterThan(splashExitAnimation.indexOf("view.remove()"));
  expect(splashExitAnimation).not.toContain("SplashScreenManager.hide()");
  expect(connectionService).toContain('"app.splash_removed"');
  expect(mainActivity).not.toContain("setTheme(R.style.AppTheme)");
  expect(nativeStyles).toContain('parent="Theme.SplashScreen"');
  expect(nativeStyles).toContain("@drawable/codewide_splash_mark");
  expect(nativeStyles).toContain("@style/AppTheme");
  expect(nativeColors).toContain('<color name="splashscreen_background">#101011</color>');
  expect(splashMark).toContain('android:pathData="M80.6,33C75,26');
  expect(rootLayout).not.toContain("<ActivityIndicator");
  expect(rootLayout).not.toContain("Loading interface");
  expect(rootLayout).toContain('testID="root-suspense-state"');
  expect(rootLayout).toContain("CodeWide");
});

it("keeps a dependency-light root crash recovery surface", () => {
  expect(rootLayout).toContain("<AppErrorBoundary>");
  expect(rootLayout).toContain("<GlobalErrorBoundaryHost>");
  expect(rootLayout).toContain("<RootApplication />");
  expect(rootLayout).toContain("export function ErrorBoundary");
  expect(rootLayout).toContain("<RootFailure");
  expect(rootLayout).toContain('testID="root-boot-state"');
  expect(rootLayout).toContain("...Ionicons.font");
  expect(rootLayout).toContain("...MaterialIcons.font");
  expect(rootLayout).not.toContain("if (!fontsLoaded && fontError === null) return null");
  expect(appErrorBoundary).toContain("getDerivedStateFromError");
  expect(appErrorBoundary).toContain("componentDidCatch");
  expect(appErrorBoundary).toContain('testID="root-error-boundary"');
  expect(appErrorBoundary).toContain('from "./crashRecovery"');
  expect(appErrorBoundary).toContain("await reloadPublishedApp()");
  expect(appErrorBoundary).toContain("DevSettings.reload()");
  expect(appErrorBoundary).toContain("await copyCrashReport(report)");
  expect(appErrorBoundary).not.toContain('import * as Clipboard from "expo-clipboard"');
  expect(appErrorBoundary).not.toContain('import * as Updates from "expo-updates"');
  expect(crashRecovery).toContain('await import("expo-updates")');
  expect(crashRecovery).toContain("await reloadAsync()");
  expect(crashRecovery).toContain('await import("expo-clipboard")');
  expect(crashRecovery).toContain("await setStringAsync(report)");
  expect(crashRecovery).not.toContain('import * as Clipboard from "expo-clipboard"');
  expect(crashRecovery).not.toContain('import * as Updates from "expo-updates"');
  expect(appErrorBoundary).not.toContain("op-sqlite");
  expect(appErrorBoundary).not.toContain("tanstack");
  expect(appEntry.indexOf('import "./src/ui/install-global-error-handler"')).toBeLessThan(
    appEntry.indexOf('import "expo-router/entry"'),
  );
  expect(globalErrorStore).toContain("setGlobalHandler");
  expect(globalErrorStore).toContain('reportGlobalError(error, "global-handler", true)');
});

it("packages icon fonts as permanent Android assets under the library's exact family names", () => {
  expect(gradle).toContain("sourceSets.main.assets.srcDir(iconFontAssetsDir)");
  expect(gradle).toContain('dependsOn("prepareIconFontAssets")');
  expect(gradle).toContain('include "Ionicons.ttf", "MaterialIcons.ttf"');
  expect(gradle).toContain('into "fonts"');
  expect(gradle).toContain('name == "Ionicons.ttf" ? "ionicons.ttf" : "material.ttf"');
  expect(gradle).toContain('throw new GradleException("Required UI icon font is missing: $name")');
  expect(gradle).toContain('tasks.register("cleanReleaseReactResources")');
  expect(gradle).toContain('delete(file("$buildDir/generated/res/react/release"))');
  expect(gradle).toContain('it.name == "createBundleReleaseJsAndAssets"');
  expect(gradle).toContain("dependsOn(cleanReleaseReactResources)");
});

it("enables signed self-hosted updates only when an endpoint is configured", () => {
  expect(appConfig.expo.updates.enabled).toBe(true);
  expect(appConfig.expo.updates.url).toBe("https://updates.example.invalid/api/updates");
  expect(manifest).toContain(
    'android:name="expo.modules.updates.EXPO_UPDATE_URL" android:value="${expoUpdatesUrl}"',
  );
  expect(gradle).toContain('System.getenv("CODEWIDE_UPDATE_URL")');
  expect(gradle).toContain("expoUpdatesEnabled: codeWideUpdatesEnabled.toString()");
  expect(gradle).toContain('expoUpdatesUrl: codeWideUpdateUrl ?: ""');
  expect(appConfig.expo.updates.checkAutomatically).toBe("NEVER");
  expect(appConfig.expo.updates.fallbackToCacheTimeout).toBe(0);
  expect(appConfig.expo.updates.codeSigningCertificate).toBe("./certs/certificate.pem");
  expect(manifest).toContain(
    'android:name="expo.modules.updates.ENABLED" android:value="${expoUpdatesEnabled}"',
  );
  expect(manifest).toContain(
    'android:name="expo.modules.updates.EXPO_UPDATES_CHECK_ON_LAUNCH" android:value="NEVER"',
  );
  expect(manifest).toContain(
    'android:name="expo.modules.updates.EXPO_UPDATES_LAUNCH_WAIT_MS" android:value="0"',
  );
  expect(manifest).toContain(
    `android:name="expo.modules.updates.EXPO_RUNTIME_VERSION" android:value="${appConfig.expo.runtimeVersion}"`,
  );
  expect(manifest).toContain('android:name="expo.modules.updates.CODE_SIGNING_CERTIFICATE"');
  expect(otaPrefetch).toContain("Updates.checkForUpdateAsync()");
  expect(otaPrefetch).toContain("Updates.fetchUpdateAsync()");
  expect(otaPrefetch).not.toContain("Updates.reloadAsync()");
  expect(otaPrefetch).toMatch(/const CHECK_INTERVAL_MS = 30 \* 60 \* 1_?000/u);
  expect(otaPrefetch).toMatch(/const RETRY_INTERVAL_MS = 30 \* 1_?000/u);
  expect(otaPrefetch).toContain("if (!force && Date.now() < nextCheckAt)");
  expect(otaPrefetch).toContain('if (state === "active")');
  expect(otaPrefetch).toContain("startPrefetch(true);");
  expect(otaPrefetch).toContain("let nextCheckAt = Date.now() + RETRY_INTERVAL_MS");
  expect(otaPrefetch.slice(0, otaPrefetch.indexOf("setInterval("))).not.toContain(
    "startPrefetch(true);",
  );
});

it("dispatches foreground attach off the UI thread without restoring every server", () => {
  const dispatch = connectionService.slice(
    connectionService.indexOf("override fun onStartCommand"),
    connectionService.indexOf("override fun onDestroy"),
  );
  expect(dispatch).toContain('recoverInBackground(id, "attach")');
  const attach = dispatch.slice(dispatch.indexOf("ACTION_ATTACH"), dispatch.indexOf("ACTION_CLOSE"));
  expect(attach).toContain("terminalSessionManager.activateGeneration()");
  expect(attach).not.toContain("restoreLegacySync()");
  const wake = connectionService.slice(
    connectionService.indexOf("fun wake(connectionId:"),
    connectionService.indexOf("private fun wakeRecovered("),
  );
  expect(wake).toContain('recoverInBackground(connectionId, "wake")');
  expect(wake).not.toContain("credentialsStore.get");
  expect(connectionService).toContain("if (socket != null) return");
  expect(connectionService).toContain('"connection.runtime_attach"');
  expect(connectionService).toContain('"lockWaitMs"');
});

it("permits cleartext only for local forwards and the explicit Relay IP", () => {
  expect(manifest).toContain('android:usesCleartextTraffic="false"');
  expect(manifest).toContain('android:networkSecurityConfig="@xml/network_security_config"');
  expect(networkSecurity).toContain('<base-config cleartextTrafficPermitted="false"');
  expect(networkSecurity).toContain(">localhost</domain>");
  expect(networkSecurity).toContain(">127.0.0.1</domain>");
  expect(networkSecurity).toContain(">[::1]</domain>");
  expect(networkSecurity).toContain(">10.0.2.2</domain>");
  expect(networkSecurity).toContain(">45.142.36.65</domain>");
  expect(networkSecurity).not.toContain('includeSubdomains="true"');
});
