/** Props of the thinking level slider shared by model pickers. */
export type ThinkingLevelSliderProps = {
  /** The model's levels, lowest first. */
  readonly levels: readonly string[];
  readonly onSelect: (effort: string) => void;
  /** The chosen level; the model's default when the choice names none. */
  readonly selected: string;
  readonly testID: string;
};
