import { constants, createReadStream } from "node:fs";
import { access, stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";

import { chromium } from "@playwright/test";

import { runCommand } from "./process.ts";

const MINIMUM_VIDEO_BYTES = 4_096;
const MEDIA_TOOL_TIMEOUT_MS = 30_000;

interface BrowserVideoResult {
  durationSeconds: number;
  height: number;
  width: number;
}

export interface VideoValidationResult extends BrowserVideoResult {
  sizeBytes: number;
  validator: "chromium" | "ffmpeg";
}

interface FfprobeOutput {
  format?: { duration?: string };
  streams?: {
    codec_type?: string;
    duration?: string;
    height?: number;
    width?: number;
  }[];
}

const BROWSER_VIDEO_VALIDATION_SCRIPT = String.raw`(async () => {
  const video = document.getElementById("recording");
  const waitForEvent = (eventName) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out waiting for video " + eventName)), 10000);
    const finish = (callback) => (event) => {
      clearTimeout(timer);
      video.removeEventListener("error", onError);
      video.removeEventListener(eventName, onSuccess);
      callback(event);
    };
    const onError = finish(() => reject(new Error("Browser rejected the recorded video")));
    const onSuccess = finish(resolve);
    video.addEventListener("error", onError, { once: true });
    video.addEventListener(eventName, onSuccess, { once: true });
  });
  if (video.readyState < HTMLMediaElement.HAVE_METADATA) await waitForEvent("loadedmetadata");
  const durationSeconds = video.duration;
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error("Recorded video has no finite positive duration");
  }
  if (video.videoWidth <= 0 || video.videoHeight <= 0) {
    throw new Error("Recorded video has invalid dimensions");
  }
  const seekTarget = durationSeconds > 0.1 ? Math.min(durationSeconds / 2, durationSeconds - 0.05) : 0;
  if (seekTarget > 0) {
    video.currentTime = seekTarget;
    await waitForEvent("seeked");
  }
  const decodedFrame = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out decoding a recorded video frame")), 10000);
    video.requestVideoFrameCallback(() => {
      clearTimeout(timer);
      resolve(undefined);
    });
  });
  await video.play();
  await decodedFrame;
  video.pause();
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("Browser canvas is unavailable for video validation");
  context.drawImage(video, 0, 0);
  context.getImageData(0, 0, 1, 1);
  return { durationSeconds, height: video.videoHeight, width: video.videoWidth };
})()`;

/** Proves that a recorded scenario video exists and contains a decodable frame. */
export async function validateRecordedVideo(filePath: string): Promise<VideoValidationResult> {
  const file = await stat(filePath).catch((error: unknown) => {
    throw new Error(`Scenario video does not exist: ${filePath}`, { cause: error });
  });
  if (!file.isFile()) throw new Error(`Scenario video is not a regular file: ${filePath}`);
  if (file.size < MINIMUM_VIDEO_BYTES) {
    throw new Error(
      `Scenario video is too small to be a real recording: ${file.size} bytes (minimum ${MINIMUM_VIDEO_BYTES})`,
    );
  }

  const [ffprobePath, ffmpegPath] = await Promise.all([
    findExecutable("ffprobe"),
    findExecutable("ffmpeg"),
  ]);
  if (ffprobePath !== null && ffmpegPath !== null) {
    const media = await validateWithFfmpeg(filePath, ffprobePath, ffmpegPath);
    return { ...media, sizeBytes: file.size, validator: "ffmpeg" };
  }

  const media = await validateWithBrowser(filePath, file.size);
  return { ...media, sizeBytes: file.size, validator: "chromium" };
}

async function validateWithFfmpeg(
  filePath: string,
  ffprobePath: string,
  ffmpegPath: string,
): Promise<BrowserVideoResult> {
  const cwd = path.dirname(filePath);
  const probe = await runCommand(
    ffprobePath,
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=codec_type,width,height,duration:format=duration",
      "-of",
      "json",
      filePath,
    ],
    { cwd, timeoutMs: MEDIA_TOOL_TIMEOUT_MS },
  );
  const parsed = parseProbeOutput(probe.stdout);
  await runCommand(
    ffmpegPath,
    ["-v", "error", "-i", filePath, "-map", "0:v:0", "-frames:v", "1", "-f", "null", "-"],
    { cwd, timeoutMs: MEDIA_TOOL_TIMEOUT_MS },
  );
  return parsed;
}

function parseProbeOutput(output: string): BrowserVideoResult {
  let probe: FfprobeOutput;
  try {
    probe = JSON.parse(output) as FfprobeOutput;
  } catch (error) {
    throw new Error("ffprobe returned invalid JSON for the scenario video", { cause: error });
  }
  const stream = probe.streams?.find((candidate) => candidate.codec_type === "video");
  if (stream === undefined) throw new Error("Scenario recording has no video stream");
  const durationSeconds = Number(stream.duration ?? probe.format?.duration);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error("Scenario recording has no finite positive duration");
  }
  const height = stream?.height ?? 0;
  const width = stream?.width ?? 0;
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new Error("Scenario recording has invalid video dimensions");
  }
  return { durationSeconds, height, width };
}

async function validateWithBrowser(
  filePath: string,
  sizeBytes: number,
): Promise<BrowserVideoResult> {
  const server = createVideoServer(filePath, sizeBytes);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    await closeServer(server);
    throw new Error("Could not bind the scenario video validation server");
  }
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ["--autoplay-policy=no-user-gesture-required"],
    });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: "domcontentloaded" });
    return await page.evaluate<BrowserVideoResult>(BROWSER_VIDEO_VALIDATION_SCRIPT);
  } catch (error) {
    throw new Error("Chromium could not decode the recorded scenario video", { cause: error });
  } finally {
    await browser?.close();
    await closeServer(server);
  }
}

function createVideoServer(filePath: string, sizeBytes: number) {
  return createServer((request, response) => {
    if (request.url === "/") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(
        '<!doctype html><meta charset="utf-8"><video id="recording" muted playsinline preload="auto" src="/recording.mp4"></video>',
      );
      return;
    }
    if (request.url !== "/recording.mp4") {
      response.writeHead(404).end();
      return;
    }
    const range = parseByteRange(request.headers.range, sizeBytes);
    const start = range?.start ?? 0;
    const end = range?.end ?? sizeBytes - 1;
    const headers: Record<string, number | string> = {
      "Accept-Ranges": "bytes",
      "Content-Length": end - start + 1,
      "Content-Type": "video/mp4",
    };
    if (range !== null) headers["Content-Range"] = `bytes ${start}-${end}/${sizeBytes}`;
    response.writeHead(range === null ? 200 : 206, headers);
    createReadStream(filePath, { start, end }).pipe(response);
  });
}

function parseByteRange(
  header: string | undefined,
  sizeBytes: number,
): { end: number; start: number } | null {
  if (header === undefined) return null;
  const match = /^bytes=(\d+)-(\d*)$/u.exec(header);
  if (match === null) return null;
  const start = Number(match[1]);
  const requestedEnd = match[2] === "" ? sizeBytes - 1 : Number(match[2]);
  if (!Number.isInteger(start) || start < 0 || start >= sizeBytes) return null;
  const end = Math.min(requestedEnd, sizeBytes - 1);
  if (!Number.isInteger(end) || end < start) return null;
  return { end, start };
}

async function findExecutable(command: string): Promise<string | null> {
  const searchPath = process.env.PATH;
  if (searchPath === undefined) return null;
  for (const directory of searchPath.split(path.delimiter)) {
    if (directory === "") continue;
    const candidate = path.join(directory, command);
    if (
      await access(candidate, constants.X_OK)
        .then(() => true)
        .catch(() => false)
    )
      return candidate;
  }
  return null;
}

function closeServer(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
}
