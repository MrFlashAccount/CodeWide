import { buildTREFromConfig, type TNode } from "@native-html/render";
import { fireEvent, render } from "@testing-library/react-native";
import { Image, Text } from "react-native";
import { InlineMediaFrame } from "../src/rendering/InlineMediaFrame";

import { NativeMarkup } from "../src/rendering/NativeMarkup";
import { NativeRevealSurface } from "../src/rendering/NativeRevealSurface";
import { StreamingRevealSurface } from "../src/rendering/StreamingRevealSurface";
import { nativeMarkupConfig } from "../src/rendering/native-markup-config";
import { markupTableGrid, markupTableRowHeights } from "../src/rendering/markup-table-layout";
import { RichContentWidthProvider } from "../src/rendering/RichContentLayout";
import { CodeBlockHeader } from "../src/rendering/CodeBlockHeader";
import { MessageAttachmentGrid, MessageAttachmentTile } from "../src/rendering/MessageAttachmentTile";
import { MessageFooterRow } from "../src/rendering/MessageFooterRow";
import { controlSize, layoutSize, spacing } from "../src/theme";

const engine = buildTREFromConfig(nativeMarkupConfig);
function findTag(node: TNode, tag: string): TNode | undefined {
  if (node.tagName === tag) return node;
  for (const child of node.children) {
    const found = findTag(child, tag);
    if (found !== undefined) return found;
  }
  return undefined;
}
const code = jest.fn((source: string, language: string, path: string) => <Text>{`${language}:${path}:${source}`}</Text>);
const image = jest.fn((source: string, title: string) => <Text>{`${title}:${source}`}</Text>);
const link = jest.fn((href: string, children: React.ReactNode) => <Text accessibilityLabel={href}>{children}</Text>);

function view(html: string) {
  return <RichContentWidthProvider width={360}><NativeMarkup html={html} code={code} image={image} link={link} /></RichContentWidthProvider>;
}

beforeEach(() => jest.clearAllMocks());

it("keeps inline media geometry through loading, decode, error and retry", () => {
  const result = render(<InlineMediaFrame><Text>Loading</Text></InlineMediaFrame>);
  for (const content of [
    <Image key="tall" source={{ uri: "data:image/png;base64,fixture", width: 10, height: 2000 }} />,
    <Text key="error">{"Decode failed\n".repeat(100)}</Text>,
    <Text key="retry">Loading again</Text>,
    <Image key="wide" source={{ uri: "data:image/png;base64,fixture", width: 2000, height: 10 }} />,
  ]) {
    result.rerender(<InlineMediaFrame>{content}</InlineMediaFrame>);
    expect(result.getByTestId("inline-media-frame")).toHaveStyle({ height: 220, overflow: "hidden" });
  }
});

it("reserves metadata-sized media before loading and changes only with explicit geometry", () => {
  const result = render(<InlineMediaFrame height={180} />);
  expect(result.getByTestId("inline-media-frame")).toHaveStyle({ height: 180 });
  result.rerender(<InlineMediaFrame height={180}><Text>Decoded</Text></InlineMediaFrame>);
  expect(result.getByTestId("inline-media-frame")).toHaveStyle({ height: 180 });
  result.rerender(<InlineMediaFrame height={300}><Text>After viewport resize</Text></InlineMediaFrame>);
  expect(result.getByTestId("inline-media-frame")).toHaveStyle({ height: 300 });
});

it("keeps completion metadata and localized time in one footer row", () => {
  const result = render(<MessageFooterRow time="1:05 PM"><Text>Completed · 2s</Text></MessageFooterRow>);
  expect(result.getByText("Completed · 2s")).toBeTruthy();
  expect(result.getByTestId("turn-footer")).toHaveStyle({ flexDirection: "row", alignItems: "center" });
  expect(result.getByTestId("turn-footer-metadata")).toHaveStyle({ flexShrink: 0, flexWrap: "nowrap" });
  expect(result.getByTestId("turn-footer-time-anchor")).toHaveStyle({ marginLeft: "auto" });
  expect(result.getByText("1:05 PM")).toHaveStyle({ flexShrink: 0, textAlign: "right" });
  expect(result.getByText("1:05 PM").props.numberOfLines).toBe(1);
  result.rerender(<MessageFooterRow time={null}><Text>Running</Text></MessageFooterRow>);
  expect(result.queryByTestId("turn-footer-time")).toBeNull();
  expect(result.getByText("Running")).toBeTruthy();
});

it("renders compact file tiles without opening files until pressed", () => {
  const open = jest.fn();
  const names = ["long-file-name-with-important-extension.txt", "report.md", "clip.mp4", "data.csv", "archive.zip"];
  const result = render(<MessageAttachmentGrid>{names.map((name) => <MessageAttachmentTile key={name} name={name} label="File" icon={null} onOpen={() => open(name)} />)}</MessageAttachmentGrid>);
  expect(result.getAllByRole("button")).toHaveLength(5);
  expect(open).not.toHaveBeenCalled();
  const filename = result.getByText(names[0]!);
  expect(filename.props.numberOfLines).toBe(1);
  expect(filename.props.ellipsizeMode).toBe("middle");
  const tile = result.getByLabelText(`Open ${names[0]}`);
  expect(tile).toHaveStyle({ width: layoutSize.attachmentTile, maxWidth: "100%", minHeight: controlSize.touch, flexShrink: 1 });
  expect(result.getByTestId("message-attachment-grid")).toHaveStyle({ flexWrap: "wrap", maxWidth: layoutSize.attachmentTile * 2 + spacing.xs });
  fireEvent.press(tile);
  expect(open).toHaveBeenCalledTimes(1);
  expect(open).toHaveBeenCalledWith(names[0]);
});

it("shows only known file size and disables unavailable file actions", () => {
  const result = render(<MessageAttachmentTile name="report.txt" label="Text" bytes={2048} icon={null} />);
  expect(result.getByText("Text · 2 KB")).toBeTruthy();
  expect(result.getByRole("button")).toBeDisabled();
  result.rerender(<MessageAttachmentTile name="report.txt" label="Text" icon={null} />);
  expect(result.getByText("Text")).toBeTruthy();
  expect(result.queryByText(/KB/)).toBeNull();
});

it("keeps the copy action on one line while truncating a long language label", () => {
  const language = "a-very-long-language-description";
  const result = render(<CodeBlockHeader language={language} copied={false} scale={1.4} />);
  expect(result.getByText("Copy").props.numberOfLines).toBe(1);
  expect(result.getByText(language).props.ellipsizeMode).toBe("tail");
  expect(result.getByText("Copy")).toHaveStyle({ flexShrink: 0 });
  expect(result.getByText(language)).toHaveStyle({ flex: 1, minWidth: 0 });
  result.rerender(<CodeBlockHeader language={language} copied scale={1.4} />);
  expect(result.getByText("Copied").props.accessibilityLiveRegion).toBe("polite");
});

it("renders LaTeX through native SVG and preserves unsupported input", async () => {
  const result = render(view('<p>Formula <cw-inline-math>x^2</cw-inline-math></p><cw-display-math>\\unknown{1}</cw-display-math>'));
  expect(await result.findByLabelText("x^2", {}, { timeout: 15000 })).toBeTruthy();
  expect(await result.findByText("\\unknown{1}")).toBeTruthy();
}, 20000);

it("renders nested disclosures natively and retains open state during streaming", () => {
  const result = render(view("<details><summary>Outer</summary><p>First</p><details><summary>Inner</summary><b>Nested</b></details></details>"));
  expect(result.queryByText("First")).toBeNull();
  expect(result.getByRole("button").props.accessibilityState.expanded).toBe(false);
  expect(result.queryByText("›")).toBeNull();
  expect(result.queryByText("⌄")).toBeNull();
  fireEvent.press(result.getByText("Outer"));
  expect(result.getAllByRole("button")[0]?.props.accessibilityState.expanded).toBe(true);
  expect(result.getByText("First")).toBeTruthy();
  fireEvent.press(result.getByText("Inner"));
  expect(result.getByText("Nested")).toBeTruthy();
  result.rerender(view("<details><summary>Outer</summary><p>Updated</p><details><summary>Inner</summary><b>Nested update"));
  expect(result.getByText("Updated")).toBeTruthy();
  expect(result.getByText("Nested update")).toBeTruthy();
});

it("retains code whitespace, distinct review paths and existing file/link capabilities", () => {
  render(view('<pre><code class="language-ts">  x &lt; 3\n    y &amp;amp; z</code></pre><pre><code>second</code></pre><img src="/private/a.png" alt="Drawing"><a href="/private/report.md">Report</a>'));
  expect(code.mock.calls[0]?.[0]).toBe("  x < 3\n    y &amp; z");
  expect(code.mock.calls[0]?.[1]).toBe("ts");
  expect(code.mock.calls[0]?.[2]).not.toBe(code.mock.calls[1]?.[2]);
  expect(image).toHaveBeenCalledWith("/private/a.png", "Drawing", undefined);
  expect(link.mock.calls[0]?.[0]).toBe("/private/report.md");
});

it("reserves only valid intrinsic image dimensions at the capability boundary", () => {
  render(view('<img src="a.png" width="640" height="320"><img src="b.png" width="100%" height="320">'));
  expect(image).toHaveBeenCalledWith("a.png", "Image", { width: 640, height: 320 });
  expect(image).toHaveBeenCalledWith("b.png", "Image", undefined);
});

it("reveals complete table rows without replaying existing row identities on append", () => {
  const first = '<table><thead><tr><th>Name</th><th>Value</th></tr></thead><tbody><tr><td rowspan="2">Group</td><td>One</td></tr></tbody></table>';
  const next = first.replace('</tbody>', '<tr><td>Two</td></tr></tbody>');
  const result = render(<StreamingRevealSurface streamKey="turn:one">{view(first)}</StreamingRevealSurface>);
  const rows = result.UNSAFE_getAllByType(NativeRevealSurface);
  expect(rows).toHaveLength(2);
  expect(rows.every((row) => row.props.animate === true)).toBe(true);
  expect(rows[0]?.props.ready).toBe(false);
  fireEvent(result.getByTestId("markup-table-cell-0-0"), "layout", { nativeEvent: { layout: { height: 40 } } });
  expect(result.UNSAFE_getAllByType(NativeRevealSurface)[0]?.props.ready).toBe(false);
  fireEvent(result.getByTestId("markup-table-cell-0-1"), "layout", { nativeEvent: { layout: { height: 40 } } });
  expect(result.UNSAFE_getAllByType(NativeRevealSurface)[0]?.props.ready).toBe(true);
  expect(result.UNSAFE_getAllByType(NativeRevealSurface)[1]?.props.ready).toBe(false);
  const keys = rows.map((row) => row.props.revealKey);
  result.rerender(<StreamingRevealSurface streamKey="turn:one">{view(next)}</StreamingRevealSurface>);
  const appended = result.UNSAFE_getAllByType(NativeRevealSurface);
  expect(appended).toHaveLength(3);
  expect(appended.slice(0, 2).map((row) => row.props.revealKey)).toEqual(keys);
  expect(result.getByText("Group")).toBeTruthy();
  expect(result.getByText("Two")).toBeTruthy();
  const historical = render(view(next));
  expect(historical.UNSAFE_getAllByType(NativeRevealSurface).every((row) => row.props.animate === false)).toBe(true);
});

it("ignores hidden and executable subtrees and document CSS", () => {
  const result = render(view('<div style="position:absolute; font-size:900px" onclick="evil()"><script>secret</script><iframe>private</iframe><p hidden>Hidden</p><b>Visible</b></div>'));
  expect(result.getByText("Visible")).toBeTruthy();
  expect(result.queryByText("secret")).toBeNull();
  expect(result.queryByText("private")).toBeNull();
  expect(result.queryByText("Hidden")).toBeNull();
  const tree = engine.buildTTree('<p style="font-size:900px">Normal</p>');
  expect(findTag(tree, "p")?.styles.nativeTextFlow.fontSize).toBe(14);
});

it("preserves read-only form content and routes media through the file capability", () => {
  const result = render(view('<form><label>Example</label><input type="checkbox" checked><textarea>Read only</textarea></form><progress value="3" max="4"></progress><audio src="/private/clip.opus" title="Recording"></audio>'));
  expect(result.getByText("Example")).toBeTruthy();
  expect(result.getByText("☑")).toBeTruthy();
  expect(result.getByText("Read only")).toBeTruthy();
  expect(result.getByRole("progressbar").props.accessibilityValue.now).toBe(75);
  expect(link.mock.calls.some((call) => call[0] === "/private/clip.opus")).toBe(true);
});

it("places table spans without overlap and sizes rows from their contents", () => {
  const table = findTag(engine.buildTTree('<table><tr><td rowspan="2">A</td><td colspan="2">B</td></tr><tr><td>C</td><td>D</td></tr></table>'), "table");
  if (table === undefined) throw new Error("Expected table");
  const grid = markupTableGrid(table);
  expect(grid.columns).toBe(3);
  expect(grid.rows).toBe(2);
  expect(grid.cells.map((cell) => [cell.row, cell.column, cell.rowSpan, cell.colSpan])).toEqual([[0, 0, 2, 1], [0, 1, 1, 2], [1, 1, 1, 1], [1, 2, 1, 1]]);
  const heights = markupTableRowHeights(grid, { 0: 140, 1: 40, 2: 100, 3: 40 }, 40);
  expect(heights[1]).toBeGreaterThanOrEqual(100);
  expect(heights.reduce((sum, value) => sum + value, 0)).toBeGreaterThanOrEqual(140);
  const result = render(view('<table><tr><th>Head</th><th>Other</th></tr><tr><td>Left</td><td>Right</td></tr></table>'));
  expect(result.getByText("Left")).toBeTruthy();
  expect(result.getByText("Right")).toBeTruthy();
});

it("treats zero rowspan as remaining rows and normalizes invalid spans", () => {
  const table = findTag(engine.buildTTree('<table><tr><td rowspan="0">A</td><td colspan="-2">B</td></tr><tr><td>C</td></tr></table>'), "table");
  if (table === undefined) throw new Error("Expected table");
  const grid = markupTableGrid(table);
  expect(grid.cells[0]?.rowSpan).toBe(2);
  expect(grid.cells[1]?.colSpan).toBe(1);
});

it("limits zero rowspan to its row group and finds room for an entire colspan", () => {
  const table = findTag(engine.buildTTree('<table><tbody><tr><td>A</td><td rowspan="0">B</td></tr><tr><td colspan="2">C</td></tr></tbody><tbody><tr><td>D</td></tr></tbody></table>'), "table");
  if (table === undefined) throw new Error("Expected table");
  const grid = markupTableGrid(table);
  expect(grid.cells[1]?.rowSpan).toBe(2);
  expect(grid.cells[2]?.column).toBe(2);
  expect(grid.cells[3]?.column).toBe(0);
});
