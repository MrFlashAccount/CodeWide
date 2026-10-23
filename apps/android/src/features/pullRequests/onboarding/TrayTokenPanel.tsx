import { useState } from "react";
import { View } from "react-native";

import type { AuthMethod } from "../../../data/forgeContract";
import { safeProviderUrl } from "../../../data/forgeProviderUrl";
import { AppButton } from "../../../presentation/controls/AppButton";
import { ProductText } from "../../../presentation/text/ProductText";
import { useEvent } from "../../../react/useEvent";
import { colors } from "../../../theme";
import { AppTextInput } from "../../../ui/Typography";
import { tokenSheetStyles as tokenStyles } from "./TokenPasteSheet.styles";
import { declaredScopes, detailRuns, type DetailRun } from "./tokenSheetText";

/** Secure token entry embedded in the Tray's authentication step. */
export function TrayTokenPanel({
  host,
  method,
  onSubmit,
}: {
  readonly host: string;
  readonly method: AuthMethod;
  readonly onSubmit: (token: string) => Promise<void>;
}): React.JSX.Element {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const submit = useEvent((): void => {
    const value = token.trim();
    setToken("");
    if (value.length === 0) {
      return;
    }
    setBusy(true);
    setFailure(null);
    onSubmit(value)
      .catch((error: unknown) => {
        setFailure(error instanceof Error ? error.message : "The token was not accepted");
      })
      .finally(() => {
        setBusy(false);
      });
  });
  const [generate] = method.links;
  const scopes = declaredScopes(
    generate === undefined ? null : safeProviderUrl(generate.url, host),
  );
  return (
    <View style={tokenStyles.content} testID="forge-tray-token-panel">
      <ProductText style={tokenStyles.body}>
        {detailRuns(method.detail, scopes).map(detailRunNode)}
      </ProductText>
      {method.requiredPermissions.length === 0 ? null : (
        <ProductText style={tokenStyles.body}>
          {`Fine-grained token permissions: ${method.requiredPermissions.join(", ")}.`}
        </ProductText>
      )}
      <AppTextInput
        accessibilityLabel="Token"
        autoCapitalize="none"
        autoComplete="off"
        autoCorrect={false}
        editable={!busy}
        importantForAutofill="no"
        onChangeText={setToken}
        onSubmitEditing={submit}
        placeholder="Paste the token"
        placeholderTextColor={colors.textDim}
        secureTextEntry
        spellCheck={false}
        style={tokenStyles.input}
        textContentType="none"
        value={token}
        voiceInput={false}
      />
      {failure === null ? null : (
        <ProductText accessibilityLiveRegion="polite" style={tokenStyles.error}>
          {failure}
        </ProductText>
      )}
      <AppButton isDisabled={busy || token.trim().length === 0} onPress={submit} pending={busy}>
        Save token
      </AppButton>
    </View>
  );
}

function detailRunNode(run: DetailRun): React.ReactNode {
  return run.code ? (
    <ProductText key={run.offset} style={tokenStyles.scope}>
      {run.text}
    </ProductText>
  ) : (
    run.text
  );
}
