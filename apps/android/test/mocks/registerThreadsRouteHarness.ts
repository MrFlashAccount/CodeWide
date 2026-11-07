import V1ListLayout from "../../app/(workspace)/(tabs)/(threads)/(lists)/_layout";
import V1AllRoute from "../../app/(workspace)/(tabs)/(threads)/(lists)/index";
import V1ProjectListRoute from "../../app/(workspace)/(tabs)/(threads)/(lists)/project/[sessionId]";
import V1ThreadsLayout from "../../app/(workspace)/(tabs)/(threads)/_layout";
import V1SearchRoute from "../../app/(workspace)/(tabs)/(threads)/search";
import { registerMockLayout, registerMockRoute } from "./ExpoRouter";

const THREADS_PATHS = [
  "/",
  "/project/[sessionId]",
  "/search",
  "/projects",
  "/projects/add/[connectionId]",
  "/projects/add/index",
  "/new",
  "/new/content/[sessionId]",
  "/new/controls/model",
  "/threads/[connectionId]/[threadId]",
  "/threads/[connectionId]/[threadId]/agents/[agentThreadId]",
] as const;

/** Registers the production Threads and nested catalog layouts in the retained-route harness. */
export function registerThreadsRouteHarness(): void {
  registerMockLayout("threads", THREADS_PATHS, V1ThreadsLayout);
  registerMockLayout("lists", ["/", "/project/[sessionId]"], V1ListLayout);
  registerMockRoute("/", V1AllRoute);
  registerMockRoute("/search", V1SearchRoute);
  registerMockRoute("/project/[sessionId]", V1ProjectListRoute);
}
