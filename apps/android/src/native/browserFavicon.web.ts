/** The web placeholder has no Android WebView instance or native favicon bitmap. */
// WHY: Both platform adapters have a Promise ABI, but the web placeholder has no native operation to await.
// Resolving null is its complete result; scheduling artificial async work would add no behavior.
// oxlint-disable-next-line typescript/require-await
export async function readBrowserFavicon(_target: number, _url: string): Promise<string | null> {
  return null;
}
