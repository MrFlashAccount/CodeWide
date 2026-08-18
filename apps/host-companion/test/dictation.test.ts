import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { DictationService } from "../src/dictation.js";

const CLIENT_ID = "phone-1";

describe("host OAuth dictation", () => {
  it("never gates dictation on client capture-source metadata", async () => {
    const authFilePath = await authFile("access-token-secret-that-is-long-enough", "account-secret");
    const service = new DictationService({ authFilePath });
    try {
      for (const captureSource of ["mic", "samsung_voice_focus", { future: "opaque-metadata" }]) {
        const sessionId = await start(service, { captureSource });
        await expect(service.handle(CLIENT_ID, "companion/dictation/cancel", { sessionId })).resolves.toEqual({ cancelled: true });
      }
    } finally {
      service.close();
    }
  });

  it("keeps OAuth on the host, wraps PCM16 as WAV and returns only transcript text", async () => {
    const authFilePath = await authFile("access-token-secret-that-is-long-enough", "account-secret");
    let uploaded: Blob | null = null;
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer access-token-secret-that-is-long-enough");
      expect(new Headers(init?.headers).get("chatgpt-account-id")).toBe("account-secret");
      expect(new Headers(init?.headers).get("originator")).toBe("codex_desktop");
      const form = init?.body;
      expect(form).toBeInstanceOf(FormData);
      const file = (form as FormData).get("file");
      expect(file).toBeInstanceOf(Blob);
      expect((form as FormData).get("language")).toBe("ru");
      uploaded = file as Blob;
      return Response.json({ text: "Привет, Codex", asset_pointer: "must-not-escape" });
    });
    const service = new DictationService({ authFilePath, fetchImpl });
    try {
      const sessionId = await start(service, {
        language: "ru",
        captureSource: "voice_communication",
        noiseSuppressor: true,
        automaticGainControl: true,
      });
      const pcm = Buffer.from([1, 0, 2, 0, 3, 0, 4, 0]);
      await service.handle(CLIENT_ID, "companion/dictation/append", {
        sessionId,
        data: pcm.toString("base64"),
        sampleRate: 24_000,
        numChannels: 1,
        samplesPerChannel: 4,
      });
      await expect(service.handle(CLIENT_ID, "companion/dictation/finish", { sessionId })).resolves.toEqual({
        text: "Привет, Codex",
      });
      const bytes = Buffer.from(await (uploaded as unknown as Blob).arrayBuffer());
      expect(bytes.subarray(0, 4).toString("ascii")).toBe("RIFF");
      expect(bytes.subarray(8, 12).toString("ascii")).toBe("WAVE");
      expect(bytes.readUInt32LE(24)).toBe(24_000);
      expect(bytes.readUInt16LE(34)).toBe(16);
      expect(bytes.readUInt32LE(40)).toBe(pcm.length);
      expect(bytes.subarray(44)).toEqual(pcm);
      expect(JSON.stringify(await service.handle(CLIENT_ID, "companion/dictation/cancel", { sessionId }))).not.toContain("secret");
    } finally {
      service.close();
    }
  });

  it("persists a client audio batch in capture order with one host append", async () => {
    const authFilePath = await authFile("access-token-secret-that-is-long-enough", "account-secret");
    let uploaded: Buffer | null = null;
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const service = new DictationService({
      authFilePath,
      fetchImpl: async (_input, init) => {
        const file = (init?.body as FormData).get("file") as Blob;
        uploaded = Buffer.from(await file.arrayBuffer());
        return Response.json({ text: "ordered" });
      },
    });
    try {
      const sessionId = await start(service);
      const first = Buffer.from([1, 0, 2, 0]);
      const second = Buffer.from([3, 0, 4, 0]);
      await service.handle(CLIENT_ID, "companion/dictation/appendBatch", {
        sessionId,
        chunks: [
          { data: first.toString("base64"), sampleRate: 24_000, numChannels: 1, samplesPerChannel: 2 },
          { data: second.toString("base64"), sampleRate: 24_000, numChannels: 1, samplesPerChannel: 2 },
        ],
      });
      await expect(service.handle(CLIENT_ID, "companion/dictation/finish", { sessionId }))
        .resolves.toEqual({ text: "ordered" });
      expect((uploaded as unknown as Buffer).subarray(44)).toEqual(Buffer.concat([first, second]));
      const telemetry = info.mock.calls
        .map(([message]) => JSON.parse(String(message)) as Record<string, unknown>)
        .find((entry) => entry.status === "dictation-openai-request");
      expect(telemetry).toMatchObject({
        httpStatus: 200,
        sampleRate: 24_000,
        numChannels: 1,
        audioBytes: 8,
        audioChunks: 2,
        appendBatches: 1,
      });
      expect(telemetry?.rmsPpm).toEqual(expect.any(Number));
      expect(telemetry?.peakPpm).toEqual(expect.any(Number));
      expect(telemetry?.quietFramePpm).toEqual(expect.any(Number));
      expect(telemetry?.longestQuietMs).toEqual(expect.any(Number));
    } finally {
      service.close();
      info.mockRestore();
    }
  });

  it("deduplicates retried batches and retains a recording across a transport reconnect", async () => {
    const authFilePath = await authFile("access-token-secret-that-is-long-enough", "account-secret");
    let uploaded: Buffer | null = null;
    const service = new DictationService({
      authFilePath,
      fetchImpl: async (_input, init) => {
        uploaded = Buffer.from(await ((init?.body as FormData).get("file") as Blob).arrayBuffer());
        return Response.json({ text: "resumed" });
      },
    });
    try {
      const sessionId = await start(service);
      const pcm = Buffer.from([1, 0, 2, 0, 3, 0, 4, 0]);
      const batch = {
        sessionId,
        batchId: "batch-0",
        chunks: [{
          data: pcm.toString("base64"),
          sampleRate: 24_000,
          numChannels: 1,
          samplesPerChannel: 4,
        }],
      };
      await service.handle(CLIENT_ID, "companion/dictation/appendBatch", batch);
      await service.handle(CLIENT_ID, "companion/dictation/appendBatch", batch);
      service.releaseClient(CLIENT_ID);

      await expect(service.handle(CLIENT_ID, "companion/dictation/finish", { sessionId }))
        .resolves.toEqual({ text: "resumed" });
      expect((uploaded as unknown as Buffer).subarray(44)).toEqual(pcm);
    } finally {
      service.close();
    }
  });

  it("trims only long quiet edges and keeps speech padding", async () => {
    const authFilePath = await authFile("access-token-secret-that-is-long-enough", "account-secret");
    let uploaded: Buffer | null = null;
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const service = new DictationService({
      authFilePath,
      fetchImpl: async (_input, init) => {
        uploaded = Buffer.from(await ((init?.body as FormData).get("file") as Blob).arrayBuffer());
        return Response.json({ text: "trimmed" });
      },
    });
    try {
      const sessionId = await start(service, { language: "ru" });
      const quiet = pcmFrame(8_000, 0);
      const speech = pcmFrame(8_000, 2_000);
      await service.handle(CLIENT_ID, "companion/dictation/appendBatch", {
        sessionId,
        chunks: [quiet, quiet, quiet, quiet, quiet, speech, speech, quiet, quiet, quiet, quiet, quiet],
      });
      await expect(service.handle(CLIENT_ID, "companion/dictation/finish", { sessionId })).resolves.toEqual({ text: "trimmed" });
      expect((uploaded as unknown as Buffer).readUInt32LE(40)).toBe(8 * 800 * 2);
      const telemetry = info.mock.calls
        .map(([message]) => JSON.parse(String(message)) as Record<string, unknown>)
        .find((entry) => entry.status === "dictation-openai-request");
      expect(telemetry).toMatchObject({
        language: "ru",
        leadingQuietMs: 500,
        trailingQuietMs: 500,
        longestQuietMs: 500,
        transcribedMs: 800,
      });
    } finally {
      service.close();
      info.mockRestore();
    }
  });

  it("rejects malformed, inconsistent and oversized audio before network access", async () => {
    const authFilePath = await authFile("access-token-secret-that-is-long-enough", "account-secret");
    const fetchImpl = vi.fn<typeof fetch>();
    const service = new DictationService({ authFilePath, fetchImpl, maxAudioBytes: 8, maxChunkBytes: 8 });
    try {
      const malformed = await start(service);
      await expect(service.handle(CLIENT_ID, "companion/dictation/append", {
        sessionId: malformed,
        data: "not base64",
        sampleRate: 24_000,
        numChannels: 1,
        samplesPerChannel: 2,
      })).rejects.toThrow("canonical base64");

      const inconsistent = await start(service);
      await service.handle(CLIENT_ID, "companion/dictation/append", audioChunk(inconsistent, 24_000, 4));
      await expect(service.handle(CLIENT_ID, "companion/dictation/append", audioChunk(inconsistent, 16_000, 4)))
        .rejects.toThrow("format changed");

      const oversized = await start(service);
      await service.handle(CLIENT_ID, "companion/dictation/append", audioChunk(oversized, 24_000, 4));
      await expect(service.handle(CLIENT_ID, "companion/dictation/append", audioChunk(oversized, 24_000, 1)))
        .rejects.toThrow("recording is too large");
      expect(fetchImpl).not.toHaveBeenCalled();
    } finally {
      service.close();
    }
  });

  it("keeps audio retryable after a Cloudflare challenge without returning its body", async () => {
    const authFilePath = await authFile("access-token-secret-that-is-long-enough", "account-secret");
    let attempts = 0;
    const service = new DictationService({
      authFilePath,
      automaticRetryBaseMs: 1,
      fetchImpl: async () => {
        attempts += 1;
        return new Response("private challenge body", {
          status: 403,
          headers: { "cf-mitigated": "challenge" },
        });
      },
    });
    try {
      const sessionId = await start(service);
      await service.handle(CLIENT_ID, "companion/dictation/append", audioChunk(sessionId, 24_000, 4));
      await expect(service.handle(CLIENT_ID, "companion/dictation/finish", { sessionId })).resolves.toEqual({
        retryable: true,
        retryAfterMs: 8,
        message: "ChatGPT transcription was blocked by Cloudflare on the host network",
      });
      expect(attempts).toBe(4);
    } finally {
      service.close();
    }
  });

  it("automatically retries an upstream failure and replays the completed transcript idempotently", async () => {
    const authFilePath = await authFile("access-token-secret-that-is-long-enough", "account-secret");
    let attempts = 0;
    const service = new DictationService({
      authFilePath,
      automaticRetryBaseMs: 1,
      fetchImpl: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("upstream reset");
        return Response.json({ text: "recovered once" });
      },
    });
    try {
      const sessionId = await start(service);
      await service.handle(CLIENT_ID, "companion/dictation/append", audioChunk(sessionId, 24_000, 4));
      await expect(service.handle(CLIENT_ID, "companion/dictation/finish", { sessionId }))
        .resolves.toEqual({ text: "recovered once" });
      await expect(service.handle(CLIENT_ID, "companion/dictation/finish", { sessionId }))
        .resolves.toEqual({ text: "recovered once" });
      expect(attempts).toBe(2);
    } finally {
      service.close();
    }
  });

  it("segments long file-backed recordings instead of imposing the old 25 MiB heap limit", async () => {
    const authFilePath = await authFile("access-token-secret-that-is-long-enough", "account-secret");
    let call = 0;
    const uploadedSizes: number[] = [];
    const service = new DictationService({
      authFilePath,
      transcriptionSegmentMs: 1,
      fetchImpl: async (_input, init) => {
        call += 1;
        const form = init?.body as FormData;
        const file = form.get("file") as Blob;
        uploadedSizes.push(file.size);
        return Response.json({ text: `part ${call}` });
      },
    });
    try {
      const sessionId = await start(service);
      await service.handle(CLIENT_ID, "companion/dictation/append", audioChunk(sessionId, 8_000, 24));
      await expect(service.handle(CLIENT_ID, "companion/dictation/finish", { sessionId }))
        .resolves.toEqual({ text: "part 1 part 2 part 3" });
      expect(uploadedSizes).toEqual([60, 60, 60]);
    } finally {
      service.close();
    }
  });

  it("retries one 401 only when Codex has already rotated the access token", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "codewide-oauth-"));
    const authFilePath = path.join(directory, "auth.json");
    await writeAuth(authFilePath, "old-access-token-secret-that-is-long-enough", "account-secret");
    const seenTokens: string[] = [];
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const token = new Headers(init?.headers).get("authorization") ?? "";
      seenTokens.push(token);
      if (seenTokens.length === 1) {
        await writeAuth(authFilePath, "new-access-token-secret-that-is-long-enough", "account-secret");
        return new Response(null, { status: 401 });
      }
      return Response.json({ text: "rotated" });
    });
    const service = new DictationService({ authFilePath, fetchImpl });
    try {
      const sessionId = await start(service);
      await service.handle(CLIENT_ID, "companion/dictation/append", audioChunk(sessionId, 24_000, 4));
      await expect(service.handle(CLIENT_ID, "companion/dictation/finish", { sessionId })).resolves.toEqual({ text: "rotated" });
      expect(seenTokens).toEqual([
        "Bearer old-access-token-secret-that-is-long-enough",
        "Bearer new-access-token-secret-that-is-long-enough",
      ]);
    } finally {
      service.close();
    }
  });

  it("retries short 429 responses automatically and honors Retry-After", async () => {
    const authFilePath = await authFile("access-token-secret-that-is-long-enough", "account-secret");
    let attempts = 0;
    const service = new DictationService({
      authFilePath,
      fetchImpl: async () => {
        attempts += 1;
        if (attempts < 4) return new Response(null, { status: 429, headers: { "retry-after": "0" } });
        return Response.json({ text: "after automatic retry" });
      },
    });
    try {
      const sessionId = await start(service);
      await service.handle(CLIENT_ID, "companion/dictation/append", audioChunk(sessionId, 24_000, 4));
      await expect(service.handle(CLIENT_ID, "companion/dictation/finish", { sessionId }))
        .resolves.toEqual({ text: "after automatic retry" });
      expect(attempts).toBe(4);
    } finally {
      service.close();
    }
  });

  it("keeps recorded audio when Retry-After exceeds the bounded automatic retry window", async () => {
    const authFilePath = await authFile("access-token-secret-that-is-long-enough", "account-secret");
    let attempts = 0;
    const uploadedAudio: Buffer[] = [];
    const service = new DictationService({
      authFilePath,
      fetchImpl: async (_input, init) => {
        attempts += 1;
        const file = (init?.body as FormData).get("file") as Blob;
        uploadedAudio.push(Buffer.from(await file.arrayBuffer()));
        if (attempts === 1) return new Response(null, { status: 429, headers: { "retry-after": "600" } });
        return Response.json({ text: "after manual retry" });
      },
    });
    try {
      const sessionId = await start(service);
      await service.handle(CLIENT_ID, "companion/dictation/append", audioChunk(sessionId, 24_000, 4));
      await expect(service.handle(CLIENT_ID, "companion/dictation/finish", { sessionId })).resolves.toEqual({
        retryable: true,
        retryAfterMs: 600_000,
        message: "OpenAI transcription is rate limited; retry in 600s",
      });
      await expect(service.handle(CLIENT_ID, "companion/dictation/finish", { sessionId }))
        .resolves.toEqual({ text: "after manual retry" });
      expect(attempts).toBe(2);
      expect(uploadedAudio[1]).toEqual(uploadedAudio[0]);
    } finally {
      service.close();
    }
  });
});

async function start(service: DictationService, params: Record<string, unknown> = {}): Promise<string> {
  const result = await service.handle(CLIENT_ID, "companion/dictation/start", params) as { sessionId: string };
  return result.sessionId;
}

function pcmFrame(sampleRate: number, value: number): Record<string, unknown> {
  const samplesPerChannel = sampleRate / 10;
  const data = Buffer.alloc(samplesPerChannel * 2);
  for (let offset = 0; offset < data.length; offset += 2) data.writeInt16LE(value, offset);
  return { data: data.toString("base64"), sampleRate, numChannels: 1, samplesPerChannel };
}

function audioChunk(sessionId: string, sampleRate: number, samplesPerChannel: number): Record<string, unknown> {
  return {
    sessionId,
    data: Buffer.alloc(samplesPerChannel * 2, 1).toString("base64"),
    sampleRate,
    numChannels: 1,
    samplesPerChannel,
  };
}

async function authFile(accessToken: string, accountId: string): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "codewide-oauth-"));
  const filePath = path.join(directory, "auth.json");
  await writeAuth(filePath, accessToken, accountId);
  return filePath;
}

async function writeAuth(filePath: string, accessToken: string, accountId: string): Promise<void> {
  await writeFile(filePath, JSON.stringify({ tokens: { access_token: accessToken, account_id: accountId, refresh_token: "never-read" } }), {
    mode: 0o600,
  });
}
