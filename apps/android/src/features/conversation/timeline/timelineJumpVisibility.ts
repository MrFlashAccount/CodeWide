import { observable } from "@legendapp/state";
import { useConversationCleanup, useConversationState } from "../../../ui/use-conversation-scope";

const END_DISTANCE_THRESHOLD_DP = 12;
const APPEAR_DELAY_MS = 200;

type Visibility =
  | { readonly status: "hidden" }
  | { readonly status: "waiting"; readonly timer: ReturnType<typeof setTimeout> }
  | { readonly status: "visible" };

/** Debounces only the jump control, independently of tail-follow and unread positioning. */
export class TimelineJumpVisibility {
  private state: Visibility = { status: "hidden" };
  // Publish only semantic visibility. Timer handles are private resources, not reactive data.
  readonly visible$ = observable(false);

  /** Receives existing viewport measurements in React Native layout units (dp). */
  update(distanceFromEnd: number, containsLatest: boolean): void {
    if (containsLatest && distanceFromEnd <= END_DISTANCE_THRESHOLD_DP) {
      this.reset();
      return;
    }
    if (this.state.status !== "hidden") {
      return;
    }
    const waiting: Visibility = {
      status: "waiting",
      timer: setTimeout(() => {
        if (this.state === waiting) {
          this.state = { status: "visible" };
          this.visible$.set(true);
        }
      }, APPEAR_DELAY_MS),
    };
    this.state = waiting;
  }

  /** Hides immediately and prevents a cancelled appearance from leaking into another activation. */
  reset(): void {
    const current = this.state;
    if (current.status === "hidden") {
      return;
    }
    if (current.status === "waiting") {
      clearTimeout(current.timer);
    }
    this.state = { status: "hidden" };
    this.visible$.set(false);
  }
}

/** Retains one presentation owner per chat activation and clears its timer on departure. */
export function useTimelineJumpVisibility(composerScope: string): TimelineJumpVisibility {
  const [visibility] = useConversationState(composerScope, () => new TimelineJumpVisibility());
  useConversationCleanup(composerScope, () => {
    visibility.reset();
  });
  return visibility;
}
