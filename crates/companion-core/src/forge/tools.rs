//! `codewide_link_pull_request {pullRequestUrl}`: the only forge tool an
//! agent has. It writes companion link state only (source `agent`), scoped
//! to the calling thread, and fails as an unsuccessful tool result. It never
//! writes to a forge, starts an auth flow or runs an action.

use std::sync::{Arc, Weak};

use async_trait::async_trait;
use forge_protocol::{ForgePrRef, ResolveParams, ResolveResult, capability, methods};
use serde_json::{Value, json};

use super::{
    ForgeContext,
    ids::{PullRequestKey, parse_thread_id},
    wire::LinkSource,
};
use crate::agent::{
    model::{ClientToolSpec, ProviderId, ToolCallParams, ToolCallResult},
    provider::ClientToolHost,
};

pub const LINK_TOOL: &str = "codewide_link_pull_request";
const MAX_URL_BYTES: usize = 2_048;

/// The tool declaration, identical for every provider.
#[must_use]
pub fn spec() -> ClientToolSpec {
    ClientToolSpec {
        name: LINK_TOOL.into(),
        description: "Link this thread to a pull request on a connected forge, so the pull request shows this thread and the thread shows the pull request. It changes only CodeWide's links; it never writes to the forge.".into(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "pullRequestUrl": {
                    "type": "string",
                    "description": "The web URL of the pull request, for example https://github.com/owner/repo/pull/12."
                }
            },
            "required": ["pullRequestUrl"],
            "additionalProperties": false
        }),
    }
}

pub struct ForgeTools {
    context: Weak<ForgeContext>,
    specs: Vec<ClientToolSpec>,
}

impl ForgeTools {
    #[must_use]
    pub fn new(context: &Arc<ForgeContext>) -> Arc<Self> {
        Arc::new(Self {
            context: Arc::downgrade(context),
            specs: vec![spec()],
        })
    }

    async fn link(&self, call: &ToolCallParams) -> Result<Value, String> {
        let context = self
            .context
            .upgrade()
            .ok_or_else(|| "no connected forge account".to_owned())?;
        let url = call
            .arguments
            .get("pullRequestUrl")
            .and_then(Value::as_str)
            .filter(|url| url.len() <= MAX_URL_BYTES)
            .ok_or_else(|| "pullRequestUrl must be a URL".to_owned())?;
        let parsed = url::Url::parse(url).map_err(|_| "pullRequestUrl must be a URL".to_owned())?;
        if parsed.scheme() != "https" {
            return Err("pullRequestUrl must be an https URL".into());
        }
        let number = parsed
            .path_segments()
            .and_then(|mut segments| {
                segments.rfind(|segment| {
                    !segment.is_empty() && segment.bytes().all(|byte| byte.is_ascii_digit())
                })
            })
            .map(str::to_owned)
            .ok_or_else(|| "the URL does not name a pull request".to_owned())?;
        let thread = parse_thread_id(call.app_thread_id.as_str())
            .ok_or_else(|| "the calling thread is unknown".to_owned())?;
        let links = context
            .accounts
            .links()
            .map_err(|_| "forge accounts are unavailable".to_owned())?;
        let entries = context
            .providers
            .entries()
            .map_err(|_| "forge providers are unavailable".to_owned())?;
        let mut connected = false;
        for entry in entries
            .into_iter()
            .filter(|entry| entry.enabled && entry.spec.is_some())
        {
            if !links.iter().any(|link| link.plugin_id == entry.plugin_id) {
                continue;
            }
            connected = true;
            let Ok(mut session) = context.session(&entry.plugin_id).await else {
                continue;
            };
            let resolved: Option<ResolveResult> = if session.supports(capability::RESOLVE) {
                session
                    .call(
                        methods::REPOSITORY_RESOLVE,
                        &ResolveParams {
                            remotes: vec![url.to_owned()],
                        },
                    )
                    .await
                    .ok()
            } else {
                None
            };
            session.shutdown().await;
            let Some(resolved) = resolved else {
                continue;
            };
            if !links.iter().any(|link| {
                link.plugin_id == entry.plugin_id && link.host.eq_ignore_ascii_case(&resolved.host)
            }) {
                continue;
            }
            let pr_ref = ForgePrRef {
                host: resolved.host,
                repository: resolved.repository.clone(),
                number: number.clone(),
            };
            let key = PullRequestKey::issue(&entry.plugin_id, &pr_ref);
            context
                .links
                .link(&key, &entry.plugin_id, &number, &thread, LinkSource::Agent)
                .map_err(|_| "the link could not be stored".to_owned())?;
            context.cache.invalidate_pull_request(&key);
            context.events.pull_request(&key).await;
            context.events.list().await;
            return Ok(json!({
                "linked": true,
                "repository": resolved.repository,
                "number": number,
            }));
        }
        if connected {
            Err("no connected forge account owns this URL".into())
        } else {
            Err("no connected forge account".into())
        }
    }
}

#[async_trait]
impl ClientToolHost for ForgeTools {
    fn specs(&self) -> &[ClientToolSpec] {
        &self.specs
    }

    async fn call(&self, provider: &ProviderId, call: ToolCallParams) -> ToolCallResult {
        match self.link(&call).await {
            Ok(result) => ToolCallResult::text(result.to_string()),
            Err(message) => {
                tracing::info!(tool = LINK_TOOL, provider = %provider, "forge tool call failed");
                ToolCallResult::failure(message)
            }
        }
    }
}
