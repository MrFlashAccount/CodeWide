/**
 * Marks the end of an exhaustive `switch`: the compiler proves `value` is
 * `never` there, so reaching this at runtime means a value outside its type
 * arrived (for example, from an unchecked source).
 */
export function unreachable(value: never): never {
  throw new Error(`unexpected value: ${JSON.stringify(value)}`);
}
