const path = require("node:path");

function getModuleStem(filename) {
  return path.basename(filename).replace(/\.(?:native|android|web)?\.[^.]+$/u, "").replace(/\.[^.]+$/u, "");
}

function hasAdjacentJsDoc(sourceCode, node) {
  const comments = sourceCode.getCommentsBefore(node);
  const comment = comments.at(-1);

  return (
    comment?.type === "Block" &&
    comment.value.startsWith("*") &&
    comment.loc.end.line + 1 === node.loc.start.line
  );
}

function getDeclaredNames(declaration) {
  if (declaration.type === "FunctionDeclaration" || declaration.type === "ClassDeclaration") {
    return declaration.id === null ? [] : [declaration.id.name];
  }

  if (declaration.type === "VariableDeclaration") {
    return declaration.declarations.flatMap((declarator) =>
      declarator.id.type === "Identifier" ? [declarator.id.name] : [],
    );
  }

  if (declaration.type === "TSTypeAliasDeclaration" || declaration.type === "TSInterfaceDeclaration") {
    return [declaration.id.name];
  }

  return [];
}

function isPublicContractDeclaration(declaration, moduleStem) {
  if (
    declaration.type !== "TSTypeAliasDeclaration" &&
    declaration.type !== "TSInterfaceDeclaration"
  ) {
    return false;
  }

  return /(?:capabilities|contract)$/iu.test(moduleStem);
}

function requiresJsDoc(declaration, moduleStem) {
  if (isPublicContractDeclaration(declaration, moduleStem)) {
    return true;
  }

  const namesPrimaryExport = getDeclaredNames(declaration).some(
    (name) => name.toLocaleLowerCase("en-US") === moduleStem.toLocaleLowerCase("en-US"),
  );
  if (!namesPrimaryExport) {
    return false;
  }

  if (/^[a-z]/u.test(moduleStem)) {
    return true;
  }

  return /(?:Boundary|Capabilities|Composition|Contract|Detail|Feature|Host|Resource|Root|Screen|Surface|Workspace)$/u.test(
    moduleStem,
  );
}

function isStyleSheetCreateCall(node) {
  return (
    node.type === "CallExpression" &&
    node.callee.type === "MemberExpression" &&
    node.callee.computed === false &&
    node.callee.object.type === "Identifier" &&
    node.callee.object.name === "StyleSheet" &&
    node.callee.property.type === "Identifier" &&
    node.callee.property.name === "create"
  );
}

function isInsideStyleSheetDefinition(node) {
  let current = node;

  while (current.parent !== undefined) {
    const parent = current.parent;

    if (isStyleSheetCreateCall(parent)) {
      return parent.arguments[0] === current;
    }

    if (
      parent.type === "Program" ||
      parent.type === "ExpressionStatement" ||
      parent.type === "VariableDeclarator"
    ) {
      return false;
    }

    current = parent;
  }

  return false;
}

const importsSeparatedFromCode = {
  meta: {
    type: "layout",
    docs: {
      description: "Require a blank line between the import block and module body",
    },
    fixable: "whitespace",
    schema: [],
    messages: {
      missingBlankLine: "Separate the import block from the module body with a blank line.",
    },
  },
  create(context) {
    return {
      Program(node) {
        const firstImportIndex = node.body.findIndex((statement) => statement.type === "ImportDeclaration");

        if (firstImportIndex === -1) {
          return;
        }

        let lastImportIndex = firstImportIndex;
        while (node.body[lastImportIndex + 1]?.type === "ImportDeclaration") {
          lastImportIndex += 1;
        }

        const lastImport = node.body[lastImportIndex];
        const nextStatement = node.body[lastImportIndex + 1];
        if (nextStatement === undefined || nextStatement.loc.start.line > lastImport.loc.end.line + 1) {
          return;
        }

        context.report({
          node: nextStatement,
          messageId: "missingBlankLine",
          fix(fixer) {
            return fixer.insertTextAfter(lastImport, "\n");
          },
        });
      },
    };
  },
};

const styleSheetPropertiesMultiline = {
  meta: {
    type: "layout",
    docs: {
      description: "Keep StyleSheet definitions readable with one property per line",
    },
    fixable: "whitespace",
    schema: [],
    messages: {
      collapsedStyle: "Put StyleSheet object properties and braces on separate lines.",
    },
  },
  create(context) {
    return {
      ObjectExpression(node) {
        if (node.properties.length < 2 || !isInsideStyleSheetDefinition(node)) {
          return;
        }

        const firstProperty = node.properties[0];
        const lastProperty = node.properties.at(-1);
        const needsOpeningLine = node.loc.start.line === firstProperty.loc.start.line;
        const needsClosingLine = lastProperty.loc.end.line === node.loc.end.line;
        const collapsedProperties = node.properties.slice(1).filter((property, index) => {
          const previousProperty = node.properties[index];
          return previousProperty.loc.end.line === property.loc.start.line;
        });

        if (!needsOpeningLine && !needsClosingLine && collapsedProperties.length === 0) {
          return;
        }

        context.report({
          node,
          messageId: "collapsedStyle",
          fix(fixer) {
            const fixes = [];
            if (needsOpeningLine) {
              fixes.push(fixer.insertTextAfterRange([node.range[0], node.range[0] + 1], "\n"));
            }
            for (const property of collapsedProperties) {
              fixes.push(fixer.insertTextBefore(property, "\n"));
            }
            if (needsClosingLine) {
              fixes.push(fixer.insertTextBeforeRange([node.range[1] - 1, node.range[1]], "\n"));
            }
            return fixes;
          },
        });
      },
    };
  },
};

const requirePublicExportJsDoc = {
  meta: {
    type: "suggestion",
    docs: {
      description: "Require JSDoc on a module's primary export and exported public contracts",
    },
    schema: [],
    messages: {
      missingJsDoc: "Document this public export with adjacent JSDoc.",
    },
  },
  create(context) {
    const sourceCode = context.sourceCode;
    const moduleStem = getModuleStem(context.filename);

    return {
      ExportDefaultDeclaration(node) {
        if (
          (node.declaration.type === "FunctionDeclaration" ||
            node.declaration.type === "ClassDeclaration") &&
          !hasAdjacentJsDoc(sourceCode, node)
        ) {
          context.report({ node, messageId: "missingJsDoc" });
        }
      },
      ExportNamedDeclaration(node) {
        if (
          node.declaration !== null &&
          requiresJsDoc(node.declaration, moduleStem) &&
          !hasAdjacentJsDoc(sourceCode, node)
        ) {
          context.report({ node, messageId: "missingJsDoc" });
        }
      },
    };
  },
};

module.exports = {
  rules: {
    "imports-separated-from-code": importsSeparatedFromCode,
    "require-public-export-jsdoc": requirePublicExportJsDoc,
    "stylesheet-properties-multiline": styleSheetPropertiesMultiline,
  },
};
