export type ComposerLatestValue<T> = {
  scope: string;
  rendered: T;
  latest: T;
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
  if (current.scope !== scope) return { scope, rendered, latest: rendered };
  return {
    scope,
    rendered,
    latest: Object.is(current.latest, current.rendered) ? rendered : current.latest,
  };
}
