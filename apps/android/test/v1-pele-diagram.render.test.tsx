import { render as renderComponent } from "@testing-library/react-native";
import { SvgXml } from "react-native-svg";

import { MAX_INLINE_DIAGRAM_SOURCE_CHARS } from "../src/rendering/inlineMediaGeometry";
import { renderPeleDiagramSvg } from "../src/rendering/peleDiagramRenderer";

const fixtures = [
  {
    arrows: true,
    labels: ["Привет", "World"],
    name: "flowchart",
    source: "flowchart LR\n A[Привет] --> B[World]",
  },
  {
    arrows: true,
    labels: ["Alice", "Bob", "Hello"],
    name: "sequence",
    source: "sequenceDiagram\n Alice->>Bob: Hello",
  },
  {
    arrows: true,
    labels: ["Animal", "Duck"],
    name: "class",
    source: "classDiagram\n Animal <|-- Duck",
  },
  {
    arrows: true,
    labels: ["Active"],
    name: "state",
    source: "stateDiagram-v2\n [*] --> Active",
  },
  {
    arrows: false,
    labels: ["Pets", "A", "B"],
    name: "pie",
    source: 'pie\n title Pets\n "A" : 30\n "B" : 70',
  },
  {
    arrows: false,
    labels: ["Root", "One", "Two"],
    name: "mindmap",
    source: "mindmap\n root((Root))\n  One\n  Two",
  },
  {
    arrows: true,
    labels: ["CUSTOMER", "ORDER", "places"],
    name: "entity relationship",
    source: "erDiagram\n CUSTOMER ||--o{ ORDER : places",
  },
  {
    arrows: false,
    labels: ["Roadmap", "Phase", "Task"],
    name: "gantt",
    source: "gantt\n title Roadmap\n dateFormat YYYY-MM-DD\n section Phase\n Task: 2026-01-01, 7d",
  },
  {
    arrows: false,
    labels: ["Alpha", "Beta", "develop"],
    name: "git graph",
    source: 'gitGraph\n commit id: "Alpha"\n branch develop\n checkout develop\n commit id: "Beta"',
  },
  {
    arrows: false,
    labels: ["Working day", "Morning", "Make tea"],
    name: "journey",
    source: "journey\n title Working day\n section Morning\n Make tea: 5: Me",
  },
  {
    arrows: false,
    labels: ["History", "Started", "Shipped"],
    name: "timeline",
    source: "timeline\n title History\n 2024 : Started\n 2025 : Shipped",
  },
  {
    arrows: false,
    labels: ["Winners", "A"],
    name: "quadrant chart",
    source:
      "quadrantChart\n x-axis Low --> High\n y-axis Low --> High\n quadrant-1 Winners\n A: [0.3, 0.6]",
  },
  {
    arrows: false,
    labels: ["Sales", "Revenue", "jan"],
    name: "xy chart",
    source:
      'xychart-beta\n title "Sales"\n x-axis [jan, feb, mar]\n y-axis "Revenue" 0 --> 100\n bar [50, 60, 80]',
  },
  {
    arrows: false,
    labels: ["Test requirement", "High", "Test"],
    name: "requirement",
    source:
      'requirementDiagram\n requirement test_req {\n id: 1\n text: "Test requirement"\n risk: high\n verifymethod: test\n }',
  },
  {
    arrows: true,
    labels: ["System Context", "User", "System", "Uses"],
    name: "C4 context",
    source:
      'C4Context\n title System Context\n Person(user, "User")\n System(system, "System")\n Rel(user, system, "Uses")',
  },
  {
    arrows: true,
    labels: ["Start", "Process", "End"],
    name: "block",
    source: 'block-beta\n columns 3\n A["Start"] --> B["Process"] --> C["End"]',
  },
  {
    arrows: false,
    labels: ["Source Port", "Destination Port"],
    name: "packet",
    source: 'packet-beta\n 0-15: "Source Port"\n 16-31: "Destination Port"',
  },
  {
    arrows: false,
    labels: ["A", "B", "C"],
    name: "sankey",
    source: "sankey-beta\n A,B,10\n B,C,10",
  },
  {
    arrows: false,
    labels: ["API", "Database"],
    name: "architecture",
    source: "architecture-beta\n group api(cloud)[API]\n service db(database)[Database] in api",
  },
  {
    arrows: false,
    labels: ["Todo", "Task 1", "Done", "Task 2"],
    name: "kanban",
    source: "kanban\n todo[Todo]\n  task1[Task 1]\n done[Done]\n  task2[Task 2]",
  },
  {
    arrows: false,
    labels: ["Section", "A", "B"],
    name: "treemap",
    source: 'treemap-beta\n "Section"\n  "A": 10\n  "B": 20',
  },
  {
    arrows: false,
    labels: ["Speed", "Quality", "Cost", "X"],
    name: "radar",
    source: 'radar-beta\n axis a["Speed"], b["Quality"], c["Cost"]\n curve x["X"]{1,2,3}',
  },
] as const;

describe("Pele native diagram contract", () => {
  it.each(fixtures)(
    "renders $name as portable react-native-svg content",
    ({ arrows, labels, source }) => {
      const result = renderDiagram(source);
      expect(result.status).toBe("ready");
      if (result.status !== "ready") {
        return;
      }
      expect(result.width).toBeGreaterThan(0);
      expect(result.height).toBeGreaterThan(0);
      expect(result.svg).not.toContain("var(");
      expect(result.svg).not.toMatch(/<(?:foreignObject|image|script|style)\b/iu);
      expect(result.svg).not.toMatch(/\b(?:NaN|Infinity)\b/u);
      expect(result.svg).not.toMatch(/\bhref=/iu);
      expect(result.svg).toMatch(/<(?:circle|ellipse|line|path|polygon|rect)\b/iu);
      expect(result.svg).toMatch(/\b(?:fill|stroke)="(?!none\b)[^"]+"/iu);
      if (arrows) {
        expect(result.svg).toContain('class="pele-marker"');
      }
      for (const label of labels) {
        expect(result.svg).toContain(label);
      }

      const tree = renderComponent(<SvgXml height="100%" width="100%" xml={result.svg} />).toJSON();
      const nativeTree = JSON.stringify(tree);
      for (const label of labels) {
        expect(nativeTree).toContain(label);
      }
    },
  );

  it("returns a source-safe parse error and remains usable", () => {
    const invalid = renderDiagram("sequenceDiagram\nthis is not valid");
    expect(invalid).toEqual({
      message: "Could not parse Mermaid diagram at line 2",
      status: "error",
    });
    expect(JSON.stringify(invalid)).not.toContain("this is not valid");

    const next = renderDiagram("flowchart LR\n A --> B");
    expect(next.status).toBe("ready");
  });

  it("enforces the existing diagram source boundary before parsing", () => {
    const result = renderDiagram("x".repeat(MAX_INLINE_DIAGRAM_SOURCE_CHARS + 1));
    expect(result).toEqual({ message: "Diagram is too large to render safely", status: "error" });
  });
});

function renderDiagram(source: string) {
  return renderPeleDiagramSvg(source, MAX_INLINE_DIAGRAM_SOURCE_CHARS);
}
