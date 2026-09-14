// Local SVG export contract, not device E2E:
// node --test apps/android/test/diagram-preview.browser.test.mjs
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium } from '@playwright/test';

let browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

test('inline ASCII previews keep the viewport height and contain tall and wide diagrams', async () => {
  const page = await browser.newPage({ viewport: { width: 360, height: 220 } });
  try {
    await page.addInitScript(() => {
      window.__diagramMessages = [];
      window.ReactNativeWebView = { postMessage(value) { window.__diagramMessages.push(JSON.parse(value)); } };
    });
    await page.goto(new URL('../android/app/src/main/assets/ascii-diagram-renderer.html', import.meta.url).href);
    await page.waitForFunction(() => window.__diagramMessages.some(message => message.type === 'ready'));
    for (const source of ['A --> B', 'A\n|\nv\n'.repeat(30), 'A' + '-'.repeat(150) + '> B']) {
      await page.evaluate(source => window.renderAsciiDiagram(source, 1, 'inline'), source);
      const geometry = await page.evaluate(() => {
        const svg = document.querySelector('#canvas svg');
        const box = svg.getBBox();
        const matrix = svg.getScreenCTM();
        const start = new DOMPoint(box.x, box.y).matrixTransform(matrix);
        const end = new DOMPoint(box.x + box.width, box.y + box.height).matrixTransform(matrix);
        return { height: document.querySelector('#root').getBoundingClientRect().height,
          top: start.y, left: start.x, right: end.x, bottom: end.y };
      });
      assert.equal(geometry.height, 220);
      assert.ok(geometry.top >= -1 && geometry.left >= -1, JSON.stringify(geometry));
      assert.ok(geometry.bottom <= 221 && geometry.right <= 361, JSON.stringify(geometry));
    }
    await page.setViewportSize({ width: 720, height: 220 });
    assert.equal(await page.locator('#root').evaluate(node => node.getBoundingClientRect().height), 220);
  } finally { await page.close(); }
});

const flowchart = `flowchart TD
  A[Идея жителя] --> B[Обсуждение замысла]
  B --> C[Проверка ресурсов]
  C --> D{Ресурсов достаточно?}
  D -->|Да| E[Пробный запуск]
  D -->|Нет| F[Упростить идею или найти помощь]
  F --> C`;

const styledLabel = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 120">
  <style>text { font: 16px sans-serif; fill: #eef2f6; text-anchor: middle; }</style>
  <g transform="translate(200 20)"><text>
    <tspan class="text-outer-tspan" x="0" y="0" dy="1em"><tspan class="text-inner-tspan">Первое</tspan><tspan class="text-inner-tspan" font-weight="bold"> важное</tspan><tspan class="text-inner-tspan"> слово</tspan></tspan>
    <tspan class="text-outer-tspan" x="0" y="1em" dy="1em"><tspan class="text-inner-tspan" font-style="italic">Вторая строка</tspan></tspan>
  </text></g>
</svg>`;

for (const fixture of [{ name: 'Cyrillic words, wrapped lines and edge labels', source: flowchart },
  { name: 'mixed font styles and transformed multiline labels', source: styledLabel }]) {
  test(fixture.name, async () => {
    const page = await browser.newPage();
    try {
      await page.setContent('<main></main>');
      await page.addScriptTag({ path: new URL('../android/app/src/main/assets/mermaid.min.js', import.meta.url).pathname });
      await page.addScriptTag({ path: new URL('../assets/diagram-preview.js', import.meta.url).pathname });
      const result = await page.evaluate(async (source) => {
        mermaid.initialize({ startOnLoad: false, theme: 'dark', htmlLabels: false,
          flowchart: { htmlLabels: false }, themeVariables: { fontFamily: 'sans-serif' } });
        document.querySelector('main').innerHTML = source.startsWith('<svg') ? source
          : (await mermaid.render('diagram', source)).svg;
        const svg = document.querySelector('svg');
        function measure(root) {
          return [...root.querySelectorAll('text tspan')]
            .filter(node => node.childElementCount === 0 && node.getNumberOfChars() > 0)
            .map(node => {
              const style = getComputedStyle(node);
              return { text: node.textContent, fill: style.fill, weight: style.fontWeight,
                size: style.fontSize, family: style.fontFamily,
                fontStyle: style.fontStyle,
                positions: Array.from({ length: node.getNumberOfChars() }, (_, i) => {
                  const point = node.getStartPositionOfChar(i);
                  return { x: point.x, y: point.y };
                }) };
            });
        }
        const before = measure(svg);
        const paths = [...svg.querySelectorAll('path')].map(node => node.getAttribute('d'));
        const preview = window.exportDiagramPreview(svg);
        // Parse the actual serialized artifact, so omitted CSS/inheritance also
        // participates. Explicit coordinates/start anchoring are the native SVG
        // adapter contract: Android must not recalculate word-level centering.
        document.querySelector('main').innerHTML = preview.svg;
        const exported = document.querySelector('svg');
        // Svg.tsx forwards `font`, not XML font-* attributes, to its inner G.
        // Model that native boundary rather than relying on browser inheritance:
        // Android FontData defaults to 12, while Mermaid measures at 16.
        for (const attribute of ['font-family', 'font-size', 'font-weight', 'font-style']) {
          exported.removeAttribute(attribute);
        }
        exported.style.fontSize = '12px';
        const independentRuns = [...exported.querySelectorAll('text tspan')]
          .filter(node => node.childElementCount === 0 && node.getNumberOfChars() > 0)
          .every(node => node.getAttribute('text-anchor') === 'start'
            && node.hasAttribute('x') && node.hasAttribute('y'));
        return { before, after: measure(exported), independentRuns,
          paths, exportedPaths: [...exported.querySelectorAll('path')].map(node => node.getAttribute('d')) };
      }, fixture.source);
      assert.equal(result.independentRuns, true, 'native text runs must not independently center each word');
      assert.deepEqual(result.exportedPaths, result.paths, 'diagram geometry must be unchanged');
      assert.ok(result.before.length > 2);
      assert.equal(result.after.length, result.before.length);
      result.before.forEach((run, index) => {
        const actual = result.after[index];
        assert.equal(actual.text, run.text);
        assert.equal(actual.fill, run.fill);
        assert.equal(actual.weight, run.weight);
        assert.equal(actual.size, run.size, 'font size must survive the native SVG root boundary');
        assert.equal(actual.family, run.family, 'font family must survive the native SVG root boundary');
        assert.equal(actual.fontStyle, run.fontStyle);
        assert.equal(actual.positions.length, run.positions.length);
        run.positions.forEach((point, char) => {
          assert.ok(Math.abs(point.x - actual.positions[char].x) < 0.1, `${run.text}: horizontal placement`);
          assert.ok(Math.abs(point.y - actual.positions[char].y) < 0.1, `${run.text}: baseline placement`);
        });
      });
    } finally {
      await page.close();
    }
  });
}

test('a Mermaid source error does not poison the renderer for the next queued diagram', async () => {
  const page = await browser.newPage();
  try {
    await page.addInitScript(() => {
      window.__diagramMessages = [];
      window.CodeWideDiagramPreview = {
        postMessage(serialized) { window.__diagramMessages.push(JSON.parse(serialized)); },
      };
    });
    await page.goto(new URL('../android/app/src/main/assets/mermaid-renderer.html', import.meta.url).href);
    await page.waitForFunction(() => window.__diagramMessages.some(message => message.type === 'ready'));

    await page.evaluate(() => window.renderMermaid('sequenceDiagram\nthis is not valid', 'broken', 'preview'));
    await page.waitForFunction(() => window.__diagramMessages.some(message => message.requestId === 'broken'));
    const sourceError = await page.evaluate(() => window.__diagramMessages.findLast(message => message.requestId === 'broken'));
    assert.equal(sourceError.type, 'error');
    assert.match(sourceError.message, /Parse error/u);

    await page.evaluate((source) => window.renderMermaid(source, 'valid', 'preview'), flowchart);
    await page.waitForFunction(() => window.__diagramMessages.some(message => message.requestId === 'valid'));
    const nextResult = await page.evaluate(() => window.__diagramMessages.findLast(message => message.requestId === 'valid'));
    assert.equal(nextResult.type, 'preview-ready');
    assert.ok(nextResult.width > 0);
    assert.ok(nextResult.height > 0);
  } finally {
    await page.close();
  }
});

test('the native preview viewport contains the complete diagram at its captured aspect ratio', async () => {
  const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
  try {
    await page.addInitScript(() => {
      window.__diagramMessages = [];
      window.CodeWideDiagramPreview = {
        postMessage(serialized) { window.__diagramMessages.push(JSON.parse(serialized)); },
      };
    });
    await page.goto(new URL('../android/app/src/main/assets/mermaid-renderer.html', import.meta.url).href);
    await page.waitForFunction(() => window.__diagramMessages.some(message => message.type === 'ready'));
    const tallFlowchart = `flowchart TD\n${Array.from({ length: 20 }, (_, index) =>
      `  N${index}[Node ${index}] --> N${index + 1}[Node ${index + 1}]`).join('\n')}`;
    await page.evaluate((source) => window.renderMermaid(source, 'preview-geometry', 'preview'), tallFlowchart);
    await page.waitForFunction(() => window.__diagramMessages.some(message => message.requestId === 'preview-geometry'));
    const dimensions = await page.evaluate(() =>
      window.__diagramMessages.findLast(message => message.requestId === 'preview-geometry'));
    assert.equal(dimensions.type, 'preview-ready');
    const captureScale = Math.min(800 / dimensions.width, 800 / dimensions.height);
    const captureSize = {
      width: Math.max(1, Math.round(dimensions.width * captureScale)),
      height: Math.max(1, Math.round(dimensions.height * captureScale)),
    };
    await page.setViewportSize(captureSize);
    const geometry = await page.evaluate(() => {
      const rootBounds = document.querySelector('#root').getBoundingClientRect();
      const svgBounds = document.querySelector('svg').getBoundingClientRect();
      return {
        mode: document.querySelector('#root').dataset.mode,
        root: { width: rootBounds.width, height: rootBounds.height },
        svg: { x: svgBounds.x, y: svgBounds.y, width: svgBounds.width, height: svgBounds.height },
      };
    });
    assert.equal(geometry.mode, 'preview');
    assert.deepEqual(geometry.root, captureSize);
    assert.deepEqual(geometry.svg, { x: 0, y: 0, ...captureSize });
  } finally {
    await page.close();
  }
});

test('fullscreen pinch keeps the diagram point beneath the moving finger midpoint', async () => {
  const page = await browser.newPage({ viewport: { width: 900, height: 700 }, hasTouch: true });
  try {
    await page.addInitScript(() => {
      window.__diagramMessages = [];
      window.ReactNativeWebView = {
        postMessage(serialized) { window.__diagramMessages.push(JSON.parse(serialized)); },
      };
    });
    await page.goto(new URL('../android/app/src/main/assets/mermaid-renderer.html', import.meta.url).href);
    await page.waitForFunction(() => window.__diagramMessages.some(message => message.type === 'ready'));
    await page.evaluate((source) => window.renderMermaid(source, 'fullscreen-pinch', 'fullscreen'), flowchart);
    await page.waitForFunction(() => window.__diagramMessages.some(message =>
      message.type === 'rendered' && message.requestId === 'fullscreen-pinch'));
    const movement = await page.evaluate(async () => {
      const stage = document.querySelector('#stage');
      const svg = document.querySelector('svg');
      const localPointAt = (x, y) => {
        const point = svg.createSVGPoint();
        point.x = x;
        point.y = y;
        const local = point.matrixTransform(svg.getScreenCTM().inverse());
        return { x: local.x, y: local.y };
      };
      const dispatch = (target, type, pointerId, clientX, clientY) => target.dispatchEvent(new PointerEvent(type, {
        pointerId,
        pointerType: 'touch',
        clientX,
        clientY,
        bubbles: true,
        cancelable: true,
        isPrimary: pointerId === 1,
        buttons: type === 'pointerup' ? 0 : 1,
      }));
      const before = localPointAt(300, 300);
      dispatch(stage, 'pointerdown', 1, 250, 300);
      dispatch(stage, 'pointerdown', 2, 350, 300);
      dispatch(document, 'pointermove', 1, 220, 320);
      dispatch(document, 'pointermove', 2, 420, 320);
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const after = localPointAt(320, 320);
      return { x: after.x - before.x, y: after.y - before.y };
    });
    assert.ok(Math.abs(movement.x) < 0.01, `horizontal focal-point drift: ${movement.x}`);
    assert.ok(Math.abs(movement.y) < 0.01, `vertical focal-point drift: ${movement.y}`);
  } finally {
    await page.close();
  }
});
