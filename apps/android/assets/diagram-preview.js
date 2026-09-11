// Mermaid layout helpers may schedule work with requestAnimationFrame. A
// detached compiler has no display frames; use a timer clock only in the
// dedicated native compiler, before Mermaid captures the scheduler.
if (window.CodeWideDiagramPreview) {
  window.requestAnimationFrame = function (callback) { return setTimeout(function () { callback(performance.now()); }, 16); };
  window.cancelAnimationFrame = function (id) { clearTimeout(id); };
}

/* Convert browser-computed presentation into portable native SVG attributes. */
window.exportDiagramPreview = function (svg) {
  const box = svg.viewBox.baseVal;
  if (!(box.width > 0 && box.height > 0)) throw new Error('Diagram has no valid viewBox');
  if (svg.querySelector('foreignObject')) throw new Error('Diagram preview requires SVG labels');
  // Android react-native-svg treats an absent x (bridged as []) as an anchor
  // boundary. Mermaid's word-level tspans then center independently instead of
  // as one line. Capture browser layout before mutation; explicit start anchors
  // make each run independent of native text-chunk discovery. Keep the groups,
  // transforms and styled runs rather than flattening away their presentation.
  const textRuns = [];
  const textRows = new Set();
  svg.querySelectorAll('text .text-outer-tspan > .text-inner-tspan').forEach(function (node) {
    if (node.childElementCount !== 0 || node.getNumberOfChars() === 0 || node.closest('textPath')) return;
    const start = node.getStartPositionOfChar(0);
    textRuns.push({ node: node, x: start.x, y: start.y });
    textRows.add(node.parentElement);
  });
  const properties = [
    'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity',
    'stroke-dasharray', 'stroke-dashoffset', 'stroke-linecap', 'stroke-linejoin',
    'opacity', 'font-family', 'font-size', 'font-weight', 'font-style',
    'text-anchor', 'dominant-baseline', 'visibility', 'display',
    'marker-start', 'marker-mid', 'marker-end', 'clip-path',
    'stop-color', 'stop-opacity', 'color',
  ];
  // Read all computed styles before removing CSS or changing inherited values.
  const nodes = [svg, ...svg.querySelectorAll('*')];
  const styles = nodes.map(function (node) {
    const style = getComputedStyle(node);
    return properties.map(function (property) { return style.getPropertyValue(property); });
  });
  const byNode = new Map(nodes.map(function (node, index) { return [node, styles[index]]; }));
  nodes.forEach(function (node, index) {
    node.removeAttribute('style');
    const inherited = byNode.get(node.parentElement);
    properties.forEach(function (property, propertyIndex) {
      const value = styles[index][propertyIndex];
      node.removeAttribute(property);
      // react-native-svg's root forwards `font`, not individual XML font-*
      // attributes, to its inner G. A browser-only inheritance optimization
      // otherwise drops Mermaid's 16px font and Android draws at its 12 default
      // using word positions measured at 16. Each text owns its measured font;
      // styled tspans can still inherit from it without per-word duplication.
      const ownsMeasuredFont = node.localName === 'text' && property.startsWith('font-');
      // Keep inherited presentation on groups instead of duplicating every
      // default on every path, tspan and marker in the generated document.
      if (property === 'opacity') {
        if (value === '1') return;
      } else if (property === 'display') {
        if (value !== 'none') return;
      } else if (!ownsMeasuredFont && inherited && value === inherited[propertyIndex]) return;
      if (value) node.setAttribute(property, value.replace(/url\(["']?[^)"']*#([^)'"\s]+)["']?\)/g, 'url(#$1)'));
    });
  });
  svg.querySelectorAll('style,script').forEach(function (node) { node.remove(); });
  // The captured coordinates already include the row's em-based baseline
  // offsets. Leaving dy on the row applies that offset a second time in SVG.
  textRows.forEach(function (row) {
    row.removeAttribute('dx');
    row.removeAttribute('dy');
  });
  textRuns.forEach(function (run) {
    run.node.setAttribute('x', String(run.x));
    run.node.setAttribute('y', String(run.y));
    run.node.setAttribute('text-anchor', 'start');
    run.node.removeAttribute('dx');
    run.node.removeAttribute('dy');
  });
  svg.setAttribute('width', String(box.width));
  svg.setAttribute('height', String(box.height));
  return { svg: new XMLSerializer().serializeToString(svg), width: box.width, height: box.height };
};
