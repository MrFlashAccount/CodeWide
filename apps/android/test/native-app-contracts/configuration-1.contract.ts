import { expect, it } from "vitest";
import { sourceHasJsxElement, sourceObjectDeclaration } from "../source-contract";
import { calmSpinner, waveText, threadTitle, voiceAura } from "./presentation-sources";
import { reducedMotionStore, nativeShimmerTextHost, screen } from "./platform-sources";
import {
  ownerTurnFooter,
  ownerCard,
  ownerTurnContexts,
  ownerTurnActivity,
} from "./conversation-turns-sources";
import {
  nativePackage,
  nativeShimmerView,
  performanceModule,
  gradle,
  gradleProperties,
  appPackage,
  rootPackage,
  nativeModule,
} from "./native-sources";
import { ownerProtocolBlock } from "./conversation-protocol-sources";
import { ownerComposerMicrophone, ownerSubmission } from "./composer-sources";
import { readFileSync } from "node:fs";
import { voiceController } from "./voice-runtime-sources";
import {
  androidSettings,
  rootGradle,
  baselineGradle,
  baselineManifest,
  baselineGenerator,
  startupBenchmark,
  androidGradleScript,
} from "./native-sources-1";

it("keeps running indicators visible, consistent and reduced-motion aware", () => {
  const conversationTimeline = readFileSync(
    new URL("../../src/features/conversation/ConversationTimelineContent.tsx", import.meta.url),
    "utf8",
  );
  expect(calmSpinner).toContain("function CalmSpinner");
  expect(waveText).toContain("function WaveText");
  expect(reducedMotionStore).toContain('AccessibilityInfo.addEventListener("reduceMotionChanged"');
  expect(waveText).toContain("useReducedMotionPreference()");
  expect(ownerTurnFooter).toMatch(/durationMs=\{3_?000\}/u);
  const shimmerRegistration = 'requireNativeComponent<NativeShimmerTextProps>("CodexShimmerText")';
  expect(nativeShimmerTextHost).toContain(shimmerRegistration);
  expect(
    `${waveText}\n${nativeShimmerTextHost}`.match(
      /requireNativeComponent<NativeShimmerTextProps>\("CodexShimmerText"\)/gu,
    ) ?? [],
  ).toHaveLength(1);
  expect(waveText).toContain('usePerformanceExperiment("disableTextShimmer")');
  expect(waveText).toContain("const animated = !reducedMotion && !textShimmerDisabled");
  expect(calmSpinner).toContain('borderTopColor: "transparent"');
  expect(calmSpinner).toContain("<ActivityIndicator");
  expect(screen).not.toContain("withRepeat(");
  expect(ownerCard).toContain("{isRunning ? (");
  expect(
    sourceHasJsxElement(ownerCard, "WaveText", [
      "containerStyle={styles.cardTitleWave}",
      'key="running-title"',
      "style={styles.cardTitle}",
      "text={title}",
    ]),
  ).toBe(true);
  expect(screen).not.toContain("autoExpandWhileRunning=");
  expect(screen).not.toContain("function AgentBubbleHeader");
  expect(screen).not.toContain('testID="active-turn-shimmer"');
  expect(screen).not.toContain('text="working"');
  expect(threadTitle).toContain('testID="running-thread-title-shimmer"');
  expect(ownerTurnFooter).toContain('testID="running-turn-footer-label"');
  expect(screen).not.toContain('testID="running-turn-footer-shimmer"');
  expect(waveText).toContain('testID = "active-text-shimmer"');
  expect(waveText).not.toContain("MaskedView");
  expect(waveText).not.toContain("useSharedValue");
  expect(waveText).toContain("styles.measure");
  expect(nativePackage).toContain("NativeShimmerTextManager()");
  expect(nativePackage.match(/NativeShimmerTextManager\(\)/gu) ?? []).toHaveLength(1);
  expect(nativeShimmerView).toContain("LinearGradient(");
  expect(nativeShimmerView).toContain("StaticLayout.Builder.obtain");
  expect(nativeShimmerView).toContain("setMaxLines(pendingNumberOfLines)");
  expect(waveText).toContain("numberOfLines={numberOfLines}");
  expect(nativeShimmerView).toContain(
    "class NativeShimmerTextView(context: Context) : ViewGroup(context)",
  );
  expect(nativeShimmerView).toContain("canvas.clipPath(textPath)");
  expect(nativeShimmerView).toContain("bandView.animate()");
  expect(nativeShimmerView).toContain(".translationX(sweep.endX)");
  const shimmerLayout = nativeShimmerView.slice(
    nativeShimmerView.indexOf("override fun onLayout("),
    nativeShimmerView.indexOf("override fun onDraw("),
  );
  expect(shimmerLayout).toContain("bandView.measure(");
  expect(shimmerLayout).toContain("sweepFor(right - left, bottom - top)");
  expect(nativeShimmerView).toContain("textPath.addPath(linePath)");
  expect(nativeShimmerView).toMatch(/paint\.getTextPath\([\s\S]*?linePath,\s*\)/u);
  expect(nativeShimmerView).toContain("SWEEP_DURATION_MS = 2_500L");
  expect(nativeShimmerView).not.toContain("Choreographer");
  expect(nativeShimmerView).not.toContain("onShimmerFrame");
  expect(nativeShimmerView).not.toContain("setLayerType(");
  expect(performanceModule).toContain('memoryStatBytes(memory, "summary.graphics")');
  expect(performanceModule).toContain('putDouble("graphicsPssBytes"');
  const shellStyle = sourceObjectDeclaration(waveText, "shell");
  expect(shellStyle).toContain('alignSelf: "center"');
  expect(shellStyle).toContain('justifyContent: "center"');
  expect(waveText).not.toContain('alignSelf: "flex-start"');
  expect(screen).not.toContain("cardTitleRunning");
  expect(screen).not.toContain("function WaveTextChunk");
  expect(screen).not.toContain("interpolateColor(");
  expect(ownerTurnContexts).toContain("const ActiveToolCallContext = createContext(false)");
  expect(ownerTurnActivity).toContain(
    "value={shouldAutoExpand && index === part.blocks.length - 1}",
  );
  expect(ownerCard).toContain("|| activeToolCall");
  expect(ownerProtocolBlock).toContain(
    'reasoningActivityTitle(block.body, activeToolCall ? "inProgress" : block.status)',
  );
  expect(screen).not.toContain("voiceRetryAvailable && !voiceRetryReady");
  expect(ownerComposerMicrophone).toMatch(
    /disabled=\{\s*editingQueuedMessage \|\|\s*\(voicePhase === "finishing" && !voiceRetryAvailable\)\s*\}/u,
  );
  expect(ownerSubmission).toContain(
    'const send = (textOverride?: string, preference: ComposerSendPreference = "start") =>',
  );
  expect(ownerSubmission).toMatch(
    /const text = \(\s*textOverride \?\? markdownForComposerSubmission\(composerMarkdownRef\.current\)\s*\)\.trim\(\)/u,
  );
  expect(ownerSubmission).toMatch(
    /const sentAttachments = composerUploads\.readyAttachments\(\s*composerUploadScope,\s*latestAttachmentsRef\.current\.latest,?\s*\)/u,
  );
  expect(conversationTimeline).toContain(
    "beginQueuedComposerEdit={props.queueEditActionsBinding.beginQueuedComposerEdit}",
  );
  expect(ownerSubmission).toMatch(
    /resolveComposerSendMode\(\s*preference,\s*threadLifecycleActive,\s*currentTurnId,?\s*\)/u,
  );
  expect(ownerSubmission).toContain("send(undefined, id)");
  expect(screen).not.toContain("setSendMode(id)");
  expect(screen).not.toContain("selected: effectiveSendMode");
  expect(voiceController).toContain("if (previousFinish !== null)");
  expect(voiceController).toContain("await previousFinish.catch(() => undefined);");
  expect(voiceController).toContain("sendAfter?.(finalDraft)");
  expect(screen).not.toContain("<ActivityIndicator size={14} color={colors.accent} />");
});

it("keeps the release Baseline Profile generator and comparison benchmark wired", () => {
  expect(androidSettings).toContain("include ':baselineprofile'");
  expect(rootGradle).toContain("androidx.baselineprofile.gradle.plugin:1.4.1");
  expect(gradle).toContain('apply plugin: "androidx.baselineprofile"');
  expect(gradle).toContain('implementation("androidx.profileinstaller:profileinstaller:1.4.1")');
  expect(gradle).toContain('baselineProfile project(":baselineprofile")');
  expect(gradle).toContain("automaticGenerationDuringBuild false");
  expect(gradle).toContain("saveInSrc true");
  expect(baselineGradle).toContain('targetProjectPath = ":app"');
  expect(baselineGradle).toContain("benchmark-macro-junit4:1.4.1");
  expect(baselineGradle).toContain("useConnectedDevices true");
  expect(baselineManifest).toBe("<manifest />\n");
  expect(baselineGenerator).toContain("includeInStartupProfile = false");
  expect(baselineGenerator).toContain("startActivityAndWait()");
  expect(startupBenchmark).toContain("CompilationMode.None()");
  expect(startupBenchmark).toContain("BaselineProfileMode.Require");
  expect(startupBenchmark).toContain("StartupTimingMetric()");
  expect(startupBenchmark).toContain("FrameTimingMetric()");
});

it("keeps downloadable release APKs arm64-only without narrowing debug or bundle builds", () => {
  expect(gradleProperties).toContain("reactNativeArchitectures=arm64-v8a,x86_64");
  expect(gradleProperties).toContain("android.enableMinifyInReleaseBuilds=true");
  expect(gradleProperties).toContain("android.enableShrinkResourcesInReleaseBuilds=true");
  expect(androidGradleScript).toContain("assembleRelease|*:assembleRelease)");
  expect(androidGradleScript).toContain(
    "release_architectures=${CODEWIDE_RELEASE_ARCHITECTURES:-arm64-v8a}",
  );
  expect(androidGradleScript).toContain(
    'set -- "-PreactNativeArchitectures=${release_architectures}" "$@"',
  );
  expect(androidGradleScript).not.toContain("bundleRelease|*:bundleRelease)");
});

it("does not package unused Skia native binaries", () => {
  expect(appPackage.dependencies["@shopify/react-native-skia"]).toBeUndefined();
  expect(rootPackage.pnpm?.onlyBuiltDependencies ?? []).not.toContain("@shopify/react-native-skia");
  expect(voiceAura).toContain("setNativeVoiceAuraState");
  expect(nativeModule).toContain("VoiceAuraRenderEffect");
});
