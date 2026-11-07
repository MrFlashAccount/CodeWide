import { parse, type JsxAST } from "react-native-svg";

export type PeleDiagramSvgContent = {
  readonly children: JsxAST["children"];
  readonly fill: string;
  readonly fontFamily: string;
  readonly fontSize: number;
  readonly viewBox: string;
};

/** Parses the trusted Pele result before Reanimated mounts its native SVG host. */
export function parsePeleDiagramSvg(source: string): PeleDiagramSvgContent {
  const root = parse(source);
  if (root === null || root.tag !== "svg") {
    throw new Error("Pele returned SVG without a root viewport");
  }
  return {
    children: root.children,
    fill: requiredString(root.props.fill, "fill"),
    fontFamily: requiredString(root.props.fontFamily, "font family"),
    fontSize: requiredNumber(root.props.fontSize, "font size"),
    viewBox: requiredString(root.props.viewBox, "viewBox"),
  };
}

function requiredString(value: unknown, property: string): string {
  if (typeof value !== "string") {
    throw new Error(`Pele returned SVG without a valid ${property}`);
  }
  return value;
}

function requiredNumber(value: unknown, property: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Pele returned SVG without a valid ${property}`);
  }
  return value;
}
