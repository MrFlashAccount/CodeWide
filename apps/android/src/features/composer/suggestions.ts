import { useEvent } from "../../react/useEvent";
import type { ComposerMention } from "./input/composer-mentions";
import {
  composerSkillSuggestions,
  composerSkillUrl,
  containsSkillInvocation,
} from "./skills/composer-skill-suggestions";
import type { ComposerSuggestionsCapabilities } from "./suggestionsCapabilities";

export function useComposerSuggestions({
  composerInputRef,
  composerScope,
  composerSession,
  currentControlsResource,
  cwd,
  draftSelectionRef,
  onLoadControls,
  updateComposerPreferences,
  updateDraft,
  updateText,
  voiceController,
}: ComposerSuggestionsCapabilities) {
  const insertSkillInvocation = useEvent((skill: { name: string; path: string }) => {
    const selected = composerSession.read().preferences.skillPaths;
    if (!selected.includes(skill.path)) {
      updateComposerPreferences((current) => ({
        ...current,
        skillPaths: [...current.skillPaths, skill.path],
      }));
    }
    const editor = composerInputRef.current;
    if (editor !== null) {
      editor.focus();
      editor.insertLinkedText(`$${skill.name}`, composerSkillUrl(skill.path));
      editor.insertText(" ");
      return;
    }
    const selection = draftSelectionRef.current;
    const invocation = `$${skill.name} `;
    const current = composerSession.read().plainText;
    const next = `${current.slice(0, selection.start)}${invocation}${current.slice(selection.end)}`;
    const cursor = selection.start + invocation.length;
    updateDraft(next);
    draftSelectionRef.current = { end: cursor, start: cursor };
    voiceController?.setPendingSelection(composerScope, { end: cursor, start: cursor });
  });

  const handleComposerTextChange = useEvent((nextText: Parameters<typeof updateText>[0]) => {
    updateText(nextText);
    const currentSkills = currentControlsResource()?.value?.skills;
    const selected = composerSession.read().preferences.skillPaths;
    if (currentSkills === undefined || selected.length === 0) {
      return;
    }
    const next = selected.filter((path) => {
      const skill = currentSkills.find((candidate) => candidate.path === path);
      return skill !== undefined && containsSkillInvocation(nextText.plainText, skill.name);
    });
    if (next.length !== selected.length) {
      updateComposerPreferences((current) => ({ ...current, skillPaths: next }));
    }
  });

  const searchComposerSuggestions = useEvent(
    async (query: { readonly indicator: "/" | "@"; readonly text: string }) => {
      if (query.indicator !== "/") {
        return [];
      }
      const current = currentControlsResource();
      const value =
        current?.value ?? (onLoadControls === undefined ? null : await onLoadControls(cwd));
      return value === null ? [] : composerSkillSuggestions(value.skills, query.text);
    },
  );

  const selectComposerMention = useEvent((mention: ComposerMention) => {
    if (mention.kind !== "skill") {
      return;
    }
    const selected = composerSession.read().preferences.skillPaths;
    if (!selected.includes(mention.path)) {
      updateComposerPreferences((current) => ({
        ...current,
        skillPaths: [...current.skillPaths, mention.path],
      }));
    }
  });
  return {
    handleComposerTextChange,
    insertSkillInvocation,
    searchComposerSuggestions,
    selectComposerMention,
  };
}
