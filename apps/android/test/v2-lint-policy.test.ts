import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import plugin from "../oxlint.v2.plugin.mjs";

interface AstNode {
  parent?: AstNode;
  params?: AstNode[];
  type: string;
  typeAnnotation?: AstNode;
}

interface PropertyNode {
  computed: boolean;
  key: { name: string; type: "Identifier" };
  type: "Property";
  value: { type: "Identifier"; name: string } | { type: "Literal"; value: number | string };
}

function createProperty(name: string, value: PropertyNode["value"]): PropertyNode {
  return {
    computed: false,
    key: { name, type: "Identifier" },
    type: "Property",
    value,
  };
}

function createParameterPattern(
  patternType: "ArrayPattern" | "ObjectPattern",
  ownerType: "ArrowFunctionExpression" | "FunctionDeclaration" | "MethodDefinition",
): AstNode {
  const pattern: AstNode = { type: patternType };
  const owner: AstNode = { params: [pattern], type: ownerType };
  pattern.parent = owner;
  return pattern;
}

describe("V2 lint policy", () => {
  it("keeps named object types and stable JSX callbacks mandatory", () => {
    const config = readFileSync(new URL("../oxlint.v2.config.mjs", import.meta.url), "utf8");
    expect(config).toContain('"codewide-v2/no-destructured-function-parameters": "error"');
    expect(config).toContain('"codewide-v2/no-inline-object-parameter-types": "error"');
    expect(config).toContain('"typescript/consistent-type-definitions": ["error", "interface"]');
    expect(config).not.toContain('"react-doctor/jsx-no-new-function-as-prop": "off"');
  });

  it("rejects object and array destructuring in function parameters", () => {
    const report = vi.fn();
    const visitor = plugin.rules["no-destructured-function-parameters"].create({ report });
    const objectPattern = createParameterPattern("ObjectPattern", "FunctionDeclaration");
    const arrayPattern = createParameterPattern("ArrayPattern", "ArrowFunctionExpression");

    visitor.ObjectPattern(objectPattern);
    visitor.ArrayPattern(arrayPattern);

    expect(report).toHaveBeenCalledTimes(2);
    expect(report).toHaveBeenNthCalledWith(1, {
      messageId: "namedParameter",
      node: objectPattern,
    });
    expect(report).toHaveBeenNthCalledWith(2, {
      messageId: "namedParameter",
      node: arrayPattern,
    });
  });

  it("rejects destructuring behind a default parameter", () => {
    const report = vi.fn();
    const visitor = plugin.rules["no-destructured-function-parameters"].create({ report });
    const pattern: AstNode = { type: "ObjectPattern" };
    const assignment: AstNode = { type: "AssignmentPattern" };
    const owner: AstNode = { params: [assignment], type: "MethodDefinition" };
    pattern.parent = assignment;
    assignment.parent = owner;

    visitor.ObjectPattern(pattern);

    expect(report).toHaveBeenCalledOnce();
    expect(report).toHaveBeenCalledWith({ messageId: "namedParameter", node: pattern });
  });

  it("allows destructuring inside function bodies and nested parameter patterns", () => {
    const report = vi.fn();
    const visitor = plugin.rules["no-destructured-function-parameters"].create({ report });
    const localPattern: AstNode = {
      parent: { type: "VariableDeclarator" },
      type: "ObjectPattern",
    };
    const outerPattern = createParameterPattern("ObjectPattern", "FunctionDeclaration");
    const nestedPattern: AstNode = { parent: outerPattern, type: "ArrayPattern" };

    visitor.ObjectPattern(localPattern);
    visitor.ArrayPattern(nestedPattern);

    expect(report).not.toHaveBeenCalled();
  });

  it("rejects direct inline object parameter types", () => {
    const report = vi.fn();
    const visitor = plugin.rules["no-inline-object-parameter-types"].create({ report });
    const parameter: AstNode = { type: "Identifier" };
    const owner: AstNode = { params: [parameter], type: "ArrowFunctionExpression" };
    parameter.parent = owner;
    const objectType: AstNode = { type: "TSTypeLiteral" };
    const annotation: AstNode = {
      parent: parameter,
      type: "TSTypeAnnotation",
      typeAnnotation: objectType,
    };

    visitor.TSTypeAnnotation(annotation);

    expect(report).toHaveBeenCalledOnce();
    expect(report).toHaveBeenCalledWith({ messageId: "namedType", node: objectType });
  });

  it("does not expand the restriction to returns or composed types", () => {
    const report = vi.fn();
    const visitor = plugin.rules["no-inline-object-parameter-types"].create({ report });
    const objectType: AstNode = { type: "TSTypeLiteral" };
    visitor.TSTypeAnnotation({
      parent: { type: "FunctionDeclaration" },
      type: "TSTypeAnnotation",
      typeAnnotation: objectType,
    });
    visitor.TSTypeAnnotation({
      parent: { parent: { params: [], type: "FunctionDeclaration" }, type: "Identifier" },
      type: "TSTypeAnnotation",
      typeAnnotation: { type: "TSUnionType" },
    });
    visitor.TSTypeAnnotation({
      parent: { parent: { params: [], type: "FunctionDeclaration" }, type: "Identifier" },
      type: "TSTypeAnnotation",
      typeAnnotation: { type: "TSIntersectionType" },
    });

    expect(report).not.toHaveBeenCalled();
  });

  it("rejects raw typography and non-zero spacing style values", () => {
    const report = vi.fn();
    const visitor = plugin.rules["no-raw-style-values"].create({ report });
    const fontSize = createProperty("fontSize", { type: "Literal", value: 14 });
    const padding = createProperty("paddingHorizontal", { type: "Literal", value: 16 });

    visitor.Property(fontSize);
    visitor.Property(padding);

    expect(report).toHaveBeenNthCalledWith(1, {
      messageId: "typography",
      node: fontSize.value,
    });
    expect(report).toHaveBeenNthCalledWith(2, {
      messageId: "spacing",
      node: padding.value,
    });
  });

  it("allows scale references, dynamic geometry, and zero resets", () => {
    const report = vi.fn();
    const visitor = plugin.rules["no-raw-style-values"].create({ report });

    visitor.Property(createProperty("fontSize", { name: "resolvedFontSize", type: "Identifier" }));
    visitor.Property(createProperty("padding", { name: "spacing", type: "Identifier" }));
    visitor.Property(createProperty("paddingVertical", { type: "Literal", value: 0 }));

    expect(report).not.toHaveBeenCalled();
  });
});
