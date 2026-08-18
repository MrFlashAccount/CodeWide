export type VoiceInputPolicy = {
  voiceInput?: boolean;
  editable?: boolean;
  secureTextEntry?: boolean;
  keyboardType?: string;
  inputMode?: string;
};

const STRUCTURED_KEYBOARD_TYPES = new Set([
  "decimal-pad",
  "email-address",
  "name-phone-pad",
  "number-pad",
  "numeric",
  "phone-pad",
  "url",
  "visible-password",
]);

const STRUCTURED_INPUT_MODES = new Set([
  "decimal",
  "email",
  "numeric",
  "search-none",
  "tel",
  "url",
]);

/**
 * Natural-language inputs support dictation by default. Structured and secret
 * fields opt out automatically, while an explicit voiceInput prop always wins.
 */
export function shouldEnableVoiceInput(policy: VoiceInputPolicy): boolean {
  if (policy.voiceInput !== undefined) return policy.voiceInput;
  if (policy.editable === false || policy.secureTextEntry === true) return false;
  if (policy.keyboardType !== undefined && STRUCTURED_KEYBOARD_TYPES.has(policy.keyboardType)) return false;
  if (policy.inputMode !== undefined && STRUCTURED_INPUT_MODES.has(policy.inputMode)) return false;
  return true;
}
