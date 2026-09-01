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

const PARAMETER_PATTERN_WRAPPERS = new Set([
  "AssignmentPattern",
  "RestElement",
  "TSParameterProperty",
]);

function isDestructuredFunctionParameter(pattern) {
  let parameter = pattern;
  let owner = parameter.parent;

  while (owner && PARAMETER_PATTERN_WRAPPERS.has(owner.type)) {
    parameter = owner;
    owner = parameter.parent;
  }

  return Array.isArray(owner?.params) && owner.params.includes(parameter);
}

const noInlineObjectParameterTypes = {
  meta: {
    docs: {
      description: "Require named object types for function parameters.",
    },
    messages: {
      namedType: "Extract this inline object parameter type into a named type or interface.",
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

const noDestructuredFunctionParameters = {
  meta: {
    docs: {
      description: "Require named function parameters instead of destructuring in signatures.",
    },
    messages: {
      namedParameter:
        "Accept a named parameter and destructure it inside the function body instead.",
    },
    schema: [],
    type: "suggestion",
  },
  create(context) {
    function reportDestructuredParameter(node) {
      if (!isDestructuredFunctionParameter(node)) {
        return;
      }

      context.report({
        messageId: "namedParameter",
        node,
      });
    }

    return {
      ArrayPattern: reportDestructuredParameter,
      ObjectPattern: reportDestructuredParameter,
    };
  },
};

const SPACING_STYLE_PROPERTIES = new Set([
  "columnGap",
  "gap",
  "margin",
  "marginBottom",
  "marginHorizontal",
  "marginLeft",
  "marginRight",
  "marginTop",
  "marginVertical",
  "padding",
  "paddingBottom",
  "paddingHorizontal",
  "paddingLeft",
  "paddingRight",
  "paddingTop",
  "paddingVertical",
  "rowGap",
]);

const TYPOGRAPHY_STYLE_PROPERTIES = new Set([
  "fontFamily",
  "fontSize",
  "fontWeight",
  "letterSpacing",
  "lineHeight",
]);

function staticPropertyName(property) {
  if (property.computed) return null;
  if (property.key.type === "Identifier") return property.key.name;
  if (property.key.type === "Literal" && typeof property.key.value === "string") {
    return property.key.value;
  }
  return null;
}

const noRawStyleValues = {
  meta: {
    docs: {
      description: "Require V2 typography and spacing styles to use the design scale.",
    },
    messages: {
      spacing: "Use the V2 spacing scale instead of a raw spacing value.",
      typography: "Use the V2 typography scale instead of a raw typography value.",
    },
    schema: [],
    type: "suggestion",
  },
  create(context) {
    return {
      Property(node) {
        const propertyName = staticPropertyName(node);
        if (propertyName === null || node.value.type !== "Literal") return;

        if (
          SPACING_STYLE_PROPERTIES.has(propertyName) &&
          typeof node.value.value === "number" &&
          node.value.value !== 0
        ) {
          context.report({ messageId: "spacing", node: node.value });
          return;
        }

        if (TYPOGRAPHY_STYLE_PROPERTIES.has(propertyName)) {
          context.report({ messageId: "typography", node: node.value });
        }
      },
    };
  },
};

export default {
  meta: {
    name: "codewide-v2",
  },
  rules: {
    "no-destructured-function-parameters": noDestructuredFunctionParameters,
    "no-inline-object-parameter-types": noInlineObjectParameterTypes,
    "no-raw-style-values": noRawStyleValues,
  },
};
