//! Forge-hosted media for the companion media path: a URL whose host
//! belongs to a connected account of a provider declaring
//! `forge.conversation@1` is read through that plugin's `forge.media.read`,
//! so a private image is fetched with the account's credential inside the
//! plugin. The companion never sees a token.
//!
//! A host belongs to an account when it is the account's host, a subdomain
//! of it, or one of the provider's declared `mediaHosts`. Accounts on the
//! host itself are asked first. A plugin that refuses the URL (`-32602` or
//! `-32115`) passes it to the next account; when every candidate refuses,
//! the caller keeps its anonymous fetch. The decision uses the providers'
//! remembered declarations and spawns a plugin only to learn an unknown
//! declaration or to read.

use base64::{Engine as _, engine::general_purpose::STANDARD};
use forge_protocol::{MediaReadParams, MediaReadResult, capability, code, methods};
use serde_json::Value;

use super::{
    ForgeContext,
    accounts::AccountLink,
    declarations::Declaration,
    limits,
    plugin_client::{PluginCallError, PluginSession},
    wire::AccountCondition,
};

/// What the forge decided about one media URL.
#[derive(Debug, Eq, PartialEq)]
pub enum MediaRoute {
    /// No connected forge account owns the URL; fetch it anonymously.
    Anonymous,
    /// A plugin read it.
    Read(Vec<u8>),
    /// A plugin owned it and failed; no anonymous fallback.
    Failed(MediaFailure),
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MediaFailure {
    TooLarge,
    Unavailable,
}

/// Routes one canonical `https` media URL.
pub async fn route(context: &ForgeContext, url: &url::Url) -> MediaRoute {
    let Some(authority) = authority(url) else {
        return MediaRoute::Anonymous;
    };
    let (Ok(entries), Ok(links)) = (context.providers.entries(), context.accounts.links()) else {
        tracing::warn!("forge media routing could not read providers or accounts");
        return MediaRoute::Anonymous;
    };
    for entry in entries.iter().filter(|entry| entry.enabled) {
        let connected: Vec<&AccountLink> = links
            .iter()
            .filter(|link| link.plugin_id == entry.plugin_id)
            .filter(|link| context.accounts.condition(&link.key) == AccountCondition::Connected)
            .collect();
        if connected.is_empty() {
            continue;
        }
        let on_host: Vec<&AccountLink> = connected
            .iter()
            .copied()
            .filter(|link| owns_host(&link.host, &authority))
            .collect();
        let mut session = None;
        let declaration = match context.declarations.get(&entry.plugin_id) {
            Some(declaration) => declaration,
            None if on_host.is_empty() => {
                // Only a declared media host could match: learn it once.
                match context.session(&entry.plugin_id).await {
                    Ok(opened) => {
                        let declaration = context
                            .declarations
                            .get(&entry.plugin_id)
                            .unwrap_or_default();
                        session = Some(opened);
                        declaration
                    }
                    Err(_) => continue,
                }
            }
            None => Declaration {
                capabilities: vec![capability::CONVERSATION.to_owned()],
                media_hosts: Vec::new(),
            },
        };
        let candidates = candidates(&declaration, &authority, &on_host, &connected);
        if candidates.is_empty() {
            if let Some(session) = session {
                session.shutdown().await;
            }
            continue;
        }
        let mut session = match session {
            Some(session) => session,
            None => match context.session(&entry.plugin_id).await {
                Ok(session) => session,
                Err(error) => {
                    tracing::warn!(plugin_id = %entry.plugin_id, kind = error.log_kind(), "forge media plugin unavailable");
                    continue;
                }
            },
        };
        let routed = read_with(&mut session, &candidates, url).await;
        session.shutdown().await;
        if let Some(route) = routed {
            return route;
        }
    }
    MediaRoute::Anonymous
}

/// The candidate accounts of one provider: those on the URL's host first,
/// then, for a declared media host, the provider's other connected
/// accounts. Nothing without `forge.conversation@1`.
fn candidates<'a>(
    declaration: &Declaration,
    authority: &str,
    on_host: &[&'a AccountLink],
    connected: &[&'a AccountLink],
) -> Vec<&'a AccountLink> {
    if !declaration.supports(capability::CONVERSATION) {
        return Vec::new();
    }
    let mut candidates = on_host.to_vec();
    if declaration.media_hosts.iter().any(|host| host == authority) {
        candidates.extend(
            connected
                .iter()
                .copied()
                .filter(|link| !on_host.iter().any(|known| known.key == link.key)),
        );
    }
    candidates
}

/// `None` when every candidate refused the URL.
async fn read_with(
    session: &mut PluginSession,
    candidates: &[&AccountLink],
    url: &url::Url,
) -> Option<MediaRoute> {
    if !session.supports(capability::CONVERSATION) {
        return None;
    }
    for account in candidates {
        let read: Result<MediaReadResult, _> = session
            .call(
                methods::MEDIA_READ,
                &MediaReadParams {
                    account: account.account_ref(),
                    url: url.as_str().to_owned(),
                },
            )
            .await;
        match read {
            Ok(result) => return Some(decode(&result)),
            Err(PluginCallError::Remote { code, .. })
                if code == code::INVALID_PARAMS || code == code::NOT_FOUND =>
            {
                // This account's forge does not serve the URL.
            }
            Err(PluginCallError::Remote { code, data, .. }) => {
                let too_large = data
                    .as_ref()
                    .and_then(|data| data.get("kind"))
                    .and_then(Value::as_str)
                    == Some("tooLarge");
                tracing::info!(plugin_id = %session.plugin_id(), code, too_large, "forge media read refused");
                return Some(MediaRoute::Failed(if too_large {
                    MediaFailure::TooLarge
                } else {
                    MediaFailure::Unavailable
                }));
            }
            Err(error) => {
                tracing::warn!(plugin_id = %session.plugin_id(), err = %error, "forge media read failed");
                return Some(MediaRoute::Failed(MediaFailure::Unavailable));
            }
        }
    }
    None
}

fn decode(result: &MediaReadResult) -> MediaRoute {
    // Base64 is 4/3 of the decoded size; refuse before decoding a body that
    // cannot fit.
    if result.bytes_base64.len() / 4 * 3 > limits::MAX_FORGE_MEDIA_BYTES + 3 {
        return MediaRoute::Failed(MediaFailure::TooLarge);
    }
    match STANDARD.decode(result.bytes_base64.as_bytes()) {
        Ok(bytes) if bytes.len() <= limits::MAX_FORGE_MEDIA_BYTES => MediaRoute::Read(bytes),
        Ok(_) => MediaRoute::Failed(MediaFailure::TooLarge),
        Err(_) => MediaRoute::Failed(MediaFailure::Unavailable),
    }
}

/// `host[:port]` of an `https` URL without credentials, lowercase.
fn authority(url: &url::Url) -> Option<String> {
    if url.scheme() != "https" || !url.username().is_empty() || url.password().is_some() {
        return None;
    }
    let host = url.host_str()?.to_ascii_lowercase();
    Some(match url.port() {
        Some(port) => format!("{host}:{port}"),
        None => host,
    })
}

/// Whether `authority` is the account host or one of its subdomains.
fn owns_host(account_host: &str, authority: &str) -> bool {
    let account_host = account_host.to_ascii_lowercase();
    authority == account_host || authority.ends_with(&format!(".{account_host}"))
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use super::*;

    #[test]
    fn hosts_belong_to_their_accounts_and_subdomains_only() {
        assert!(owns_host("github.com", "github.com"));
        assert!(owns_host("ghe.example.com", "media.ghe.example.com"));
        assert!(!owns_host("github.com", "evilgithub.com"));
        assert!(!owns_host("github.com", "github.com.evil.example"));
        let parse = |raw: &str| url::Url::parse(raw).expect("url");
        assert_eq!(
            authority(&parse("https://GitHub.com/a")).as_deref(),
            Some("github.com")
        );
        assert_eq!(authority(&parse("http://github.com/a")), None);
        assert_eq!(authority(&parse("https://u:p@github.com/a")), None);
    }

    #[test]
    fn decoded_media_respect_the_ten_mebibyte_cap() {
        let small = MediaReadResult {
            content_type: "image/png".into(),
            bytes_base64: STANDARD.encode([1_u8, 2, 3]),
        };
        assert_eq!(decode(&small), MediaRoute::Read(vec![1, 2, 3]));
        let large = MediaReadResult {
            content_type: "image/png".into(),
            bytes_base64: STANDARD.encode(vec![0_u8; limits::MAX_FORGE_MEDIA_BYTES + 1]),
        };
        assert_eq!(decode(&large), MediaRoute::Failed(MediaFailure::TooLarge));
    }
}
