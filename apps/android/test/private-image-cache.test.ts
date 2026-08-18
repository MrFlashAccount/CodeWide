import { beforeEach, describe, expect, it, vi } from "vitest";

const fileSystem = vi.hoisted(() => ({
  finalExists: false,
  failNextDownload: false,
  deleteAsync: vi.fn(async () => undefined),
  downloadAsync: vi.fn(async (_uri: string, target: string) => {
    if (fileSystem.failNextDownload) {
      fileSystem.failNextDownload = false;
      throw new Error("connection reset");
    }
    return { uri: target, status: 200, headers: {}, mimeType: "image/png" };
  }),
  getInfoAsync: vi.fn(async () => ({ exists: fileSystem.finalExists, size: fileSystem.finalExists ? 128 : 0 })),
  makeDirectoryAsync: vi.fn(async () => undefined),
  moveAsync: vi.fn(async () => {
    fileSystem.finalExists = true;
  }),
  writeAsStringAsync: vi.fn(async () => undefined),
}));

vi.mock("expo-crypto", () => ({
  CryptoDigestAlgorithm: { SHA256: "SHA256" },
  digestStringAsync: vi.fn(async () => "cache-key"),
}));

vi.mock("expo-file-system/legacy", () => ({
  cacheDirectory: "file:///cache/",
  deleteAsync: fileSystem.deleteAsync,
  downloadAsync: fileSystem.downloadAsync,
  getInfoAsync: fileSystem.getInfoAsync,
  makeDirectoryAsync: fileSystem.makeDirectoryAsync,
  moveAsync: fileSystem.moveAsync,
  writeAsStringAsync: fileSystem.writeAsStringAsync,
}));

import { materializePrivateImageUri } from "../src/rendering/private-image-cache.native";

describe("private image cache", () => {
  beforeEach(() => {
    fileSystem.finalExists = false;
    fileSystem.failNextDownload = false;
    vi.clearAllMocks();
  });

  it("does not promote an interrupted download and retries it", async () => {
    fileSystem.failNextDownload = true;
    const source = "https://codex.example/v1/files/preview?path=/tmp/screenshot.png";

    await expect(materializePrivateImageUri(source, { authorization: "Bearer test" })).rejects.toThrow("connection reset");

    expect(fileSystem.moveAsync).not.toHaveBeenCalled();
    expect(fileSystem.deleteAsync).toHaveBeenCalledWith(
      "file:///cache/codex-remote-private-images-v2/cache-key.png.partial",
      { idempotent: true },
    );

    await expect(materializePrivateImageUri(source, { authorization: "Bearer test" }))
      .resolves.toBe("file:///cache/codex-remote-private-images-v2/cache-key.png");
    expect(fileSystem.downloadAsync).toHaveBeenCalledTimes(2);
    expect(fileSystem.moveAsync).toHaveBeenCalledWith({
      from: "file:///cache/codex-remote-private-images-v2/cache-key.png.partial",
      to: "file:///cache/codex-remote-private-images-v2/cache-key.png",
    });
  });

  it("publishes inline image bytes atomically", async () => {
    await expect(materializePrivateImageUri("data:image/png;base64,aGVsbG8="))
      .resolves.toBe("file:///cache/codex-remote-private-images-v2/cache-key.png");

    expect(fileSystem.writeAsStringAsync).toHaveBeenCalledWith(
      "file:///cache/codex-remote-private-images-v2/cache-key.png.partial",
      "aGVsbG8=",
      { encoding: "base64" },
    );
    expect(fileSystem.moveAsync).toHaveBeenCalledOnce();
  });
});
