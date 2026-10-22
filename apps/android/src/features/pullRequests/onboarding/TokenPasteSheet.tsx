import { useState } from "react";
import { Linking, View } from "react-native";

import type { AuthMethod } from "../../../data/forgeContract";
import { AppButton } from "../../../presentation/controls/AppButton";
import { ProductText } from "../../../presentation/text/ProductText";
import { AppTextInput } from "../../../ui/Typography";
import { useEvent } from "../../../react/useEvent";
import { colors } from "../../../theme";
import { AppSheet } from "../../../ui/AppSheet";
import { tokenSheetStyles as styles } from "./TokenPasteSheet.styles";
import { safeProviderUrl } from "../../../data/forgeProviderUrl";
import { declaredScopes, detailRuns, type DetailRun } from "./tokenSheetText";

/**
 * Paste-a-token method. The field is secure, with autocomplete, suggestions
 * and voice input off; its value lives only in this component, is sent once,
 * and is cleared on submit, dismiss and error. Nothing is persisted.
 */
export function TokenPasteSheet({
  host,
  method,
  onDismiss,
  onSubmit,
  open,
}: {
  readonly host: string;
  readonly method: AuthMethod;
  readonly onDismiss: () => void;
  /** Resolves when the account is saved; rejects with the companion's reason. */
  readonly onSubmit: (token: string) => Promise<void>;
  readonly open: boolean;
}): React.JSX.Element {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const dismiss = useEvent((): void => {
    if (busy) {
      return;
    }
    setToken("");
    setFailure(null);
    onDismiss();
  });
  const submit = useEvent((): void => {
    const value = token.trim();
    setToken("");
    if (value.length === 0) {
      return;
    }
    setBusy(true);
    setFailure(null);
    onSubmit(value)
      .then(onDismiss, (error: unknown) => {
        setFailure(error instanceof Error ? error.message : "The token was not accepted");
      })
      .finally(() => {
        setBusy(false);
      });
  });
  const [generate] = method.links;
  return (
    <AppSheet
      contentProps={{ dismissLabel: "Close token entry", enablePanDownToClose: !busy }}
      isOpen={open}
      onOpenChange={(next) => {
        if (!next) {
          dismiss();
        }
      }}
    >
      <View style={styles.content} testID="forge-token-sheet">
        <ProductText style={styles.title}>{method.label}</ProductText>
        <MethodDetail
          detail={method.detail}
          scopes={declaredScopes(
            generate === undefined ? null : safeProviderUrl(generate.url, host),
          )}
        />
        <ProviderLinks host={host} links={method.links} />
        {method.requiredPermissions.length === 0 ? null : (
          <ProductText style={styles.body}>
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
          style={styles.input}
          textContentType="none"
          value={token}
          voiceInput={false}
        />
        {failure === null ? null : (
          <ProductText accessibilityLiveRegion="polite" style={styles.error}>
            {failure}
          </ProductText>
        )}
        <AppButton isDisabled={busy || token.trim().length === 0} onPress={submit}>
          Save token
        </AppButton>
      </View>
    </AppSheet>
  );
}

/** The plugin's detail as plain text, with its declared scope names in code style. */
function MethodDetail({
  detail,
  scopes,
}: {
  readonly detail: string;
  readonly scopes: ReadonlySet<string>;
}): React.JSX.Element {
  return (
    <ProductText style={styles.body}>{detailRuns(detail, scopes).map(detailRunNode)}</ProductText>
  );
}

/** A declared scope renders as inline code; any other run stays plain text. */
function detailRunNode(run: DetailRun): React.ReactNode {
  return run.code ? (
    <ProductText key={run.offset} style={styles.scope}>
      {run.text}
    </ProductText>
  ) : (
    run.text
  );
}

/** The method's provider pages, left-aligned in the sheet's column. */
function ProviderLinks({
  host,
  links,
}: {
  readonly host: string;
  readonly links: AuthMethod["links"];
}): React.JSX.Element {
  return (
    <View style={styles.links}>
      {links.map((link) => (
        <ProviderLink host={host} key={link.url} label={link.label} url={link.url} />
      ))}
    </View>
  );
}

/** A provider page (Generate token, Fine-grained token) as an outline button; hidden unless safe. */
function ProviderLink({
  host,
  label,
  url,
}: {
  readonly host: string;
  readonly label: string;
  readonly url: string;
}): React.JSX.Element | null {
  const safe = safeProviderUrl(url, host);
  if (safe === null) {
    return null;
  }
  return (
    <AppButton
      accessibilityRole="link"
      onPress={() => {
        // Without a browser the user can still open the page from another device.
        Linking.openURL(safe).catch(() => undefined);
      }}
      size="sm"
      variant="outline"
    >
      {label}
    </AppButton>
  );
}
