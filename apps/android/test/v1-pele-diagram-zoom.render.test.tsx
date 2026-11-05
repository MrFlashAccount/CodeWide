import { supersampling } from "../src/rendering/peleDiagramSupersampling";
import { parsePeleDiagramSvg } from "../src/rendering/peleDiagramSvg";

it("parses the SVG root before the native host mounts", () => {
  const content = parsePeleDiagramSvg(
    '<svg viewBox="0 0 100 50" fill="#fff" font-family="sans-serif" font-size="16"><rect width="100" height="50" /></svg>',
  );

  expect(content.viewBox).toBe("0 0 100 50");
  expect(content.fill).toBe("#fff");
  expect(content.fontFamily).toBe("sans-serif");
  expect(content.fontSize).toBe(16);
  expect(content.children).toHaveLength(1);
});

it("draws a small diagram sharp up to the maximum zoom", () => {
  expect(supersampling({ height: 200, width: 300 }, 2)).toBe(5);
});

it("keeps a large diagram's bitmap within the GPU texture limit", () => {
  const fit = { height: 700, width: 1000 };
  const factor = supersampling(fit, 3);
  expect(Math.max(fit.width, fit.height) * 3 * factor).toBeLessThanOrEqual(4096);
  expect(factor).toBeGreaterThan(1);
});

it("never draws a diagram smaller than its fitted size", () => {
  expect(supersampling({ height: 3000, width: 4000 }, 3)).toBe(1);
  expect(supersampling({ height: 0, width: 0 }, 3)).toBe(1);
});
