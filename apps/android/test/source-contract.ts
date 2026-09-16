export function compactSource(source: string): string {
  return source.replace(/\s+/gu, " ").trim();
}

/** Match one JSX opening element by its semantic props without pinning prop order. */
export function sourceHasJsxElement(
  source: string,
  tagName: string,
  requiredFragments: readonly string[],
): boolean {
  const marker = `<${tagName}`;
  let offset = 0;
  while (offset < source.length) {
    const start = source.indexOf(marker, offset);
    if (start < 0) return false;
    const boundary = source[start + marker.length];
    if (boundary !== undefined && !/[\s/>]/u.test(boundary)) {
      offset = start + marker.length;
      continue;
    }
    let braceDepth = 0;
    let quote: '"' | "'" | "`" | null = null;
    let escaped = false;
    for (let index = start + marker.length; index < source.length; index += 1) {
      const character = source[index];
      if (quote !== null) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === quote) quote = null;
        continue;
      }
      if (character === '"' || character === "'" || character === "`") {
        quote = character;
      } else if (character === "{") {
        braceDepth += 1;
      } else if (character === "}") {
        braceDepth -= 1;
      } else if (character === ">" && braceDepth === 0) {
        const opening = source.slice(start, index + 1);
        if (requiredFragments.every((fragment) => opening.includes(fragment))) return true;
        offset = index + 1;
        break;
      }
    }
    if (offset <= start) return false;
  }
  return false;
}

export function sourceObjectDeclaration(source: string, name: string): string {
  const compact = compactSource(source);
  const marker = `${name}: {`;
  const start = compact.indexOf(marker);
  if (start < 0) return "";

  let depth = 0;
  for (let index = start + name.length + 2; index < compact.length; index += 1) {
    const character = compact[index];
    if (character === "{") depth += 1;
    if (character !== "}") continue;
    depth -= 1;
    if (depth === 0) return compact.slice(start, index + 1);
  }

  return "";
}
