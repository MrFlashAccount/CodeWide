// Explicit renderer contract probe. This does not launch the app, ADB or Appium.
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";

const fixtures = [
  { source: "flowchart LR\n A[Привет] --> B[World]", labels: ["Привет", "World"], arrows: true },
  { source: "sequenceDiagram\n Alice->>Bob: Hello", labels: ["Alice", "Bob", "Hello"], arrows: true },
  { source: "classDiagram\n Animal <|-- Duck", labels: ["Animal", "Duck"], arrows: true },
  { source: "stateDiagram-v2\n [*] --> Active", labels: ["Active"], arrows: true },
  { source: 'pie\n "A": 30\n "B": 70', labels: ["A", "B"], arrows: false },
  { source: "mindmap\n root((Root))\n  One\n  Two", labels: ["Root", "One", "Two"], arrows: false },
];
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
  await page.addInitScript(() => {
    window.requestAnimationFrame = () => { throw new Error("Detached compilation must not wait for animation frames"); };
    window.previewMessages = [];
    window.CodeWideDiagramPreview = {
      postMessage(serialized) { window.previewMessages.push(JSON.parse(serialized)); },
    };
  });
  await page.goto(new URL("../android/app/src/main/assets/mermaid-renderer.html", import.meta.url).href);
  for (const [id, fixture] of fixtures.entries()) {
    const preview = await page.evaluate(async ({ source, id }) => {
      await window.renderMermaid(source, id, "preview");
      return window.previewMessages.find((message) => message.requestId === id);
    }, { source: fixture.source, id });
    assert.equal(preview.type, "preview", preview.message);
    assert(preview.width > 0 && preview.height > 0);
    const properties = await page.evaluate((xml) => {
      const svg = new DOMParser().parseFromString(xml, "image/svg+xml").documentElement;
      return {
        text: svg.textContent,
        embeddedHtml: svg.querySelectorAll("style, script, foreignObject").length,
        invalidReferences: [...svg.querySelectorAll("*")].flatMap((node) => [...node.attributes])
          .filter((attr) => attr.value.includes("url(") && !/^url\(#[^)]+\)$/.test(attr.value)).length,
        markers: svg.querySelectorAll("marker").length,
        paintedPaths: svg.querySelectorAll("[stroke],[fill]").length,
      };
    }, preview.svg);
    for (const label of fixture.labels) assert(properties.text.includes(label), `Missing label ${label}`);
    assert.equal(properties.embeddedHtml, 0);
    assert.equal(properties.invalidReferences, 0);
    assert(properties.paintedPaths > 0);
    if (fixture.arrows) assert(properties.markers > 0);
  }
  console.log(`PASS: ${fixtures.length} SVG diagram families; labels, paint and local arrow references preserved.`);
} finally {
  await browser.close();
}
