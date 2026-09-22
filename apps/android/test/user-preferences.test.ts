import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  DEFAULT_DOCUMENT_VIEWER_PREFERENCES,
  decodeDocumentViewerPreferences,
  documentReadingWidth,
  encodeDocumentViewerPreferences,
  normalizeDocumentTextScale,
} from "../src/data/user-preferences";
import {
  DEFAULT_GLOBAL_VOICE,
  decodeGlobalVoicePreference,
  encodeGlobalVoicePreference,
} from "../src/data/globalVoicePreferences";
import {
  DEFAULT_GLOBAL_VOICE_ORB_STYLE,
  decodeGlobalVoiceOrbStyle,
  encodeGlobalVoiceOrbStyle,
  GLOBAL_VOICE_ORB_STYLE_PREFERENCE_ID,
} from "../src/data/globalVoiceOrbStyle";
import { getUserPreferencesDatabase } from "../src/data/user-preferences-database.web";
import {
  decodeAppLockPreferences,
  encodeAppLockPreferences,
} from "../src/data/app-lock-preferences";
import {
  decodeVoiceAssistantPersonality,
  encodeVoiceAssistantPersonality,
  VOICE_ASSISTANT_PERSONALITY_FIELD_MAX_LENGTH,
} from "../src/data/voiceAssistantPersonality";
import {
  decodePersonalVoiceFilterPreferences,
  encodePersonalVoiceFilterPreferences,
} from "../src/data/personalVoiceFilterPreferences";

const nativeDatabase = readFileSync(
  new URL("../src/data/user-preferences-database.native.ts", import.meta.url),
  "utf8",
);

describe("user preferences", () => {
  it("round-trips document viewer preferences", () => {
    expect(
      decodeDocumentViewerPreferences(
        encodeDocumentViewerPreferences({
          textScale: 1.2,
          layoutMode: "reading",
        }),
      ),
    ).toEqual({ textScale: 1.2, layoutMode: "reading" });
  });

  it("falls back safely for corrupt or obsolete stored values", () => {
    expect(decodeDocumentViewerPreferences("not json")).toEqual(
      DEFAULT_DOCUMENT_VIEWER_PREFERENCES,
    );
    expect(decodeDocumentViewerPreferences('{"textScale":99,"layoutMode":"obsolete"}')).toEqual({
      textScale: 1.4,
      layoutMode: "wide",
    });
    expect(normalizeDocumentTextScale(Number.NaN)).toBe(1);
  });

  it("keeps reading measure stable as the text scale changes", () => {
    expect(documentReadingWidth(0.8)).toBe(512);
    expect(documentReadingWidth(1)).toBe(640);
    expect(documentReadingWidth(1.4)).toBe(896);
  });

  it("persists device-wide preferences in the durable settings database", () => {
    expect(nativeDatabase).toContain('id: "user-preferences-v1"');
    expect(nativeDatabase).toContain("database: getSettingsSqliteDatabase()");
    expect(nativeDatabase).toContain("await transaction.isPersisted.promise");
  });

  it("stores biometric app lock as a fail-closed boolean preference", () => {
    expect(decodeAppLockPreferences(encodeAppLockPreferences({ enabled: true }))).toEqual({
      enabled: true,
    });
    expect(decodeAppLockPreferences('{"enabled":"yes"}')).toEqual({ enabled: false });
    expect(decodeAppLockPreferences("not json")).toEqual({ enabled: false });
  });

  it("round-trips only supported Global Voice selections", () => {
    expect(decodeGlobalVoicePreference(encodeGlobalVoicePreference("juniper"))).toBe("juniper");
    expect(decodeGlobalVoicePreference('{"voice":"spruce"}')).toBe("spruce");
    expect(JSON.parse(encodeGlobalVoicePreference("cove"))).toEqual({
      schemaVersion: 1,
      voice: "cove",
    });
    expect(decodeGlobalVoicePreference('{"voice":"unknown"}')).toBe(DEFAULT_GLOBAL_VOICE);
    expect(decodeGlobalVoicePreference('{"schemaVersion":2,"voice":"cove"}')).toBe(
      DEFAULT_GLOBAL_VOICE,
    );
    expect(decodeGlobalVoicePreference("not json")).toBe(DEFAULT_GLOBAL_VOICE);
  });

  it("keeps the experimental personal voice filter opt-in and fail-disabled", () => {
    expect(decodePersonalVoiceFilterPreferences(null)).toEqual({ enabled: false });
    expect(
      decodePersonalVoiceFilterPreferences(encodePersonalVoiceFilterPreferences({ enabled: true })),
    ).toEqual({ enabled: true });
    expect(decodePersonalVoiceFilterPreferences('{"enabled":true,"schemaVersion":2}')).toEqual({
      enabled: false,
    });
    expect(decodePersonalVoiceFilterPreferences("not json")).toEqual({ enabled: false });
  });

  it("keeps Voice Assistant personality separate, versioned and bounded", () => {
    const personality = {
      character: "  Calm and candid  ",
      communicationStyle: "Warm\r\nand concise",
      rules: "State uncertainty clearly",
    };

    expect(decodeVoiceAssistantPersonality(encodeVoiceAssistantPersonality(personality))).toEqual({
      character: "Calm and candid",
      communicationStyle: "Warm\nand concise",
      rules: "State uncertainty clearly",
    });
    expect(JSON.parse(encodeVoiceAssistantPersonality(personality))).toMatchObject({
      schemaVersion: 1,
    });
    expect(
      decodeVoiceAssistantPersonality(
        JSON.stringify({
          character: "x".repeat(VOICE_ASSISTANT_PERSONALITY_FIELD_MAX_LENGTH + 1),
          schemaVersion: 1,
        }),
      ).character,
    ).toHaveLength(VOICE_ASSISTANT_PERSONALITY_FIELD_MAX_LENGTH);
    expect(decodeVoiceAssistantPersonality("not json")).toEqual({
      character: "",
      communicationStyle: "",
      rules: "",
    });
  });

  it("keeps existing users on Nebula and rejects corrupt or unknown orb styles", () => {
    expect(decodeGlobalVoiceOrbStyle(null)).toBe(DEFAULT_GLOBAL_VOICE_ORB_STYLE);
    expect(decodeGlobalVoiceOrbStyle(encodeGlobalVoicePreference("juniper"))).toBe(
      DEFAULT_GLOBAL_VOICE_ORB_STYLE,
    );
    expect(decodeGlobalVoiceOrbStyle("not json")).toBe(DEFAULT_GLOBAL_VOICE_ORB_STYLE);
    expect(decodeGlobalVoiceOrbStyle('{"schemaVersion":1,"style":"unknown"}')).toBe(
      DEFAULT_GLOBAL_VOICE_ORB_STYLE,
    );
    expect(decodeGlobalVoiceOrbStyle('{"schemaVersion":2,"style":"particles"}')).toBe(
      DEFAULT_GLOBAL_VOICE_ORB_STYLE,
    );
  });

  it("persists the independent orb style in its own preference record", async () => {
    const database = getUserPreferencesDatabase();
    expect(
      decodeGlobalVoiceOrbStyle(
        database.collection.get(GLOBAL_VOICE_ORB_STYLE_PREFERENCE_ID)?.value,
      ),
    ).toBe(DEFAULT_GLOBAL_VOICE_ORB_STYLE);

    await database.update(GLOBAL_VOICE_ORB_STYLE_PREFERENCE_ID, () =>
      encodeGlobalVoiceOrbStyle("particles"),
    );

    expect(
      decodeGlobalVoiceOrbStyle(
        database.collection.get(GLOBAL_VOICE_ORB_STYLE_PREFERENCE_ID)?.value,
      ),
    ).toBe("particles");
    expect(JSON.parse(encodeGlobalVoiceOrbStyle("particles"))).toEqual({
      schemaVersion: 1,
      style: "particles",
    });
  });
});
