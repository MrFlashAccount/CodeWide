import { desktopModifierBits } from "../../native/desktopInputCodes";
import { computed, observable } from "@legendapp/state";
import type { DesktopKeyChord } from "../../native/desktopInputContract";
import type { DesktopProfileId, DesktopShortcut } from "./desktopInputProfiles";

type Modifier = "ctrl" | "shift" | "alt";
type InputState =
  | { readonly kind: "touch"; readonly profile: DesktopProfileId }
  | {
      readonly alt: boolean;
      readonly ctrl: boolean;
      readonly dragging: boolean;
      readonly kind: "desktop";
      readonly precision: boolean;
      readonly profile: DesktopProfileId;
      readonly shift: boolean;
    };

/** One surface owns its semantic input state; pointer coordinates stay in native code. */
export class DesktopInputModel {
  readonly #state$;
  readonly state$;

  constructor(profile: DesktopProfileId) {
    this.#state$ = observable<{ snapshot: InputState }>({ snapshot: { kind: "touch", profile } });
    this.state$ = computed(() => this.#state$.snapshot.get());
  }

  toggle(): void {
    const state = this.#state$.snapshot.peek();
    this.#state$.snapshot.set(
      state.kind === "desktop"
        ? { kind: "touch", profile: state.profile }
        : this.desktopState(state.profile),
    );
  }

  reset(): void {
    this.#state$.snapshot.set({ kind: "touch", profile: this.#state$.snapshot.peek().profile });
  }

  release(): void {
    const state = this.#state$.snapshot.peek();
    if (state.kind === "desktop") {
      this.#state$.snapshot.set(this.desktopState(state.profile));
    }
  }

  setProfile(profile: DesktopProfileId): void {
    this.#state$.snapshot.set(
      this.#state$.snapshot.peek().kind === "desktop"
        ? this.desktopState(profile)
        : { kind: "touch", profile },
    );
  }

  toggleModifier(modifier: Modifier): void {
    const state = this.#state$.snapshot.peek();
    if (state.kind === "desktop") {
      this.#state$.snapshot.set({ ...state, [modifier]: !state[modifier] });
    }
  }

  toggleDrag(): void {
    const state = this.#state$.snapshot.peek();
    if (state.kind === "desktop") {
      this.#state$.snapshot.set({ ...state, dragging: !state.dragging });
    }
  }

  togglePrecision(): void {
    const state = this.#state$.snapshot.peek();
    if (state.kind === "desktop") {
      this.#state$.snapshot.set({ ...state, precision: !state.precision });
    }
  }

  chord(shortcut: DesktopShortcut): DesktopKeyChord | null {
    const state = this.#state$.snapshot.peek();
    return state.kind === "touch"
      ? null
      : {
          keyCode: shortcut.keyCode,
          modifiers: shortcut.modifiers | desktopModifiers(state),
        };
  }

  private desktopState(
    profile: DesktopProfileId,
  ): Extract<InputState, { readonly kind: "desktop" }> {
    return {
      alt: false,
      ctrl: false,
      dragging: false,
      kind: "desktop",
      precision: false,
      profile,
      shift: false,
    };
  }
}

/** Encodes the held modifier state for the native input boundary. */
export function desktopModifiers(state: Extract<InputState, { readonly kind: "desktop" }>): number {
  return (
    (state.ctrl ? desktopModifierBits.ctrl : 0) |
    (state.shift ? desktopModifierBits.shift : 0) |
    (state.alt ? desktopModifierBits.alt : 0)
  );
}
