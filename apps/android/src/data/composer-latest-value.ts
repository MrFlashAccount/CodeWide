export type ComposerLatestValue<T> = {
  latest: T;
  rendered: T;
  scope: string;
};

/**
 * Accepts persisted/rendered updates only while no newer local input is
 * waiting for React DB to project it back into the component.
 */
export function reconcileComposerLatestValue<T>(
  current: ComposerLatestValue<T>,
  scope: string,
  rendered: T,
): ComposerLatestValue<T> {
  if (current.scope !== scope) {
    return { latest: rendered, rendered, scope };
  }
  return {
    latest: Object.is(current.latest, current.rendered) ? rendered : current.latest,
    rendered,
    scope,
  };
}
