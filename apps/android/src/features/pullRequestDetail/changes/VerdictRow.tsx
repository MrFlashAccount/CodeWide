import { View } from "react-native";

import type { ActionDescriptor } from "../../../data/forgeActionCatalog";
import { AppButton } from "../../../presentation/controls/AppButton";
import { ActionMenu } from "../../../ui/ActionMenu";
import { AppText as Text } from "../../../ui/Typography";
import { submitSheetStyles as styles } from "./SubmitReviewSheet.styles";

/** Verdict choice (labels come from the plugin) and a destructive verdict's consequence line. */
export function VerdictRow({
  busy,
  host,
  onSelect,
  verdict,
  verdicts,
}: {
  readonly busy: boolean;
  readonly host: string;
  readonly onSelect: (actionId: string) => void;
  readonly verdict: ActionDescriptor;
  readonly verdicts: readonly ActionDescriptor[];
}): React.JSX.Element {
  return (
    <>
      <View style={styles.line}>
        <SheetLineText
          detail={`From the plugin: ${verdicts.map((item) => item.label).join(" · ")}`}
          title="Verdict"
        />
        <VerdictPicker busy={busy} onSelect={onSelect} verdict={verdict} verdicts={verdicts} />
      </View>
      {verdict.confirm === "destructive" ? (
        <Text
          style={styles.danger}
        >{`! ${verdict.label} stops this change on ${host} until a reviewer clears it.`}</Text>
      ) : null}
    </>
  );
}

/** Title over a muted detail line in the Submit sheet. */
export function SheetLineText({
  detail,
  title,
}: {
  readonly detail: string;
  readonly title: string;
}): React.JSX.Element {
  return (
    <View style={styles.lineBody}>
      <Text style={styles.label}>{title}</Text>
      <Text style={styles.meta}>{detail}</Text>
    </View>
  );
}

function VerdictPicker({
  busy,
  onSelect,
  verdict,
  verdicts,
}: {
  readonly busy: boolean;
  readonly onSelect: (actionId: string) => void;
  readonly verdict: ActionDescriptor;
  readonly verdicts: readonly ActionDescriptor[];
}): React.JSX.Element {
  return (
    <ActionMenu
      accessibilityLabel="Verdict"
      actions={verdicts.map((item) => ({
        id: item.actionId,
        label: item.label,
        selected: item.actionId === verdict.actionId,
      }))}
      onSelect={onSelect}
    >
      <AppButton
        accessibilityLabel={`Verdict ${verdict.label}`}
        isDisabled={busy}
        size="sm"
        variant="outline"
      >
        {`${verdict.label} ▾`}
      </AppButton>
    </ActionMenu>
  );
}
