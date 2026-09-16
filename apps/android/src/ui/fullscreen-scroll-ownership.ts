/** A covered timeline cannot acquire scroll intent from another window. */
export function createFullscreenScrollOwnership(onChange: (covered: boolean) => void) {
  const overlays = new Set<string>();
  return {
    didClose: (id: string): void => {
      if (overlays.delete(id) && overlays.size === 0) {
        onChange(false);
      }
    },
    isCovered: () => overlays.size > 0,
    willOpen: (id: string): void => {
      const wasCovered = overlays.size > 0;
      overlays.add(id);
      if (!wasCovered) {
        onChange(true);
      }
    },
  };
}
