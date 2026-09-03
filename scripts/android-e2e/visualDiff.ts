import { readFile, writeFile } from "node:fs/promises";

import { chromium } from "@playwright/test";

interface VisualDiffInput {
  actualPath: string;
  baselinePath: string;
  diffPath: string;
}

export interface VisualDiffResult {
  differentPixels: number;
  height: number;
  ratio: number;
  width: number;
}

interface BrowserDiffResult extends VisualDiffResult {
  image: string;
}

interface BrowserLuminanceResult {
  luminance: number;
}

const BROWSER_DIFF_SCRIPT = String.raw`(async () => {
  const baselineImage = document.getElementById("baseline");
  const actualImage = document.getElementById("actual");
  await Promise.all([baselineImage.decode(), actualImage.decode()]);
  if (
    baselineImage.naturalWidth !== actualImage.naturalWidth ||
    baselineImage.naturalHeight !== actualImage.naturalHeight
  ) {
    throw new Error("Visual parity screenshots have different dimensions");
  }
  const width = baselineImage.naturalWidth;
  const height = baselineImage.naturalHeight;
  const baselineCanvas = document.createElement("canvas");
  const actualCanvas = document.createElement("canvas");
  const diffCanvas = document.createElement("canvas");
  for (const canvas of [baselineCanvas, actualCanvas, diffCanvas]) {
    canvas.width = width;
    canvas.height = height;
  }
  const baselineContext = baselineCanvas.getContext("2d");
  const actualContext = actualCanvas.getContext("2d");
  const diffContext = diffCanvas.getContext("2d");
  if (baselineContext === null || actualContext === null || diffContext === null) {
    throw new Error("Browser canvas is unavailable for visual diffing");
  }
  baselineContext.drawImage(baselineImage, 0, 0);
  actualContext.drawImage(actualImage, 0, 0);
  const baselinePixels = baselineContext.getImageData(0, 0, width, height).data;
  const actualPixels = actualContext.getImageData(0, 0, width, height).data;
  const diff = diffContext.createImageData(width, height);
  let differentPixels = 0;
  for (let offset = 0; offset < baselinePixels.length; offset += 4) {
    const red = Math.abs(baselinePixels[offset] - actualPixels[offset]);
    const green = Math.abs(baselinePixels[offset + 1] - actualPixels[offset + 1]);
    const blue = Math.abs(baselinePixels[offset + 2] - actualPixels[offset + 2]);
    const alpha = Math.abs(baselinePixels[offset + 3] - actualPixels[offset + 3]);
    if (red !== 0 || green !== 0 || blue !== 0 || alpha !== 0) differentPixels += 1;
    diff.data[offset] = red;
    diff.data[offset + 1] = green;
    diff.data[offset + 2] = blue;
    diff.data[offset + 3] = 255;
  }
  diffContext.putImageData(diff, 0, 0);
  return {
    differentPixels,
    height,
    image: diffCanvas.toDataURL("image/png").slice("data:image/png;base64,".length),
    ratio: differentPixels / (width * height),
    width,
  };
})()`;

const BROWSER_LUMINANCE_SCRIPT = String.raw`(async () => {
  const source = document.getElementById("source");
  await source.decode();
  const canvas = document.createElement("canvas");
  canvas.width = source.naturalWidth;
  canvas.height = source.naturalHeight;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("Browser canvas is unavailable");
  context.drawImage(source, 0, 0);
  const bandFraction = Number(document.documentElement.dataset.bandFraction);
  const edge = document.documentElement.dataset.edge;
  const bandHeight = Math.max(1, Math.floor(canvas.height * bandFraction));
  const top = edge === "top" ? 0 : canvas.height - bandHeight;
  const pixels = context.getImageData(
    0,
    top,
    canvas.width,
    bandHeight,
  ).data;
  let total = 0;
  for (let offset = 0; offset < pixels.length; offset += 4) {
    total +=
      pixels[offset] * 0.2126 +
      pixels[offset + 1] * 0.7152 +
      pixels[offset + 2] * 0.0722;
  }
  return { luminance: total / (pixels.length / 4) };
})()`;

/** Writes an exact RGBA pixel diff for two Android screenshots. */
export async function writeVisualDiff(input: VisualDiffInput): Promise<VisualDiffResult> {
  const [baseline, actual] = await Promise.all([
    readFile(input.baselinePath, "base64"),
    readFile(input.actualPath, "base64"),
  ]);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(
      `<img id="baseline" src="data:image/png;base64,${baseline}"><img id="actual" src="data:image/png;base64,${actual}">`,
    );
    const result = await page.evaluate<BrowserDiffResult>(BROWSER_DIFF_SCRIPT);
    await writeFile(input.diffPath, Buffer.from(result.image, "base64"), { mode: 0o600 });
    return {
      differentPixels: result.differentPixels,
      height: result.height,
      ratio: result.ratio,
      width: result.width,
    };
  } finally {
    await browser.close();
  }
}

/** Measures the average perceived luminance of a screenshot edge band. */
export async function readEdgeLuminance(
  imagePath: string,
  edge: "bottom" | "top",
  fraction: number,
): Promise<number> {
  if (!Number.isFinite(fraction) || fraction <= 0 || fraction > 1) {
    throw new Error("Screenshot band fraction must be between 0 and 1");
  }
  const image = await readFile(imagePath, "base64");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(
      `<html data-band-fraction="${fraction}" data-edge="${edge}"><body><img id="source" src="data:image/png;base64,${image}"></body></html>`,
    );
    const result = await page.evaluate<BrowserLuminanceResult>(BROWSER_LUMINANCE_SCRIPT);
    return result.luminance;
  } finally {
    await browser.close();
  }
}
