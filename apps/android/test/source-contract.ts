export function compactSource(source: string): string {
  return source.replace(/\s+/gu, " ").trim();
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
