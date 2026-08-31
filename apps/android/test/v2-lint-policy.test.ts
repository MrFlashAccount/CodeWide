import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import plugin from "../oxlint.v2.plugin.mjs";

interface AstNode {
  parent?: AstNode;
  params?: AstNode[];
  type: string;
  typeAnnotation?: AstNode;
}

describe("V2 lint policy", () => {
  it("keeps named object types and stable JSX callbacks mandatory", () => {
    const config = readFileSync(new URL("../oxlint.v2.config.mjs", import.meta.url), "utf8");
    expect(config).toContain('"codewide-v2/no-inline-object-parameter-types": "error"');
    expect(config).toContain('"typescript/consistent-type-definitions": ["error", "interface"]');
    expect(config).not.toContain('"react-doctor/jsx-no-new-function-as-prop": "off"');
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
});
