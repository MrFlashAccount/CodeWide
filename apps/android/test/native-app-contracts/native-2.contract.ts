import { expect, it } from "vitest";
import {
  deviceKeyStore,
  innerTlsTransport,
  nativeModule,
  nativeCommandStore,
  connectionService,
  nativeCommandPolicy,
  nativeCredentialsStore,
  nativeEngine,
  appPackage,
  rootLayout,
  nativeTransport,
  nativeProtocolEngine,
  preparedMicrophone,
  preparedMicrophoneEffects,
  pairRoute,
  threadRoute,
  manifest,
  nativeCodeHighlighter,
  diagramPreviewModule,
  nativePackage,
  nativeCodeManager,
  nativeCodeView,
  gradle,
  mermaidDocument,
  mermaidRuntime,
  asciiDiagramDocument,
  asciiDiagramRuntime,
  nativeFrameStore,
  fileTransferNative,
  gradleProperties,
  mainApplication,
} from "./native-sources";
import { baselineProfile, expoAssetPatch } from "./native-sources-1";

it("preserves native integration contracts — 2", () => {
  expect(deviceKeyStore).toContain(
    "fun clientKeyManager(savedServerId: String): X509ExtendedKeyManager",
  );
  expect(deviceKeyStore).toContain("ConnectionKeyManager(alias, entry)");
  expect(innerTlsTransport).toContain('DATA_TUNNEL_PATH = "/v1/e2ee-tunnel"');
  expect(innerTlsTransport).toContain('BOOTSTRAP_TUNNEL_PATH = "/v1/e2ee-bootstrap-tunnel"');
  expect(innerTlsTransport).toContain("DeviceKeyStore.clientKeyManager(saved.id)");
  expect(innerTlsTransport).toContain(
    "TunnelSocketFactory(carrier, tunnelUrl(endpoint, BOOTSTRAP_TUNNEL_PATH))",
  );
  expect(nativeModule).toContain(
    "InnerTlsTransport.bootstrapClient(pairingHttpClient, endpoint, identityPin)",
  );
  expect(nativeCommandStore).toContain(
    'database.delete("native_commands", "state = \'accepted\'", null)',
  );
  expect(nativeCommandStore).toContain("state IN ('queued', 'uncertain')");
  expect(nativeCommandStore).not.toContain("state IN ('queued', 'uncertain', 'accepted')");
  expect(connectionService).toContain("commandStore.markDelivered(sending)");
  expect(connectionService).toContain(
    'return "companion/queue/put" to JSONObject().put("command", queued)',
  );
  expect(connectionService).toContain('.put("presentation", "delivery")');
  expect(connectionService).toContain("protocolEngine.rpc(outbound.first, outbound.second)");
  expect(nativeCommandPolicy).toContain(
    '"companion/queue/steer" to NativeCommandReconciliation.IDEMPOTENT_RETRY',
  );
  expect(connectionService).toContain('"thread/turns/list"');
  expect(connectionService).toContain('.put("itemsView", "summary")');
  expect(connectionService).not.toContain(
    'JSONObject().put("threadId", threadId).put("includeTurns", true)',
  );
  expect(nativeCommandStore).toContain("fun markDelivered(command: NativeCommand)");
  expect(nativeCommandStore).toContain("state NOT IN ('failed', 'delivered')");
  expect(nativeCommandStore).toContain("MAX_DELIVERED_RECEIPTS = 250");
  expect(nativeCommandStore).toContain("MAX_RECEIPT_TEXT_CHARS = 256 * 1024");
  expect(nativeCommandStore).toContain('method == "turn/start" || method == "turn/steer"');
  expect(connectionService).not.toContain("commandStore.markAccepted(sending");
  expect(nativeModule).toContain("fun saveConnectionCredentials(connectionId: String");
  expect(nativeModule).toContain("fun attachSocket(connectionId: String");
  expect(nativeModule).toContain("fun mintStoredSession(connectionId: String");
  expect(nativeModule).not.toContain("fun mintSession(endpoint: String, capabilityToken: String");
  expect(nativeModule).not.toContain(
    "fun openSocket(connectionId: String, endpoint: String, token: String",
  );
  expect(connectionService).toContain("ACTION_ATTACH");
  expect(connectionService).toContain("private fun attach(connectionId: String)");
  expect(connectionService).toContain("if (saved == null)");
  expect(connectionService).toContain('JSONObject().put("state", "authRequired")');
  expect(connectionService).toContain("if (!saved.enabled)");
  expect(nativeCredentialsStore).toContain("fun get(connectionId: String)");
  expect(nativeCredentialsStore).toContain("synchronized(STORE_LOCK)");
  expect(nativeCredentialsStore).toContain("private val STORE_LOCK = Any()");
  expect(baselineProfile).not.toContain("CodeWideModule;->openSocket");
  expect(baselineProfile).not.toContain("NativeFrameStore;->applicationCursor");
  expect(baselineProfile).not.toContain(
    "StoredNativeSession;-><init>(Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;)V",
  );
  expect(nativeEngine).toContain("bridge.attachSocket(this.connectionId)");
  expect(deviceKeyStore).toContain("KeyProperties.KEY_ALGORITHM_EC");
  expect(deviceKeyStore).toContain('Signature.getInstance("SHA256withECDSA")');
  expect(deviceKeyStore).not.toContain("private.encoded");
  expect(appPackage.dependencies["heroui-native"]).toBeUndefined();
  expect(appPackage.dependencies.uniwind).toBeUndefined();
  expect(appPackage.dependencies["react-native-webrtc"]).toBe("124.0.8");
  expect(mainApplication.indexOf("configureWebRtcAudioDeviceModule()")).toBeLessThan(
    mainApplication.indexOf("loadReactNative(this)"),
  );
  expect(mainApplication).toContain(".setUsage(AudioAttributes.USAGE_MEDIA)");
  expect(mainApplication).toContain(
    ".setAudioSource(MediaRecorder.AudioSource.VOICE_COMMUNICATION)",
  );
  expect(mainApplication).toContain(
    ".setUseHardwareAcousticEchoCanceler(AcousticEchoCanceler.isAvailable())",
  );
  expect(mainApplication).toContain(
    ".setUseHardwareNoiseSuppressor(NoiseSuppressor.isAvailable())",
  );
  expect(mainApplication).not.toContain(".setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)");
  expect(nativePackage).not.toContain("GlobalVoiceCommunicationAudioModule");
  expect(mainApplication).toContain(".setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)");
  expect(mainApplication).toContain("WebRTCModuleOptions.getInstance().audioDeviceModule");
  expect(rootLayout).toContain("<AppRootProviders>");
  expect(nativeTransport).toContain("pendingEvents.push(event)");
  expect(nativeTransport).toMatch(
    /watchdog = setTimeout\(\(\) => \{\s*deliver\(\{ text: "timeout", type: "error" \}\);\s*\}, 30_000\)/u,
  );
  expect(nativeTransport).toContain("export function cancelVoiceRecognition");
  expect(nativeModule).toContain("voiceGeneration");
  expect(nativeModule).toContain("finishVoice(generation, recognizer");
  expect(nativeModule).toContain(
    "fun startPcmCapture(token: String, purpose: String, promise: Promise)",
  );
  expect(nativeModule).toContain(
    "fun stopPcmCapture(token: String, purpose: String, promise: Promise)",
  );
  expect(nativeModule).toContain('promise.reject("MIC_BUSY"');
  expect(nativeModule).toContain('promise.reject("MIC_LEASE_STALE"');
  expect(nativeModule).not.toContain("fun startPcmPlayback(");
  expect(nativeModule).not.toContain("fun appendPcmPlayback(");
  expect(nativeProtocolEngine).toContain(
    '"companion/dictation/finish" -> maxOf(timeoutMs, DICTATION_FINISH_RPC_TIMEOUT_MS)',
  );
  expect(nativeProtocolEngine).toContain("DICTATION_FINISH_RPC_TIMEOUT_MS = 5 * 60_000L");
  expect(nativeProtocolEngine).toContain(
    '"companion/workspace/create" -> maxOf(timeoutMs, WORKSPACE_CREATE_RPC_TIMEOUT_MS)',
  );
  expect(nativeProtocolEngine).toContain("WORKSPACE_CREATE_RPC_TIMEOUT_MS = 10 * 60_000L");
  expect(nativeProtocolEngine).toContain(
    '"thread/fork" -> maxOf(timeoutMs, THREAD_FORK_RPC_TIMEOUT_MS)',
  );
  expect(nativeProtocolEngine).toContain("THREAD_FORK_RPC_TIMEOUT_MS = 10 * 60_000L");
  expect(nativeProtocolEngine).toContain('EPHEMERAL_CONTROL_METHODS = setOf("turn/interrupt")');
  expect(nativeProtocolEngine).toContain(
    'completion(Result.failure(IllegalStateException("Connection is not live")))',
  );
  expect(preparedMicrophone).toContain("AudioFormat.ENCODING_PCM_16BIT");
  expect(preparedMicrophone).toContain("AudioRecord.Builder()");
  expect(preparedMicrophone).toContain("MediaRecorder.AudioSource.VOICE_COMMUNICATION");
  expect(preparedMicrophone).toContain("MediaRecorder.AudioSource.VOICE_RECOGNITION");
  expect(preparedMicrophone).toContain("MediaRecorder.AudioSource.MIC");
  expect(preparedMicrophone.indexOf("MediaRecorder.AudioSource.VOICE_COMMUNICATION")).toBeLessThan(
    preparedMicrophone.indexOf("MediaRecorder.AudioSource.VOICE_RECOGNITION"),
  );
  expect(preparedMicrophone.indexOf("MediaRecorder.AudioSource.VOICE_RECOGNITION")).toBeLessThan(
    preparedMicrophone.indexOf("MediaRecorder.AudioSource.MIC"),
  );
  expect(nativeModule).toContain("val activeCapture = microphone.start()");
  expect(preparedMicrophone).toContain("recorder.startRecording()");
  expect(nativeModule).toContain('putString("source", activeCapture.source.label)');
  expect(nativeModule).not.toContain("AUDIO_SAMPLE_RATE = 24_000");
  expect(preparedMicrophone).toContain("effectsFactory.create(recorder.audioSessionId)");
  expect(preparedMicrophoneEffects).toContain("AcousticEchoCanceler.create(audioSessionId)");
  expect(preparedMicrophoneEffects).toContain("NoiseSuppressor.create(audioSessionId)");
  expect(preparedMicrophoneEffects).toContain("AutomaticGainControl.create(audioSessionId)");
  expect(nativeModule).toContain('putBoolean("acousticEchoCancelerSupported"');
  expect(nativeModule).toContain('putBoolean("acousticEchoCancelerEnabled"');
  expect(nativeTransport).toContain('emitter.addListener("CodeWideAudioEvent"');
  expect(nativeTransport).toContain("const info = isPcmCaptureInfo(capture) ? capture : null");
  expect(nativeTransport).toContain('info.source === "mic"');
  expect(nativeTransport).toContain('event: "microphone.legacy_capture_started"');
  expect(pairRoute).toContain('<Redirect href="/" />');
  expect(threadRoute).toContain('<Redirect href="/" />');
  expect(pairRoute).not.toContain("<CodeWideScreen />");
  expect(threadRoute).not.toContain("<CodeWideScreen />");
  expect(manifest).toContain(
    "screenLayout|uiMode|smallestScreenSize|density|fontScale|assetsPaths",
  );
  expect(manifest).toContain('android:resizeableActivity="true"');
  expect(nativeCodeHighlighter).toContain('val sourceDiff = diff != null && language != "diff"');
  const registeredManagers = nativePackage.slice(
    nativePackage.indexOf("override fun createViewManagers"),
  );
  for (const manager of [
    "NativeCodeBlockManager",
    "AnimatedNumberManager",
    "NativeShimmerTextManager",
    "NativeRevealManager",
    "NativeStreamingRevealManager",
    "NativeFluidLayoutManager",
  ]) {
    expect(registeredManagers).toContain(`${manager}()`);
  }
  expect(nativeCodeManager).toContain('override fun getName(): String = "CodexNativeCodeBlock"');
  expect(nativeCodeView).toContain("Paint source immediately");
  expect(nativeCodeView).toContain("HIGHLIGHT_DEBOUNCE_MS");
  expect(nativeCodeHighlighter).toContain("grammar.tokenizeLine");
  expect(nativeCodeHighlighter).toContain("applyDiffBackgrounds");
  expect(gradle).toContain('implementation("io.github.rosemoe:language-textmate:0.24.4")');
  expect(gradle).toContain('implementation("io.github.rosemoe:oniguruma-native:0.24.4")');
  expect(gradle).toContain('implementation("io.github.rosemoe:editor:0.24.4")');
  expect(mermaidDocument).toContain("connect-src 'none'");
  expect(mermaidDocument).toContain("securityLevel: 'strict'");
  expect(mermaidDocument).toContain("window.diagramZoom");
  expect(mermaidDocument).toContain("window.diagramReset");
  expect(mermaidDocument).toContain(
    '#root[data-mode="inline"] #canvas svg { display: block; width: 100%',
  );
  expect(mermaidDocument).toContain(
    '#root[data-mode="fullscreen"] #stage { position: absolute; inset: 0; overflow: hidden; touch-action: none; }',
  );
  expect(mermaidDocument).toContain(
    '#root[data-mode="fullscreen"] #canvas { position: absolute; inset: 0 auto auto 0;',
  );
  expect(mermaidDocument).toContain(
    '#root[data-mode="preview"] #canvas svg { display: block; width: 100%; height: 100%;',
  );
  expect(mermaidDocument).toContain(
    "return Math.max(.02, Math.min(1, stage.clientWidth / naturalWidth, stage.clientHeight / naturalHeight));",
  );
  expect(mermaidDocument).toContain("x: (stage.clientWidth - naturalWidth * fitScale) / 2,");
  expect(mermaidDocument).toContain("y: (stage.clientHeight - naturalHeight * fitScale) / 2,");
  expect(mermaidDocument).toContain("x: center.x - viewportGesture.localX * nextScale,");
  expect(mermaidDocument).toContain("y: center.y - viewportGesture.localY * nextScale,");
  expect(mermaidDocument).not.toContain("pinchAndPan: true");
  expect(mermaidRuntime).toContain('globalThis["mermaid"]');
  expect(asciiDiagramDocument).toContain("window.renderAsciiDiagram");
  expect(asciiDiagramDocument).toContain("window.diagramUseV1AsciiPresentation");
  expect(asciiDiagramDocument).toContain("type: 'preview-ready'");
  expect(asciiDiagramDocument).toContain("'wasm-unsafe-eval'");
  expect(asciiDiagramDocument).toContain(
    "script, foreignObject, iframe, object, embed, image, use",
  );
  expect(asciiDiagramRuntime).toContain("WebAssembly.instantiate(");
  expect(asciiDiagramRuntime).toContain("window.renderSvgbob");
  expect(diagramPreviewModule).toContain("private var browser: WebView? = null");
  expect(diagramPreviewModule).toContain(
    'ASCII("ascii", "file:///android_asset/ascii-diagram-renderer.html"',
  );
  expect(diagramPreviewModule).toContain(
    'MERMAID("mermaid", "file:///android_asset/mermaid-renderer.html"',
  );
  expect(diagramPreviewModule).toContain(
    'const val PREVIEW_CACHE_DIRECTORY = "diagram-previews-v5"',
  );
  expect(nativeFrameStore).toContain(
    "applyPendingRequestEvents(connectionId, fresh.mapNotNull { it.pendingRequestPayload })",
  );
  expect(nativeProtocolEngine).toContain('emitEngineEvent(connectionId, "pendingRequests"');
  expect(nativeCommandStore).toContain("next_attempt_at INTEGER NOT NULL DEFAULT 0");
  expect(nativeCommandStore).toContain("fun nextReady(connectionId: String");
  expect(nativeCommandStore).toContain("if (lanes.add(laneKey(candidate))) add(candidate)");
  expect(connectionService).toContain("private fun scheduleOutboxWake()");
  expect(connectionService).not.toContain(
    "handler.postDelayed({ drainOutbox() }, OUTBOX_RECONCILE_DELAY_MS)",
  );
  expect(manifest).toContain('android:windowSoftInputMode="adjustResize"');
  expect(appPackage.dependencies["@legendapp/list"]).toBeDefined();
  expect(appPackage.dependencies["expo-pretext"]).toBeUndefined();
  expect(appPackage.dependencies["@shopify/flash-list"]).toBeUndefined();
  expect(fileTransferNative).not.toContain("fetch(");
  expect(fileTransferNative).not.toContain("/v1/files/");
  expect(nativeCodeView).toContain("isHorizontalScrollBarEnabled = true");
  expect(nativeTransport).toBeDefined();
  expect(expoAssetPatch).toContain("launchAssetUrl?.startsWith('https://')");
  expect(gradleProperties).toContain("EX_DEV_CLIENT_NETWORK_INSPECTOR=false");
});
