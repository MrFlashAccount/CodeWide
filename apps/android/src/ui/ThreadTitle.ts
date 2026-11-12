/** Leading emoji of a title, rendered by its consumers in a separate glyph slot. */
export function leadingEmoji(value: string): string | null {
  const match =
    /^(\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier}|‍\p{Extended_Pictographic})*)/u.exec(value);
  return match?.[1] ?? null;
}
