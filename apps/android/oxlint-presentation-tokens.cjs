const spacingProperty = /^(?:gap|rowGap|columnGap|(?:padding|margin)(?:Top|Bottom|Left|Right|Horizontal|Vertical|Start|End)?)$/u;
const typographyProperty = /^(?:fontSize|lineHeight|letterSpacing|fontWeight)$/u;
const radiusProperty = /^border(?:TopLeft|TopRight|BottomLeft|BottomRight|TopStart|TopEnd|BottomStart|BottomEnd)?Radius$/u;

function isControlDimension(node, property) {
  if (property !== "height" && property !== "minHeight") return false;
  const owner = node.parent?.parent;
  return owner?.type === "Property" && /(?:button(?:compact)?|action|trigger|toggle|chip|tab|tabClose|tabSelect|newTab)$/iu.test(owner.key.name ?? owner.key.value);
}

function isPresentationStyle(node) {
  for (let ancestor = node.parent; ancestor; ancestor = ancestor.parent) {
    if (ancestor.type === "JSXAttribute") return ancestor.name.name === "style";
    if (
      ancestor.type === "CallExpression" &&
      ancestor.callee.type === "MemberExpression" &&
      ancestor.callee.object.name === "StyleSheet" &&
      ancestor.callee.property.name === "create"
    ) return true;
  }
  return false;
}

/** Presentation uses shared roles; renderer geometry may reference its own named constants. */
const presentationTokens = {
  meta: {
    type: "suggestion",
    schema: [],
    messages: { raw: "Use a presentation token for {{property}}, not a local literal." },
  },
  create(context) {
    return {
      Property(node) {
        if (node.computed || !isPresentationStyle(node)) return;
        const property = node.key.name ?? node.key.value;
        if (!spacingProperty.test(property) && !typographyProperty.test(property) && !radiusProperty.test(property) && !isControlDimension(node, property)) return;
        const value = node.value.type === "UnaryExpression" ? node.value.argument : node.value;
        if (value.type !== "Literal" || value.value === 0) return;
        if (typeof value.value !== "number" && property !== "fontWeight") return;
        context.report({ node: node.value, messageId: "raw", data: { property } });
      },
    };
  },
};

module.exports = { rules: { "presentation-tokens": presentationTokens } };
