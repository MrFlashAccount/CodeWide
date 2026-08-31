const PARAMETER_WRAPPERS = new Set([
  "ArrayPattern",
  "AssignmentPattern",
  "Identifier",
  "ObjectPattern",
  "RestElement",
  "TSParameterProperty",
]);

function isFunctionParameter(typeAnnotation) {
  let parameter = typeAnnotation.parent;

  while (parameter && PARAMETER_WRAPPERS.has(parameter.type)) {
    const owner = parameter.parent;

    if (Array.isArray(owner?.params) && owner.params.includes(parameter)) {
      return true;
    }

    parameter = owner;
  }

  return false;
}

const noInlineObjectParameterTypes = {
  meta: {
    docs: {
      description: "Require named object types for function parameters.",
    },
    messages: {
      namedType:
        "Extract this inline object parameter type into a named type or interface.",
    },
    schema: [],
    type: "suggestion",
  },
  create(context) {
    return {
      TSTypeAnnotation(node) {
        if (node.typeAnnotation.type !== "TSTypeLiteral" || !isFunctionParameter(node)) {
          return;
        }

        context.report({
          messageId: "namedType",
          node: node.typeAnnotation,
        });
      },
    };
  },
};

export default {
  meta: {
    name: "codewide-v2",
  },
  rules: {
    "no-inline-object-parameter-types": noInlineObjectParameterTypes,
  },
};
