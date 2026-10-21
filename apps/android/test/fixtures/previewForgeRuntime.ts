/**
 * Stand-in for `src/data/forgeRuntime` inside the browser preview bundle: the
 * same process-lifetime owners, built over the fake companion instead of the
 * native session supervisor.
 */
export {
  forgeResources,
  pullRequestCommentDestinations,
  pullRequestLinkResources,
  reviewResources,
} from "./previewCompanion";

/** The preview drops nothing worth reporting. */
export function reportDroppedForgeAction(): void {}
