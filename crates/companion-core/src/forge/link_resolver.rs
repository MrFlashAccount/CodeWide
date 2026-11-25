//! Read-only admission of a PR web link. Only the provider owning the URL sees it.
//! A path match alone does not prove that a particular account can read the PR.

use forge_protocol::{ForgePrRef, PullRequestOverview, PullRequestParams, capability, methods};
use serde::Deserialize;
use serde_json::{Value, json};

use super::{
    ForgeContext,
    accounts::AccountLink,
    errors::ForgeError,
    ids::{ForgeAccountKey, PullRequestKey},
    params,
    plugin_client::PluginSession,
    wire,
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Request {
    plugin_id: String,
    url: String,
}

pub(super) struct PageUrl(url::Url);

impl PageUrl {
    pub(super) fn parse(raw: &str) -> Result<Self, ForgeError> {
        let mut url = url::Url::parse(raw).map_err(|_| ForgeError::invalid("invalid PR URL"))?;
        if raw.len() > 8192
            || url.scheme() != "https"
            || !url.username().is_empty()
            || url.password().is_some()
        {
            return Err(ForgeError::invalid("expected a credential-free HTTPS URL"));
        }
        url.set_query(None);
        url.set_fragment(None);
        Ok(Self(url))
    }
}

pub(super) struct AdmittedLink {
    pub(super) reference: ForgePrRef,
    account: ForgeAccountKey,
    repository_label: String,
}

impl AdmittedLink {
    fn into_wire(self, plugin_id: &str) -> Value {
        let canonical = PullRequestKey::issue(plugin_id, &self.reference);
        json!({
            "account": self.account,
            "canonical": canonical,
            "pullRequest": canonical.with_account(&self.account),
            "repository": self.repository_label,
            "number": self.reference.number,
        })
    }
}

pub(super) async fn resolve(context: &ForgeContext, raw: &Value) -> Result<Value, ForgeError> {
    let request: Request = params(raw)?;
    let page = PageUrl::parse(&request.url)?;
    let links = context.accounts.links_of(&request.plugin_id)?;
    let choices = admit(context, &request.plugin_id, &page, &links).await?;
    Ok(Value::Array(
        choices
            .into_iter()
            .map(|choice| choice.into_wire(&request.plugin_id))
            .collect(),
    ))
}

pub(super) async fn admit(
    context: &ForgeContext,
    plugin_id: &str,
    page: &PageUrl,
    links: &[AccountLink],
) -> Result<Vec<AdmittedLink>, ForgeError> {
    if links.is_empty() {
        return Ok(Vec::new());
    }
    let url = page.0.as_str();
    let mut session = context.session(plugin_id).await?;
    let hosts = context.declarations.web_hosts(plugin_id);
    let result = if session.supports(capability::PR_LINK)
        && links
            .iter()
            .any(|link| wire::https_on_page_host(url, &link.host, &hosts))
    {
        resolve_accounts(&mut session, plugin_id, url, &hosts, links).await
    } else {
        Ok(Vec::new())
    };
    session.shutdown().await;
    result
}

async fn resolve_accounts(
    session: &mut PluginSession,
    plugin_id: &str,
    url: &str,
    hosts: &[String],
    links: &[AccountLink],
) -> Result<Vec<AdmittedLink>, ForgeError> {
    let reference: Option<ForgePrRef> = session
        .call(methods::PULL_REQUEST_RESOLVE_LINK, &json!({"url":url}))
        .await
        .map_err(|error| ForgeError::from_plugin(plugin_id, None, error))?;
    let Some(reference) = reference else {
        return Ok(Vec::new());
    };
    let key = PullRequestKey::issue(plugin_id, &reference);
    if PullRequestKey::parse(key.as_str()).is_none() {
        return Err(ForgeError::internal("invalid provider PR identity"));
    }
    let mut choices = Vec::new();
    let mut failure = None;
    for link in links.iter().filter(|link| {
        link.host.eq_ignore_ascii_case(&reference.host)
            && wire::https_on_page_host(url, &link.host, hosts)
    }) {
        let read: Result<PullRequestOverview, _> = session
            .call(
                methods::PULL_REQUEST_READ,
                &PullRequestParams {
                    account: link.account_ref(),
                    pr_ref: reference.clone(),
                },
            )
            .await;
        match read.map_err(|error| ForgeError::from_plugin(plugin_id, Some(&link.key), error)) {
            Ok(overview) => {
                // Some forges accept mixed-case URLs but catalog the repository with its original casing.
                // A provider can also use a display label unrelated to its opaque repository id.
                let repository = if reference
                    .repository
                    .eq_ignore_ascii_case(&overview.repository)
                {
                    &overview.repository
                } else {
                    &reference.repository
                };
                choices.push(AdmittedLink {
                    reference: ForgePrRef {
                        host: link.host.clone(),
                        repository: repository.clone(),
                        number: reference.number.clone(),
                    },
                    account: link.key.clone(),
                    repository_label: overview.repository,
                });
            }
            Err(
                ForgeError::AuthRequired { .. }
                | ForgeError::NotFound
                | ForgeError::ForgeRejected { .. },
            ) => (),
            Err(error) => failure = Some(error),
        }
    }
    if choices.is_empty()
        && let Some(error) = failure
    {
        return Err(error);
    }
    Ok(choices)
}
