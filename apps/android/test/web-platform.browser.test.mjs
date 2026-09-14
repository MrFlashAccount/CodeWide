import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { after, before, test } from 'node:test';
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const requireAndroid = createRequire(new URL('../package.json', import.meta.url));
const { build } = requireAndroid('esbuild');
let browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

test('React Native Web lists preserve native styles, custom scrolling and scroll events', async () => {
  const result = await build({
    absWorkingDir: fileURLToPath(new URL('../', import.meta.url)),
    stdin: {
      sourcefile: 'web-list-probe.tsx', loader: 'tsx',
      resolveDir: fileURLToPath(new URL('../', import.meta.url)),
      contents: `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { ScrollView, Text, View } from 'react-native';
import { LegendList } from '@legendapp/list/react-native';
const data = Array.from({ length: 80 }, (_, index) => index);
let list;
function CustomScroll(props) {
  return <ScrollView {...props} testID="custom-scroll" />;
}
createRoot(document.getElementById('root')).render(
  <View style={{ height: 240, width: 320 }}>
    <LegendList ref={value => { list = value; }} data={data}
      keyExtractor={value => String(value)} getFixedItemSize={() => 32}
      contentContainerStyle={[{ paddingHorizontal: 24 }, { paddingTop: 12 }]}
      renderScrollComponent={CustomScroll} onLoad={() => { window.loaded = true; }}
      onScroll={event => { window.scrollYValue = event.nativeEvent.contentOffset.y; }}
      renderItem={({ item }) => <Text testID={'row-' + item} style={{ height: 32 }}>Row {item}</Text>}
    />
  </View>
);
window.scrollLast = () => list.scrollToEnd({ animated: false });
`,
    },
    bundle: true, write: false, platform: 'browser', format: 'iife',
    alias: { 'react-native': 'react-native-web' },
    // Metro supplies the global alias in the application bundle.
    define: { 'process.env.NODE_ENV': '"production"', __DEV__: 'false', global: 'globalThis' },
    logLevel: 'silent',
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.setContent('<div id="root"></div>');
    await page.addScriptTag({ content: result.outputFiles[0].text });
    try { await page.waitForFunction(() => window.loaded === true, undefined, { timeout: 10000 }); }
    catch { assert.fail(JSON.stringify({ errors, html: await page.locator('#root').innerHTML() })); }
    const geometry = await page.evaluate(() => {
      const row = document.querySelector('[data-testid="row-0"]').getBoundingClientRect();
      const scroller = document.querySelector('[data-testid="custom-scroll"]').getBoundingClientRect();
      return { left: row.left - scroller.left, top: row.top - scroller.top };
    });
    assert.equal(geometry.left, 24);
    assert.equal(geometry.top, 12);
    await page.evaluate(() => window.scrollLast());
    await page.waitForFunction(() => window.scrollYValue > 1000);
    assert.equal(await page.getByText('Row 79', { exact: true }).isVisible(), true);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});
