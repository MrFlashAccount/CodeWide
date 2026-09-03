import type {
  DocumentLayoutMode,
  DocumentViewerPreferences,
  DocumentViewerPreferenceStore,
} from "../../application/ports/documentViewerPreferenceStore";
import { ObservableResource } from "../../application/resources/resource";
import {
  DEFAULT_DOCUMENT_VIEWER_PREFERENCES,
  documentViewerPreferences,
} from "./documentViewerPreferences";

/** Owns optimistic reader UI changes while durably serializing their V2 preference. */
export class DocumentViewerPreferenceResource extends ObservableResource<DocumentViewerPreferences> {
  readonly #store: DocumentViewerPreferenceStore;
  #pending: Promise<void> = Promise.resolve();
  #revision = 0;
  #started = false;

  constructor(store: DocumentViewerPreferenceStore) {
    super(DEFAULT_DOCUMENT_VIEWER_PREFERENCES);
    this.#store = store;
  }

  override subscribe = (listener: () => void): (() => void) => {
    const unsubscribe = this.addListener(listener);
    if (!this.#started) {
      this.#started = true;
      const revision = this.#revision;
      this.#store.load().then(
        (value) => {
          if (revision === this.#revision)
            this.publish({ status: "ready", value: value ?? this.snapshot().value });
        },
        () =>
          this.publish({
            message: "Reader preferences could not be loaded",
            status: "error",
            value: this.snapshot().value,
          }),
      );
    }
    return unsubscribe;
  };

  changeTextScale(delta: number): void {
    const current = this.snapshot().value;
    this.update(documentViewerPreferences(current.layoutMode, current.textScale + delta));
  }

  resetTextScale(): void {
    this.update(documentViewerPreferences(this.snapshot().value.layoutMode, 1));
  }

  setLayoutMode(layoutMode: DocumentLayoutMode): void {
    this.update(documentViewerPreferences(layoutMode, this.snapshot().value.textScale));
  }

  private update(value: DocumentViewerPreferences): void {
    this.#revision += 1;
    this.publish({ status: "ready", value });
    const save = this.#pending.then(() => this.#store.save(value));
    this.#pending = save.catch(() => undefined);
    save.catch(() => {
      this.publish({ message: "Reader preferences could not be saved", status: "error", value });
    });
  }
}
