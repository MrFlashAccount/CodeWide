import { chromium } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const brandDir = path.join(root, "brand");
const androidRes = path.join(root, "apps/android/android/app/src/main/res");
const androidAssets = path.join(root, "apps/android/assets");

const appIcon = await readFile(path.join(brandDir, "codewide-app-icon.svg"), "utf8");
const markInverse = await readFile(path.join(brandDir, "codewide-mark-inverse.svg"), "utf8");
const menuTemplate = await readFile(path.join(brandDir, "codewide-menubar-template.svg"), "utf8");
const favicon = await readFile(path.join(brandDir, "codewide-favicon.svg"), "utf8");

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

async function render(svg, width, height, type = "png") {
  return page.evaluate(async ({ svg, width, height, type }) => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("Canvas 2D is unavailable");
    const image = new Image();
    const loaded = new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error("SVG could not be decoded"));
    });
    image.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
    await loaded;
    context.drawImage(image, 0, 0, width, height);
    const mime = type === "webp" ? "image/webp" : "image/png";
    const dataUrl = canvas.toDataURL(mime, 1);
    return dataUrl.slice(dataUrl.indexOf(",") + 1);
  }, { svg, width, height, type }).then((base64) => Buffer.from(base64, "base64"));
}

async function emit(relativePath, svg, width, height, type = "png") {
  const destination = path.join(root, relativePath);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, await render(svg, width, height, type));
}

const densities = {
  mdpi: 48,
  hdpi: 72,
  xhdpi: 96,
  xxhdpi: 144,
  xxxhdpi: 192,
};

for (const [density, size] of Object.entries(densities)) {
  await emit(`apps/android/android/app/src/main/res/mipmap-${density}/ic_launcher.webp`, appIcon, size, size, "webp");
  await emit(`apps/android/android/app/src/main/res/mipmap-${density}/ic_launcher_round.webp`, appIcon, size, size, "webp");
}

const splashSizes = { mdpi: 288, hdpi: 432, xhdpi: 576, xxhdpi: 864, xxxhdpi: 1152 };
for (const [density, size] of Object.entries(splashSizes)) {
  const paddedMark = markInverse.replace('viewBox="0 0 64 64"', 'viewBox="-36 -36 136 136"');
  await emit(`apps/android/android/app/src/main/res/drawable-${density}/splashscreen_logo.png`, paddedMark, size, size);
}

await emit("brand/codewide-app-icon-1024.png", appIcon, 1024, 1024);
await emit("brand/codewide-favicon-32.png", favicon, 32, 32);
await emit("brand/codewide-menubar-template-16.png", menuTemplate, 16, 16);
await emit("brand/codewide-menubar-template-32.png", menuTemplate, 32, 32);
await emit("brand/codewide-menubar-template-64.png", menuTemplate, 64, 64);
const macIconSizes = [16, 32, 64, 128, 256, 512, 1024];
for (const size of macIconSizes) {
  await emit(`brand/macos/AppIcon.iconset/icon_${size}x${size}.png`, appIcon, size, size);
}
const macAppIconEntries = [
  ["16x16", "1x", 16, "icon_16x16.png"],
  ["16x16", "2x", 32, "icon_16x16@2x.png"],
  ["32x32", "1x", 32, "icon_32x32.png"],
  ["32x32", "2x", 64, "icon_32x32@2x.png"],
  ["128x128", "1x", 128, "icon_128x128.png"],
  ["128x128", "2x", 256, "icon_128x128@2x.png"],
  ["256x256", "1x", 256, "icon_256x256.png"],
  ["256x256", "2x", 512, "icon_256x256@2x.png"],
  ["512x512", "1x", 512, "icon_512x512.png"],
  ["512x512", "2x", 1024, "icon_512x512@2x.png"],
];
for (const [, , pixels, filename] of macAppIconEntries) {
  await emit(`brand/macos/AppIcon.appiconset/${filename}`, appIcon, pixels, pixels);
}
await emit("brand/macos/CodeWideMenuBarTemplate.png", menuTemplate, 18, 18);
await emit("brand/macos/CodeWideMenuBarTemplate@2x.png", menuTemplate, 36, 36);
await emit("brand/macos/CodeWideMenuBarCompactTemplate.png", menuTemplate, 16, 16);
await emit("brand/macos/CodeWideMenuBarCompactTemplate@2x.png", menuTemplate, 32, 32);
await emit("apps/android/assets/icon.png", appIcon, 1024, 1024);
await emit("apps/android/assets/adaptive-icon.png", markInverse.replace('viewBox="0 0 64 64"', 'viewBox="-15 -15 94 94"'), 432, 432);
await emit("apps/android/assets/monochrome-icon.png", menuTemplate.replace('viewBox="0 0 64 64"', 'viewBox="-15 -15 94 94"'), 432, 432);
await emit("apps/android/assets/splash-icon.png", markInverse.replace('viewBox="0 0 64 64"', 'viewBox="-36 -36 136 136"'), 512, 512);

await browser.close();
console.log("Generated CodeWide raster assets.");
