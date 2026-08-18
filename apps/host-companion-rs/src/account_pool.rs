use std::{
    path::{Path, PathBuf},
    process::Stdio,
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tokio::{
    fs,
    io::AsyncWriteExt,
    process::{Child, Command},
    sync::{Mutex, broadcast},
    time::{Instant, timeout},
};
use tracing::{info, warn};

use crate::upstream::{ConnectionStatus, UpstreamHandle};

const STATE_VERSION: u32 = 1;
const APP_SERVER_LIVE_TIMEOUT: Duration = Duration::from_secs(30);
const AUTH_REFRESH_TIMEOUT: Duration = Duration::from_secs(8);
const ENROLLMENT_SERVER_TIMEOUT: Duration = Duration::from_secs(15);
const ENROLLMENT_AUTH_WRITE_TIMEOUT: Duration = Duration::from_secs(2);
const CHATGPT_TOKEN_ENDPOINT: &str = "https://auth.openai.com/oauth/token";
const CODEX_OAUTH_CLIENT_ID: &str = "app_EMoamEEZ73f0CkXaXp7hrann";

#[derive(Debug, thiserror::Error)]
pub enum AccountPoolError {
    #[error("account pool request is invalid: {0}")]
    InvalidRequest(String),
    #[error("account pool storage failed: {0}")]
    Storage(String),
    #[error("Codex account credentials are unavailable")]
    CredentialsUnavailable,
    #[error("all configured Codex accounts are exhausted")]
    Exhausted,
    #[error("Codex App Server account operation failed: {0}")]
    Upstream(String),
    #[error("Codex App Server restart failed: {0}")]
    Restart(String),
    #[error("Codex account operation deferred: {0}")]
    Deferred(String),
}

impl From<std::io::Error> for AccountPoolError {
    fn from(error: std::io::Error) -> Self {
        Self::Storage(error.to_string())
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AccountProfile {
    pub id: String,
    pub email: Option<String>,
    pub plan_type: Option<String>,
    pub priority: u32,
    pub enabled: bool,
    pub active: bool,
    pub exhausted_until: Option<i64>,
    pub exhausted_indefinitely: bool,
    pub rate_limits: Option<Value>,
    pub last_used_at: Option<i64>,
}

impl AccountProfile {
    fn eligible_at(&self, now: i64) -> bool {
        self.enabled
            && !self.exhausted_indefinitely
            && self.exhausted_until.is_none_or(|reset| reset <= now)
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PersistedAccountPool {
    version: u32,
    active_profile_id: Option<String>,
    profiles: Vec<AccountProfile>,
}

impl Default for PersistedAccountPool {
    fn default() -> Self {
        Self {
            version: STATE_VERSION,
            active_profile_id: None,
            profiles: Vec::new(),
        }
    }
}

struct PendingLogin {
    login_id: String,
    login_result: Value,
    upstream: UpstreamHandle,
    child: Child,
    home: PathBuf,
}

#[derive(Default)]
struct RuntimeState {
    persisted: PersistedAccountPool,
    pending_login: Option<PendingLogin>,
    account_epoch: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct AccountLease {
    profile_id: String,
    epoch: u64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum RefreshOutcome {
    NoActive,
    Stale,
    Current { blocking: Option<BlockingState> },
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum BlockingState {
    Available,
    Until(i64),
    Indefinite,
}

#[derive(Clone)]
pub struct AccountPoolService {
    upstream: UpstreamHandle,
    codex_home: PathBuf,
    state_path: PathBuf,
    credentials_dir: PathBuf,
    enrollment_dir: PathBuf,
    http: reqwest::Client,
    state: Arc<Mutex<RuntimeState>>,
    switch_lock: Arc<Mutex<()>>,
    login_lock: Arc<Mutex<()>>,
    events: broadcast::Sender<Value>,
}

impl AccountPoolService {
    /// Opens the companion-owned account pool. Credentials never enter the
    /// public state document; every profile has a private 0600 auth blob.
    ///
    /// # Errors
    ///
    /// Returns a storage error when private state cannot be loaded or created.
    pub async fn open(
        upstream: UpstreamHandle,
        codex_home: PathBuf,
        data_dir: PathBuf,
    ) -> Result<Arc<Self>, AccountPoolError> {
        let root = data_dir.join("account-pool");
        let credentials_dir = root.join("credentials");
        let enrollment_dir = root.join("enrollment");
        fs::create_dir_all(&credentials_dir).await?;
        fs::create_dir_all(&enrollment_dir).await?;
        set_private_directory(&root).await?;
        set_private_directory(&credentials_dir).await?;
        set_private_directory(&enrollment_dir).await?;
        clear_stale_enrollment_homes(&enrollment_dir).await?;
        let state_path = root.join("state.json");
        let persisted = load_state(&state_path).await?;
        let http = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(3))
            .timeout(AUTH_REFRESH_TIMEOUT)
            .build()
            .map_err(|error| AccountPoolError::Upstream(error.to_string()))?;
        let (events, _) = broadcast::channel(64);
        let service = Arc::new(Self {
            upstream,
            codex_home,
            state_path,
            credentials_dir,
            enrollment_dir,
            http,
            state: Arc::new(Mutex::new(RuntimeState {
                persisted,
                pending_login: None,
                account_epoch: 0,
            })),
            switch_lock: Arc::new(Mutex::new(())),
            login_lock: Arc::new(Mutex::new(())),
            events,
        });
        service.capture_current_credentials().await?;
        service.spawn_event_worker();
        service.spawn_initial_refresh();
        Ok(service)
    }

    #[must_use]
    pub fn subscribe_events(&self) -> broadcast::Receiver<Value> {
        self.events.subscribe()
    }

    #[must_use]
    pub fn handles(method: &str) -> bool {
        method.starts_with("companion/accountPool/")
    }

    /// Handles one account-pool RPC without exposing credential material.
    ///
    /// # Errors
    ///
    /// Returns a validation, storage, upstream, or account-switching error.
    pub async fn handle(&self, method: &str, params: &Value) -> Result<Value, AccountPoolError> {
        match method {
            "companion/accountPool/list" => self.list().await,
            "companion/accountPool/refresh" => {
                self.refresh_and_reconcile().await?;
                self.list().await
            }
            "companion/accountPool/add/start" => self.start_add().await,
            "companion/accountPool/add/cancel" => self.cancel_add(params).await,
            "companion/accountPool/profile/activate" => self.activate_profile(params).await,
            "companion/accountPool/profile/update" => self.update_profile(params).await,
            "companion/accountPool/profile/remove" => self.remove_profile(params).await,
            _ => Err(AccountPoolError::InvalidRequest(format!(
                "unsupported method {method}"
            ))),
        }
    }

    /// Chooses the account for a new turn. Selection is sticky: the current
    /// fallback remains active until a higher-priority account's known reset
    /// has elapsed. Exhausted accounts are never probed on every request.
    ///
    /// # Errors
    ///
    /// Returns `Exhausted` when no profile can accept work, or a switching
    /// error when the selected profile cannot be activated.
    pub async fn prepare_for_turn(&self) -> Result<(), AccountPoolError> {
        let _switch = self.switch_lock.lock().await;
        self.capture_current_credentials_locked().await?;
        if !self.reconcile_account_selection_locked().await? {
            return Err(AccountPoolError::Exhausted);
        }
        Ok(())
    }

    /// Sends a turn start and retries only when App Server rejected it before
    /// accepting a turn with a confirmed account-usage-limit error.
    ///
    /// # Errors
    ///
    /// Returns an upstream, storage, switching, or pool-exhaustion error.
    pub async fn send_turn_start(&self, request: Value) -> Result<Value, AccountPoolError> {
        let max_attempts = self.state.lock().await.persisted.profiles.len().max(1);
        let mut last_limit_response = None;
        for _ in 0..max_attempts {
            let (response, lease) = match self.send_turn_start_once(request.clone()).await {
                Ok(attempt) => attempt,
                Err(AccountPoolError::Exhausted) => {
                    return Ok(last_limit_response.unwrap_or_else(exhausted_response));
                }
                Err(error) => return Err(error),
            };
            if !self.handle_turn_start_response(&response, &lease).await? {
                return Ok(response);
            }
            last_limit_response = Some(response);
        }
        Ok(last_limit_response.unwrap_or_else(exhausted_response))
    }

    async fn send_turn_start_once(
        &self,
        request: Value,
    ) -> Result<(Value, AccountLease), AccountPoolError> {
        let _switch = self.switch_lock.lock().await;
        self.capture_current_credentials_locked().await?;
        if !self.reconcile_account_selection_locked().await? {
            return Err(AccountPoolError::Exhausted);
        }
        let lease = self
            .current_lease()
            .await
            .ok_or(AccountPoolError::CredentialsUnavailable)?;
        let response = self.request(request).await?;
        Ok((response, lease))
    }

    /// Marks only confirmed usage-limit failures. Generic 429s, auth errors,
    /// transport failures, and invalid requests must not rotate credentials.
    ///
    /// # Errors
    ///
    /// Returns a storage error when the updated sticky state cannot persist.
    async fn handle_turn_start_response(
        &self,
        response: &Value,
        lease: &AccountLease,
    ) -> Result<bool, AccountPoolError> {
        let Some(message) = response
            .get("error")
            .and_then(|error| error.get("message"))
            .and_then(Value::as_str)
        else {
            return Ok(false);
        };
        if !is_confirmed_usage_limit_error(message) {
            return Ok(false);
        }
        let _switch = self.switch_lock.lock().await;
        self.capture_current_credentials_locked().await?;
        if self.current_lease().await.as_ref() != Some(lease) {
            return Ok(true);
        }
        let outcome = self.refresh_active_account_locked().await?;
        if matches!(
            outcome,
            RefreshOutcome::Current {
                blocking: Some(BlockingState::Available) | None
            }
        ) {
            self.mark_lease_exhausted_from_known_limits_locked(lease)
                .await?;
        }
        self.reconcile_account_selection_locked().await?;
        Ok(true)
    }

    async fn list(&self) -> Result<Value, AccountPoolError> {
        let state = self.state.lock().await;
        Ok(public_snapshot(&state.persisted))
    }

    async fn start_add(&self) -> Result<Value, AccountPoolError> {
        let _login = self.login_lock.lock().await;
        if let Some(result) = self
            .state
            .lock()
            .await
            .pending_login
            .as_ref()
            .map(|pending| pending.login_result.clone())
        {
            return Ok(result);
        }
        self.capture_current_credentials().await?;
        let (upstream, mut child, home) = self.spawn_isolated_enrollment().await?;
        let mut events = upstream.subscribe_events();
        let mut status = upstream.subscribe_status();
        let response = upstream
            .request(json!({
                "id": "account-pool-add",
                "method": "account/login/start",
                "params": {"type": "chatgptDeviceCode"}
            }))
            .await
            .map_err(|error| AccountPoolError::Upstream(error.to_string()));
        let response = match response {
            Ok(response) => response,
            Err(error) => {
                cleanup_isolated_enrollment(&mut child, &home).await;
                return Err(error);
            }
        };
        if response.get("error").is_some() {
            let error = AccountPoolError::Upstream(rpc_error_message(&response));
            cleanup_isolated_enrollment(&mut child, &home).await;
            return Err(error);
        }
        let result = response.get("result").cloned().unwrap_or(Value::Null);
        let Some(login_id) = result
            .get("loginId")
            .and_then(Value::as_str)
            .map(str::to_owned)
        else {
            cleanup_isolated_enrollment(&mut child, &home).await;
            return Err(AccountPoolError::Upstream("loginId is missing".into()));
        };
        self.state.lock().await.pending_login = Some(PendingLogin {
            login_id: login_id.clone(),
            login_result: result.clone(),
            upstream: upstream.clone(),
            child,
            home,
        });
        let service = self.clone();
        tokio::spawn(async move {
            loop {
                tokio::select! {
                    event = events.recv() => match event {
                        Ok(event) if event.get("method").and_then(Value::as_str) == Some("account/login/completed") => {
                            let params = event.get("params").cloned().unwrap_or(Value::Null);
                            if params.get("loginId").and_then(Value::as_str).is_none_or(|candidate| candidate == login_id) {
                                if let Err(error) = service.complete_isolated_add(&params).await {
                                    warn!(%error, "isolated account enrollment failed to complete");
                                }
                                return;
                            }
                        }
                        Ok(_) | Err(broadcast::error::RecvError::Lagged(_)) => {}
                        Err(broadcast::error::RecvError::Closed) => {
                            service.fail_isolated_add(&login_id, "isolated App Server closed").await;
                            return;
                        }
                    },
                    changed = status.changed() => {
                        if changed.is_err() || *status.borrow() != ConnectionStatus::Live {
                            service.fail_isolated_add(&login_id, "isolated App Server disconnected").await;
                            return;
                        }
                    }
                }
            }
        });
        Ok(result)
    }

    async fn cancel_add(&self, params: &Value) -> Result<Value, AccountPoolError> {
        let login_id = required_string(params, "loginId")?;
        let _login = self.login_lock.lock().await;
        let mut pending = {
            let mut state = self.state.lock().await;
            let Some(pending) = state.pending_login.take() else {
                return Ok(Value::Null);
            };
            if pending.login_id != login_id {
                state.pending_login = Some(pending);
                return Err(AccountPoolError::InvalidRequest(
                    "account login was not found".into(),
                ));
            }
            pending
        };
        let response = pending
            .upstream
            .request(json!({
                "id": "account-pool-cancel",
                "method": "account/login/cancel",
                "params": {"loginId": login_id}
            }))
            .await;
        cleanup_isolated_enrollment(&mut pending.child, &pending.home).await;
        let response = response.map_err(|error| AccountPoolError::Upstream(error.to_string()))?;
        if response.get("error").is_some() {
            return Err(AccountPoolError::Upstream(rpc_error_message(&response)));
        }
        Ok(response.get("result").cloned().unwrap_or(Value::Null))
    }

    async fn update_profile(&self, params: &Value) -> Result<Value, AccountPoolError> {
        let id = required_string(params, "profileId")?;
        let _switch = self.switch_lock.lock().await;
        let mut state = self.state.lock().await;
        let index = state
            .persisted
            .profiles
            .iter()
            .position(|profile| profile.id == id)
            .ok_or_else(|| AccountPoolError::InvalidRequest("account profile not found".into()))?;
        if let Some(enabled) = params.get("enabled").and_then(Value::as_bool) {
            state.persisted.profiles[index].enabled = enabled;
        }
        if let Some(priority) = params.get("priority").and_then(Value::as_u64) {
            let target = usize::try_from(priority)
                .map_err(|_| AccountPoolError::InvalidRequest("priority is out of range".into()))?
                .min(state.persisted.profiles.len().saturating_sub(1));
            let profile = state.persisted.profiles.remove(index);
            state.persisted.profiles.insert(target, profile);
        }
        normalize_priorities(&mut state.persisted.profiles);
        let persisted = state.persisted.clone();
        drop(state);
        self.persist(&persisted).await?;
        self.emit_updated(&persisted);
        Ok(public_snapshot(&persisted))
    }

    async fn activate_profile(&self, params: &Value) -> Result<Value, AccountPoolError> {
        let id = required_string(params, "profileId")?;
        let _switch = self.switch_lock.lock().await;
        self.capture_current_credentials_locked().await?;
        let should_activate = {
            let state = self.state.lock().await;
            activation_required(&state.persisted, &id)?
        };
        if should_activate {
            self.activate_profile_locked(&id).await?;
            self.reconcile_account_selection_locked().await?;
        }
        self.list().await
    }

    async fn remove_profile(&self, params: &Value) -> Result<Value, AccountPoolError> {
        let id = required_string(params, "profileId")?;
        let _switch = self.switch_lock.lock().await;
        let mut state = self.state.lock().await;
        if state.persisted.active_profile_id.as_deref() == Some(id.as_str()) {
            return Err(AccountPoolError::InvalidRequest(
                "the active account cannot be removed".into(),
            ));
        }
        let before = state.persisted.profiles.len();
        state.persisted.profiles.retain(|profile| profile.id != id);
        if state.persisted.profiles.len() == before {
            return Err(AccountPoolError::InvalidRequest(
                "account profile not found".into(),
            ));
        }
        normalize_priorities(&mut state.persisted.profiles);
        let persisted = state.persisted.clone();
        drop(state);
        let credential_path = self.credential_path(&id);
        if let Err(error) = fs::remove_file(credential_path).await
            && error.kind() != std::io::ErrorKind::NotFound
        {
            return Err(error.into());
        }
        self.persist(&persisted).await?;
        self.emit_updated(&persisted);
        Ok(public_snapshot(&persisted))
    }

    fn spawn_event_worker(self: &Arc<Self>) {
        let service = self.clone();
        let mut events = self.upstream.subscribe_events();
        tokio::spawn(async move {
            loop {
                match events.recv().await {
                    Ok(event) => service.handle_upstream_event(&event).await,
                    Err(broadcast::error::RecvError::Lagged(skipped)) => {
                        warn!(skipped, "account pool missed App Server events");
                        if let Err(error) = service.refresh_and_reconcile().await {
                            warn!(%error, "account pool refresh after lag failed");
                        }
                    }
                    Err(broadcast::error::RecvError::Closed) => return,
                }
            }
        });
    }

    fn spawn_initial_refresh(self: &Arc<Self>) {
        let service = self.clone();
        tokio::spawn(async move {
            if wait_for_live(&service.upstream, APP_SERVER_LIVE_TIMEOUT)
                .await
                .is_ok()
                && let Err(error) = service.refresh_and_reconcile().await
            {
                warn!(%error, "initial account pool refresh failed");
            }
        });
    }

    async fn handle_upstream_event(&self, event: &Value) {
        match event.get("method").and_then(Value::as_str) {
            Some("account/chatgptAuthTokens/refresh") => {
                self.handle_external_auth_refresh(event).await;
            }
            Some("account/rateLimits/updated") => {
                if let Err(error) = self.refresh_and_reconcile().await {
                    warn!(%error, "account pool could not reconcile rate-limit update");
                }
            }
            Some("error") if is_usage_limit_notification(event) => {
                if let Err(error) = self.refresh_and_reconcile().await {
                    warn!(%error, "account pool could not reconcile usage-limit error");
                }
            }
            _ => {}
        }
    }

    async fn handle_external_auth_refresh(&self, event: &Value) {
        let Some(id) = event.get("id").cloned() else {
            warn!("App Server auth refresh request has no id");
            return;
        };
        let previous_account_id = event
            .pointer("/params/previousAccountId")
            .and_then(Value::as_str);
        let response = match self.refresh_external_auth(previous_account_id).await {
            Ok(result) => json!({"id": id, "result": result}),
            Err(error) => {
                warn!(%error, "Codex account token refresh failed");
                json!({
                    "id": id,
                    "error": {
                        "code": -32042,
                        "message": "Codex account token refresh failed"
                    }
                })
            }
        };
        if let Err(error) = self.upstream.respond(response).await {
            warn!(%error, "Codex account token refresh response was not delivered");
        }
    }

    async fn complete_isolated_add(&self, params: &Value) -> Result<(), AccountPoolError> {
        let _login = self.login_lock.lock().await;
        let login_id = params.get("loginId").and_then(Value::as_str);
        let success = params
            .get("success")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let pending = {
            let mut state = self.state.lock().await;
            let Some(pending) = state.pending_login.take() else {
                return Ok(());
            };
            if login_id.is_some_and(|candidate| candidate != pending.login_id) {
                state.pending_login = Some(pending);
                return Ok(());
            }
            pending
        };
        if !success {
            let mut pending = pending;
            cleanup_isolated_enrollment(&mut pending.child, &pending.home).await;
            let _ = self.events.send(json!({
                "method": "companion/accountPool/loginCompleted",
                "params": {"success": false, "error": params.get("error")}
            }));
            return Ok(());
        }
        let account = pending
            .upstream
            .request(json!({
                "id": "account-pool-enrollment-account-read",
                "method": "account/read",
                "params": {"refreshToken": false}
            }))
            .await
            .ok()
            .and_then(|response| response.get("result").cloned())
            .unwrap_or(Value::Null);
        let rate_limits = pending
            .upstream
            .request(json!({
                "id": "account-pool-enrollment-rate-limits",
                "method": "account/rateLimits/read",
                "params": {}
            }))
            .await
            .ok()
            .and_then(|response| response.get("result").cloned());
        let auth = read_enrollment_auth(&pending.home).await;
        let completion = match auth {
            Ok(auth) => {
                let _switch = self.switch_lock.lock().await;
                self.store_enrolled_profile_locked(&auth, &account, rate_limits)
                    .await
            }
            Err(error) => Err(AccountPoolError::Storage(error.to_string())),
        };
        let mut pending = pending;
        cleanup_isolated_enrollment(&mut pending.child, &pending.home).await;
        let added_profile_id = completion?;
        let _ = self.events.send(json!({
            "method": "companion/accountPool/loginCompleted",
            "params": {"success": true, "profileId": added_profile_id}
        }));
        Ok(())
    }

    async fn fail_isolated_add(&self, login_id: &str, reason: &str) {
        let _login = self.login_lock.lock().await;
        let pending = {
            let mut state = self.state.lock().await;
            if state
                .pending_login
                .as_ref()
                .is_none_or(|pending| pending.login_id != login_id)
            {
                return;
            }
            state.pending_login.take()
        };
        if let Some(mut pending) = pending {
            cleanup_isolated_enrollment(&mut pending.child, &pending.home).await;
            let _ = self.events.send(json!({
                "method": "companion/accountPool/loginCompleted",
                "params": {"success": false, "error": reason}
            }));
        }
    }

    async fn spawn_isolated_enrollment(
        &self,
    ) -> Result<(UpstreamHandle, Child, PathBuf), AccountPoolError> {
        let nonce = hex::encode(rand::random::<[u8; 8]>());
        let home = self.enrollment_dir.join(&nonce);
        fs::create_dir_all(&home).await?;
        set_private_directory(&home).await?;
        let local_codex = self
            .codex_home
            .parent()
            .map(|home| home.join(".local/bin/codex"))
            .filter(|path| path.is_file());
        let codex_binary = std::env::var_os("CODEX_BINARY")
            .map(PathBuf::from)
            .or(local_codex)
            .unwrap_or_else(|| PathBuf::from("codex"));
        let mut child = Command::new(codex_binary)
            .arg("app-server")
            .arg("--stdio")
            .env("CODEX_HOME", &home)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .spawn()
            .map_err(|error| AccountPoolError::Upstream(error.to_string()))?;
        let upstream = UpstreamHandle::spawn_stdio(&mut child)
            .map_err(|error| AccountPoolError::Upstream(error.to_string()))?;
        if let Err(error) = wait_for_live(&upstream, ENROLLMENT_SERVER_TIMEOUT).await {
            cleanup_isolated_enrollment(&mut child, &home).await;
            return Err(error);
        }
        Ok((upstream, child, home))
    }

    async fn store_enrolled_profile_locked(
        &self,
        auth: &[u8],
        account_result: &Value,
        rate_snapshot: Option<Value>,
    ) -> Result<String, AccountPoolError> {
        let profile_id = profile_id_from_auth(auth)?;
        write_private_atomic(&self.credential_path(&profile_id), auth).await?;
        let mut state = self.state.lock().await;
        if !state
            .persisted
            .profiles
            .iter()
            .any(|profile| profile.id == profile_id)
        {
            let priority = u32::try_from(state.persisted.profiles.len()).unwrap_or(u32::MAX);
            state.persisted.profiles.push(AccountProfile {
                id: profile_id.clone(),
                email: None,
                plan_type: None,
                priority,
                enabled: true,
                active: false,
                exhausted_until: None,
                exhausted_indefinitely: false,
                rate_limits: None,
                last_used_at: None,
            });
        }
        if let Some(profile) = state
            .persisted
            .profiles
            .iter_mut()
            .find(|profile| profile.id == profile_id)
        {
            apply_profile_observation(profile, account_result, rate_snapshot, true);
        }
        normalize_priorities(&mut state.persisted.profiles);
        let activate = state.persisted.active_profile_id.is_none();
        let persisted = state.persisted.clone();
        drop(state);
        self.persist(&persisted).await?;
        self.emit_updated(&persisted);
        if activate {
            self.activate_profile_locked(&profile_id).await?;
        }
        Ok(profile_id)
    }

    async fn refresh_and_reconcile(&self) -> Result<(), AccountPoolError> {
        let _switch = self.switch_lock.lock().await;
        self.capture_current_credentials_locked().await?;
        self.refresh_active_account_locked().await?;
        self.reconcile_account_selection_locked().await?;
        Ok(())
    }

    async fn refresh_active_account_locked(&self) -> Result<RefreshOutcome, AccountPoolError> {
        let Some(lease) = self.current_lease().await else {
            return Ok(RefreshOutcome::NoActive);
        };
        let account = self
            .request(json!({
                "id": "account-pool-account-read",
                "method": "account/read",
                "params": {"refreshToken": false}
            }))
            .await?;
        if account.get("error").is_some() {
            return Err(AccountPoolError::Upstream(rpc_error_message(&account)));
        }
        let rate_limits = self
            .request(json!({
                "id": "account-pool-rate-limits",
                "method": "account/rateLimits/read",
                "params": {}
            }))
            .await?;
        let account_result = account.get("result").cloned().unwrap_or(Value::Null);
        let rate_snapshot = rate_limits
            .get("error")
            .is_none()
            .then(|| rate_limits.get("result").cloned())
            .flatten();
        let (outcome, persisted) = {
            let mut state = self.state.lock().await;
            let outcome =
                apply_account_observation(&mut state, &lease, &account_result, rate_snapshot, true);
            let persisted =
                matches!(outcome, RefreshOutcome::Current { .. }).then(|| state.persisted.clone());
            (outcome, persisted)
        };
        let Some(persisted) = persisted else {
            return Ok(outcome);
        };
        self.persist(&persisted).await?;
        self.emit_updated(&persisted);
        Ok(outcome)
    }

    async fn mark_lease_exhausted_from_known_limits_locked(
        &self,
        lease: &AccountLease,
    ) -> Result<(), AccountPoolError> {
        let mut state = self.state.lock().await;
        if active_lease(&state).as_ref() != Some(lease) {
            return Ok(());
        }
        let Some(profile) = state
            .persisted
            .profiles
            .iter_mut()
            .find(|profile| profile.id == lease.profile_id)
        else {
            return Ok(());
        };
        let known_reset = profile.rate_limits.as_ref().and_then(|limits| {
            let snapshot = limits.get("rateLimits").unwrap_or(limits);
            latest_reset(snapshot)
        });
        profile.exhausted_until = known_reset;
        profile.exhausted_indefinitely = known_reset.is_none();
        let persisted = state.persisted.clone();
        drop(state);
        self.persist(&persisted).await?;
        self.emit_updated(&persisted);
        Ok(())
    }

    async fn current_lease(&self) -> Option<AccountLease> {
        active_lease(&*self.state.lock().await)
    }

    async fn reconcile_account_selection_locked(&self) -> Result<bool, AccountPoolError> {
        let attempts = self.state.lock().await.persisted.profiles.len().max(1);
        for _ in 0..attempts {
            let (active, target) = {
                let state = self.state.lock().await;
                (
                    state.persisted.active_profile_id.clone(),
                    select_profile(&state.persisted, unix_time()),
                )
            };
            let Some(target) = target else {
                return Ok(false);
            };
            if active.as_deref() == Some(target.as_str()) {
                return Ok(true);
            }
            self.activate_profile_locked(&target).await?;
            let _ = self.events.send(json!({
                "method": "companion/accountPool/fallbackActivated",
                "params": {
                    "fromProfileId": active,
                    "profileId": target,
                    "reason": "accountSelectionPolicy"
                }
            }));
        }
        Ok(select_profile(&self.state.lock().await.persisted, unix_time()).is_some())
    }

    async fn capture_current_credentials(&self) -> Result<(), AccountPoolError> {
        let _switch = self.switch_lock.lock().await;
        self.capture_current_credentials_locked().await
    }

    async fn capture_current_credentials_locked(&self) -> Result<(), AccountPoolError> {
        let auth_path = self.codex_home.join("auth.json");
        let auth = match fs::read(&auth_path).await {
            Ok(auth) => auth,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(error) => return Err(error.into()),
        };
        let profile_id = profile_id_from_auth(&auth)?;
        write_private_atomic(&self.credential_path(&profile_id), &auth).await?;
        let mut state = self.state.lock().await;
        let was_empty = state.persisted.profiles.is_empty();
        if !state
            .persisted
            .profiles
            .iter()
            .any(|profile| profile.id == profile_id)
        {
            let priority = u32::try_from(state.persisted.profiles.len()).unwrap_or(u32::MAX);
            state.persisted.profiles.push(AccountProfile {
                id: profile_id.clone(),
                email: None,
                plan_type: None,
                priority,
                enabled: true,
                active: true,
                exhausted_until: None,
                exhausted_indefinitely: false,
                rate_limits: None,
                last_used_at: Some(unix_time()),
            });
        }
        set_active_profile(&mut state, &profile_id);
        if was_empty {
            normalize_priorities(&mut state.persisted.profiles);
        }
        let persisted = state.persisted.clone();
        drop(state);
        self.persist(&persisted).await?;
        self.emit_updated(&persisted);
        Ok(())
    }

    async fn activate_profile_locked(&self, profile_id: &str) -> Result<(), AccountPoolError> {
        let credentials = fs::read(self.credential_path(profile_id))
            .await
            .map_err(|error| AccountPoolError::Storage(error.to_string()))?;
        let current_auth = self.codex_home.join("auth.json");
        let previous_credentials = fs::read(&current_auth).await?;
        let plan_type = self
            .state
            .lock()
            .await
            .persisted
            .profiles
            .iter()
            .find(|profile| profile.id == profile_id)
            .and_then(|profile| profile.plan_type.clone());
        self.login_with_credentials(&credentials, plan_type.as_deref())
            .await?;
        if let Err(error) = write_private_atomic(&current_auth, &credentials).await {
            let previous_plan_type = self.plan_type_for_credentials(&previous_credentials).await;
            let rollback = self
                .login_with_credentials(&previous_credentials, previous_plan_type.as_deref())
                .await
                .err();
            return Err(AccountPoolError::Storage(match rollback {
                Some(rollback) => {
                    format!("{error}; in-memory credential rollback also failed: {rollback}")
                }
                None => error.to_string(),
            }));
        }
        let mut state = self.state.lock().await;
        set_active_profile(&mut state, profile_id);
        if let Some(profile) = state
            .persisted
            .profiles
            .iter_mut()
            .find(|profile| profile.id == profile_id)
        {
            profile.last_used_at = Some(unix_time());
            profile.exhausted_until = None;
            profile.exhausted_indefinitely = false;
        }
        let persisted = state.persisted.clone();
        drop(state);
        self.persist(&persisted).await?;
        self.emit_updated(&persisted);
        info!(profile_id, "activated Codex account profile");
        self.refresh_active_account_locked().await?;
        Ok(())
    }

    async fn login_with_credentials(
        &self,
        credentials: &[u8],
        plan_type: Option<&str>,
    ) -> Result<(), AccountPoolError> {
        let response = self
            .request(external_login_request(credentials, plan_type)?)
            .await?;
        if response.get("error").is_some() {
            return Err(AccountPoolError::Upstream(rpc_error_message(&response)));
        }
        Ok(())
    }

    async fn plan_type_for_credentials(&self, credentials: &[u8]) -> Option<String> {
        let profile_id = profile_id_from_auth(credentials).ok()?;
        self.state
            .lock()
            .await
            .persisted
            .profiles
            .iter()
            .find(|profile| profile.id == profile_id)
            .and_then(|profile| profile.plan_type.clone())
    }

    async fn refresh_external_auth(
        &self,
        previous_account_id: Option<&str>,
    ) -> Result<Value, AccountPoolError> {
        let profiles = self.state.lock().await.persisted.profiles.clone();
        let mut selected = None;
        for profile in profiles {
            let path = self.credential_path(&profile.id);
            let bytes = match fs::read(&path).await {
                Ok(bytes) => bytes,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
                Err(error) => return Err(error.into()),
            };
            let auth: Value = serde_json::from_slice(&bytes).map_err(|error| {
                AccountPoolError::Storage(format!("invalid stored credentials: {error}"))
            })?;
            let account_id = auth.pointer("/tokens/account_id").and_then(Value::as_str);
            if previous_account_id.is_none_or(|expected| account_id == Some(expected)) {
                selected = Some((profile, path, auth));
                break;
            }
        }
        let (profile, path, mut auth) = selected.ok_or(AccountPoolError::CredentialsUnavailable)?;
        let refresh_token = auth
            .pointer("/tokens/refresh_token")
            .and_then(Value::as_str)
            .ok_or(AccountPoolError::CredentialsUnavailable)?
            .to_owned();
        let endpoint = std::env::var("CODEX_REFRESH_TOKEN_URL_OVERRIDE")
            .unwrap_or_else(|_| CHATGPT_TOKEN_ENDPOINT.to_owned());
        let client_id = std::env::var("CODEX_OAUTH_CLIENT_ID_OVERRIDE")
            .unwrap_or_else(|_| CODEX_OAUTH_CLIENT_ID.to_owned());
        let response = self
            .http
            .post(endpoint)
            .json(&json!({
                "client_id": client_id,
                "grant_type": "refresh_token",
                "refresh_token": refresh_token
            }))
            .send()
            .await
            .map_err(|error| AccountPoolError::Upstream(error.to_string()))?;
        let status = response.status();
        let refreshed: Value = response
            .json()
            .await
            .map_err(|error| AccountPoolError::Upstream(error.to_string()))?;
        if !status.is_success() {
            return Err(AccountPoolError::Upstream(format!(
                "token endpoint returned HTTP {}",
                status.as_u16()
            )));
        }
        let access_token = refreshed
            .get("access_token")
            .and_then(Value::as_str)
            .ok_or_else(|| AccountPoolError::Upstream("token response has no access token".into()))?
            .to_owned();
        let tokens = auth
            .get_mut("tokens")
            .and_then(Value::as_object_mut)
            .ok_or(AccountPoolError::CredentialsUnavailable)?;
        tokens.insert("access_token".into(), Value::String(access_token.clone()));
        if let Some(refresh_token) = refreshed.get("refresh_token").and_then(Value::as_str) {
            tokens.insert(
                "refresh_token".into(),
                Value::String(refresh_token.to_owned()),
            );
        }
        if let Some(id_token) = refreshed.get("id_token").and_then(Value::as_str) {
            tokens.insert("id_token".into(), Value::String(id_token.to_owned()));
        }
        let account_id = tokens
            .get("account_id")
            .and_then(Value::as_str)
            .ok_or(AccountPoolError::CredentialsUnavailable)?
            .to_owned();
        let encoded = serde_json::to_vec_pretty(&auth)
            .map_err(|error| AccountPoolError::Storage(error.to_string()))?;
        write_private_atomic(&path, &encoded).await?;
        if self
            .state
            .lock()
            .await
            .persisted
            .active_profile_id
            .as_deref()
            == Some(profile.id.as_str())
        {
            write_private_atomic(&self.codex_home.join("auth.json"), &encoded).await?;
        }
        Ok(json!({
            "accessToken": access_token,
            "chatgptAccountId": account_id,
            "chatgptPlanType": profile.plan_type
        }))
    }

    async fn request(&self, request: Value) -> Result<Value, AccountPoolError> {
        // A local timeout cannot prove that App Server rejected turn/start: it
        // may accept the request after this future is dropped. Let the caller's
        // durable delivery timeout classify that outcome as uncertain instead
        // of converting it into a definite RPC rejection that invites a retry.
        self.upstream
            .request(request)
            .await
            .map_err(|error| AccountPoolError::Upstream(error.to_string()))
    }

    async fn persist(&self, state: &PersistedAccountPool) -> Result<(), AccountPoolError> {
        let bytes = serde_json::to_vec_pretty(state)
            .map_err(|error| AccountPoolError::Storage(error.to_string()))?;
        write_private_atomic(&self.state_path, &bytes).await
    }

    fn credential_path(&self, profile_id: &str) -> PathBuf {
        self.credentials_dir.join(format!("{profile_id}.json"))
    }

    fn emit_updated(&self, state: &PersistedAccountPool) {
        let _ = self.events.send(json!({
            "method": "companion/accountPool/updated",
            "params": public_snapshot(state)
        }));
    }
}

fn active_lease(state: &RuntimeState) -> Option<AccountLease> {
    state
        .persisted
        .active_profile_id
        .as_ref()
        .map(|profile_id| AccountLease {
            profile_id: profile_id.clone(),
            epoch: state.account_epoch,
        })
}

fn set_active_profile(state: &mut RuntimeState, profile_id: &str) {
    if state.persisted.active_profile_id.as_deref() != Some(profile_id) {
        state.account_epoch = state.account_epoch.wrapping_add(1);
    }
    state.persisted.active_profile_id = Some(profile_id.to_owned());
    for profile in &mut state.persisted.profiles {
        profile.active = profile.id == profile_id;
    }
}

fn apply_account_observation(
    state: &mut RuntimeState,
    lease: &AccountLease,
    result: &Value,
    rate_snapshot: Option<Value>,
    authoritative: bool,
) -> RefreshOutcome {
    if active_lease(state).as_ref() != Some(lease) {
        return RefreshOutcome::Stale;
    }
    let Some(profile) = state
        .persisted
        .profiles
        .iter_mut()
        .find(|profile| profile.id == lease.profile_id)
    else {
        return RefreshOutcome::NoActive;
    };
    let blocking = apply_profile_observation(profile, result, rate_snapshot, authoritative);
    RefreshOutcome::Current { blocking }
}

fn apply_profile_observation(
    profile: &mut AccountProfile,
    result: &Value,
    rate_snapshot: Option<Value>,
    authoritative: bool,
) -> Option<BlockingState> {
    let account = result.get("account");
    profile.email = account
        .and_then(|account| account.get("email"))
        .and_then(Value::as_str)
        .map(str::to_owned)
        .or_else(|| profile.email.clone());
    profile.plan_type = account
        .and_then(|account| account.get("planType"))
        .and_then(Value::as_str)
        .map(str::to_owned)
        .or_else(|| profile.plan_type.clone());
    let snapshot = rate_snapshot?;
    let normalized = normalize_rate_limits(snapshot);
    let limit_snapshot = normalized.get("rateLimits").unwrap_or(&normalized);
    let blocking = blocking_state(limit_snapshot);
    profile.rate_limits = Some(normalized);
    match blocking {
        BlockingState::Until(reset) => {
            profile.exhausted_until = Some(reset);
            profile.exhausted_indefinitely = false;
        }
        BlockingState::Indefinite => {
            profile.exhausted_until = None;
            profile.exhausted_indefinitely = true;
        }
        BlockingState::Available if authoritative => {
            profile.exhausted_until = None;
            profile.exhausted_indefinitely = false;
        }
        BlockingState::Available => {}
    }
    Some(blocking)
}

fn normalize_rate_limits(snapshot: Value) -> Value {
    if snapshot.get("rateLimits").is_some() {
        snapshot
    } else {
        json!({
            "rateLimits": snapshot,
            "rateLimitsByLimitId": null,
            "rateLimitResetCredits": null
        })
    }
}

fn select_profile(state: &PersistedAccountPool, now: i64) -> Option<String> {
    let active = state
        .active_profile_id
        .as_ref()
        .and_then(|id| state.profiles.iter().find(|profile| &profile.id == id));
    if let Some(active) = active
        && active.eligible_at(now)
    {
        let reset_primary = state
            .profiles
            .iter()
            .filter(|profile| profile.priority < active.priority)
            .filter(|profile| profile.enabled && !profile.exhausted_indefinitely)
            .filter(|profile| profile.exhausted_until.is_some_and(|reset| reset <= now))
            .min_by_key(|profile| profile.priority);
        return Some(reset_primary.map_or_else(|| active.id.clone(), |profile| profile.id.clone()));
    }
    state
        .profiles
        .iter()
        .filter(|profile| profile.eligible_at(now))
        .min_by_key(|profile| profile.priority)
        .map(|profile| profile.id.clone())
}

fn activation_required(
    state: &PersistedAccountPool,
    profile_id: &str,
) -> Result<bool, AccountPoolError> {
    let profile = state
        .profiles
        .iter()
        .find(|profile| profile.id == profile_id)
        .ok_or_else(|| AccountPoolError::InvalidRequest("account profile not found".into()))?;
    if !profile.enabled {
        return Err(AccountPoolError::InvalidRequest(
            "a disabled account cannot be activated".into(),
        ));
    }
    Ok(state.active_profile_id.as_deref() != Some(profile_id))
}

impl AccountPoolError {
    #[must_use]
    pub fn is_retryable(&self) -> bool {
        matches!(
            self,
            Self::Storage(_) | Self::Upstream(_) | Self::Restart(_)
        )
    }
}

fn blocking_state(snapshot: &Value) -> BlockingState {
    let reached = snapshot
        .get("rateLimitReachedType")
        .is_some_and(|value| !value.is_null())
        || snapshot
            .get("spendControlReached")
            .and_then(Value::as_bool)
            .unwrap_or(false);
    let mut resets = ["primary", "secondary"]
        .into_iter()
        .filter_map(|key| snapshot.get(key))
        .filter(|window| {
            reached
                || window
                    .get("usedPercent")
                    .and_then(Value::as_i64)
                    .is_some_and(|used| used >= 100)
        })
        .filter_map(|window| window.get("resetsAt").and_then(Value::as_i64))
        .collect::<Vec<_>>();
    if let Some(individual) = snapshot.get("individualLimit")
        && individual.get("remainingPercent").and_then(Value::as_i64) == Some(0)
        && let Some(reset) = individual.get("resetsAt").and_then(Value::as_i64)
    {
        resets.push(reset);
    }
    if let Some(reset) = resets.into_iter().max() {
        BlockingState::Until(reset)
    } else if reached {
        BlockingState::Indefinite
    } else {
        BlockingState::Available
    }
}

fn latest_reset(snapshot: &Value) -> Option<i64> {
    ["primary", "secondary"]
        .into_iter()
        .filter_map(|key| snapshot.get(key))
        .filter_map(|window| window.get("resetsAt").and_then(Value::as_i64))
        .chain(
            snapshot
                .get("individualLimit")
                .and_then(|limit| limit.get("resetsAt"))
                .and_then(Value::as_i64),
        )
        .max()
}

fn is_confirmed_usage_limit_error(message: &str) -> bool {
    let lower = message.to_ascii_lowercase();
    [
        "you've hit your usage limit",
        "you have hit your usage limit",
        "usage limit reached",
        "quota exceeded",
        "credits depleted",
    ]
    .into_iter()
    .any(|needle| lower.contains(needle))
}

fn is_usage_limit_notification(event: &Value) -> bool {
    event
        .pointer("/params/error/codexErrorInfo")
        .and_then(Value::as_str)
        == Some("usageLimitExceeded")
}

fn public_snapshot(state: &PersistedAccountPool) -> Value {
    let next_reset_at = state
        .profiles
        .iter()
        .filter_map(|profile| profile.exhausted_until)
        .min();
    json!({
        "activeProfileId": state.active_profile_id,
        "profiles": state.profiles,
        "nextResetAt": next_reset_at,
        "allExhausted": select_profile(state, unix_time()).is_none()
    })
}

fn normalize_priorities(profiles: &mut [AccountProfile]) {
    profiles.sort_by_key(|profile| profile.priority);
    for (priority, profile) in profiles.iter_mut().enumerate() {
        profile.priority = u32::try_from(priority).unwrap_or(u32::MAX);
    }
}

fn profile_id_from_auth(auth: &[u8]) -> Result<String, AccountPoolError> {
    let parsed: Value = serde_json::from_slice(auth)
        .map_err(|error| AccountPoolError::Storage(format!("invalid auth.json: {error}")))?;
    let identity = parsed
        .get("tokens")
        .and_then(|tokens| tokens.get("account_id"))
        .and_then(Value::as_str)
        .or_else(|| parsed.get("OPENAI_API_KEY").and_then(Value::as_str))
        .ok_or(AccountPoolError::CredentialsUnavailable)?;
    Ok(format!(
        "acct-{}",
        &blake3::hash(identity.as_bytes()).to_hex()[..16]
    ))
}

fn external_login_request(
    credentials: &[u8],
    plan_type: Option<&str>,
) -> Result<Value, AccountPoolError> {
    let auth: Value = serde_json::from_slice(credentials)
        .map_err(|error| AccountPoolError::Storage(format!("invalid credentials: {error}")))?;
    let tokens = auth
        .get("tokens")
        .ok_or(AccountPoolError::CredentialsUnavailable)?;
    let access_token = tokens
        .get("access_token")
        .and_then(Value::as_str)
        .ok_or(AccountPoolError::CredentialsUnavailable)?;
    let account_id = tokens
        .get("account_id")
        .and_then(Value::as_str)
        .ok_or(AccountPoolError::CredentialsUnavailable)?;
    Ok(json!({
        "id": "account-pool-activate",
        "method": "account/login/start",
        "params": {
            "type": "chatgptAuthTokens",
            "accessToken": access_token,
            "chatgptAccountId": account_id,
            "chatgptPlanType": plan_type
        }
    }))
}

async fn load_state(path: &Path) -> Result<PersistedAccountPool, AccountPoolError> {
    let bytes = match fs::read(path).await {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(PersistedAccountPool::default());
        }
        Err(error) => return Err(error.into()),
    };
    let state: PersistedAccountPool = serde_json::from_slice(&bytes)
        .map_err(|error| AccountPoolError::Storage(error.to_string()))?;
    if state.version != STATE_VERSION {
        return Err(AccountPoolError::Storage(format!(
            "unsupported account pool state version {}",
            state.version
        )));
    }
    Ok(state)
}

async fn write_private_atomic(path: &Path, bytes: &[u8]) -> Result<(), AccountPoolError> {
    let parent = path
        .parent()
        .ok_or_else(|| AccountPoolError::Storage("state path has no parent".into()))?;
    fs::create_dir_all(parent).await?;
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| AccountPoolError::Storage("state filename is invalid".into()))?;
    let temporary = parent.join(format!(".{name}.tmp"));
    #[cfg(unix)]
    let mut file = {
        fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(&temporary)
            .await?
    };
    #[cfg(not(unix))]
    let mut file = fs::File::create(&temporary).await?;
    file.write_all(bytes).await?;
    file.sync_all().await?;
    drop(file);
    fs::rename(&temporary, path).await?;
    Ok(())
}

async fn cleanup_isolated_enrollment(child: &mut Child, home: &Path) {
    if let Err(error) = child.kill().await
        && error.kind() != std::io::ErrorKind::InvalidInput
    {
        warn!(%error, "isolated account enrollment process did not stop cleanly");
    }
    if let Err(error) = fs::remove_dir_all(home).await
        && error.kind() != std::io::ErrorKind::NotFound
    {
        warn!(%error, path = %home.display(), "isolated account enrollment home cleanup failed");
    }
}

async fn read_enrollment_auth(home: &Path) -> Result<Vec<u8>, std::io::Error> {
    let path = home.join("auth.json");
    let deadline = Instant::now() + ENROLLMENT_AUTH_WRITE_TIMEOUT;
    loop {
        match fs::read(&path).await {
            Ok(auth) => return Ok(auth),
            Err(error)
                if error.kind() == std::io::ErrorKind::NotFound && Instant::now() < deadline =>
            {
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
            Err(error) => return Err(error),
        }
    }
}

async fn clear_stale_enrollment_homes(root: &Path) -> Result<(), AccountPoolError> {
    let mut entries = fs::read_dir(root).await?;
    while let Some(entry) = entries.next_entry().await? {
        let metadata = entry.file_type().await?;
        if metadata.is_dir() {
            fs::remove_dir_all(entry.path()).await?;
        } else {
            fs::remove_file(entry.path()).await?;
        }
    }
    Ok(())
}

async fn set_private_directory(path: &Path) -> Result<(), AccountPoolError> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, std::fs::Permissions::from_mode(0o700)).await?;
    }
    Ok(())
}

async fn wait_for_live(
    upstream: &UpstreamHandle,
    duration: Duration,
) -> Result<(), AccountPoolError> {
    let deadline = Instant::now() + duration;
    let mut status = upstream.subscribe_status();
    loop {
        if *status.borrow() == ConnectionStatus::Live {
            return Ok(());
        }
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err(AccountPoolError::Upstream(
                "timed out waiting for App Server".into(),
            ));
        }
        timeout(remaining, status.changed())
            .await
            .map_err(|_| AccountPoolError::Upstream("timed out waiting for App Server".into()))?
            .map_err(|_| AccountPoolError::Upstream("status channel closed".into()))?;
    }
}

fn required_string(params: &Value, key: &str) -> Result<String, AccountPoolError> {
    params
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
        .ok_or_else(|| AccountPoolError::InvalidRequest(format!("{key} is required")))
}

fn rpc_error_message(response: &Value) -> String {
    response
        .get("error")
        .and_then(|error| error.get("message"))
        .and_then(Value::as_str)
        .unwrap_or("App Server request failed")
        .chars()
        .take(500)
        .collect()
}

fn exhausted_response() -> Value {
    json!({
        "error": {
            "code": -32041,
            "message": "All configured Codex accounts are exhausted"
        }
    })
}

fn unix_time() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| {
            i64::try_from(duration.as_secs()).unwrap_or(i64::MAX)
        })
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use super::*;

    fn profile(id: &str, priority: u32, reset: Option<i64>, active: bool) -> AccountProfile {
        AccountProfile {
            id: id.into(),
            email: None,
            plan_type: None,
            priority,
            enabled: true,
            active,
            exhausted_until: reset,
            exhausted_indefinitely: false,
            rate_limits: None,
            last_used_at: None,
        }
    }

    #[test]
    fn sticky_fallback_does_not_probe_exhausted_primary() {
        let state = PersistedAccountPool {
            version: STATE_VERSION,
            active_profile_id: Some("backup".into()),
            profiles: vec![
                profile("primary", 0, Some(500), false),
                profile("backup", 1, None, true),
            ],
        };
        assert_eq!(select_profile(&state, 100).as_deref(), Some("backup"));
    }

    #[test]
    fn reset_returns_selection_to_primary() {
        let state = PersistedAccountPool {
            version: STATE_VERSION,
            active_profile_id: Some("backup".into()),
            profiles: vec![
                profile("primary", 0, Some(500), false),
                profile("backup", 1, None, true),
            ],
        };
        assert_eq!(select_profile(&state, 500).as_deref(), Some("primary"));
    }

    #[test]
    fn active_fallback_stays_sticky_without_a_known_primary_reset() {
        let state = PersistedAccountPool {
            version: STATE_VERSION,
            active_profile_id: Some("backup".into()),
            profiles: vec![
                profile("primary", 0, None, false),
                profile("backup", 1, None, true),
            ],
        };
        assert_eq!(select_profile(&state, 500).as_deref(), Some("backup"));
    }

    #[test]
    fn manual_activation_can_return_to_the_available_primary() {
        let state = PersistedAccountPool {
            version: STATE_VERSION,
            active_profile_id: Some("backup".into()),
            profiles: vec![
                profile("primary", 0, None, false),
                profile("backup", 1, None, true),
            ],
        };
        assert_eq!(activation_required(&state, "primary").ok(), Some(true));
    }

    #[test]
    fn manual_activation_rejects_a_disabled_profile() {
        let mut disabled = profile("primary", 0, None, false);
        disabled.enabled = false;
        let state = PersistedAccountPool {
            version: STATE_VERSION,
            active_profile_id: Some("backup".into()),
            profiles: vec![disabled, profile("backup", 1, None, true)],
        };
        assert!(matches!(
            activation_required(&state, "primary"),
            Err(AccountPoolError::InvalidRequest(message))
                if message == "a disabled account cannot be activated"
        ));
    }

    #[test]
    fn no_fallback_is_terminal_when_every_account_is_exhausted() {
        let state = PersistedAccountPool {
            version: STATE_VERSION,
            active_profile_id: Some("primary".into()),
            profiles: vec![
                profile("primary", 0, Some(500), true),
                profile("backup", 1, Some(600), false),
            ],
        };
        assert_eq!(select_profile(&state, 100), None);
    }

    #[test]
    fn hard_limit_uses_latest_blocking_reset() {
        let snapshot = json!({
            "rateLimitReachedType": "rate_limit_reached",
            "primary": {"usedPercent": 100, "resetsAt": 200},
            "secondary": {"usedPercent": 100, "resetsAt": 500}
        });
        assert_eq!(blocking_state(&snapshot), BlockingState::Until(500));
    }

    #[test]
    fn classifier_does_not_rotate_on_generic_failures() {
        assert!(!is_confirmed_usage_limit_error("429 upstream unavailable"));
        assert!(!is_confirmed_usage_limit_error("Unauthorized"));
        assert!(!is_confirmed_usage_limit_error("Invalid request"));
        assert!(is_confirmed_usage_limit_error("Usage limit reached."));
    }

    #[test]
    fn profile_identity_does_not_expose_account_id() {
        let auth = br#"{"tokens":{"account_id":"workspace-secret"}}"#;
        let id = match profile_id_from_auth(auth) {
            Ok(id) => id,
            Err(error) => panic!("profile id must be derived: {error}"),
        };
        assert!(id.starts_with("acct-"));
        assert!(!id.contains("workspace-secret"));
    }

    #[test]
    fn account_switch_uses_in_process_external_auth() {
        let auth = br#"{
            "tokens": {
                "access_token": "access-secret",
                "account_id": "workspace-secret"
            }
        }"#;
        let request = external_login_request(auth, Some("pro")).expect("valid credentials");
        assert_eq!(
            request.get("method").and_then(Value::as_str),
            Some("account/login/start")
        );
        assert_eq!(
            request.pointer("/params/type").and_then(Value::as_str),
            Some("chatgptAuthTokens")
        );
        assert_eq!(
            request
                .pointer("/params/chatgptPlanType")
                .and_then(Value::as_str),
            Some("pro")
        );
    }

    #[test]
    fn stale_limit_observation_cannot_poison_the_new_active_account() {
        let mut state = RuntimeState {
            persisted: PersistedAccountPool {
                version: STATE_VERSION,
                active_profile_id: Some("backup".into()),
                profiles: vec![
                    profile("primary", 0, None, false),
                    profile("backup", 1, None, true),
                ],
            },
            pending_login: None,
            account_epoch: 2,
        };
        let stale_lease = AccountLease {
            profile_id: "primary".into(),
            epoch: 1,
        };
        let outcome = apply_account_observation(
            &mut state,
            &stale_lease,
            &json!({"account": {"email": "wrong@example.com"}}),
            Some(json!({
                "rateLimits": {
                    "rateLimitReachedType": "rate_limit_reached"
                }
            })),
            true,
        );
        assert_eq!(outcome, RefreshOutcome::Stale);
        let backup = state
            .persisted
            .profiles
            .iter()
            .find(|candidate| candidate.id == "backup")
            .expect("backup profile");
        assert_eq!(backup.email, None);
        assert!(!backup.exhausted_indefinitely);
    }

    #[test]
    fn fresh_healthy_observation_clears_only_the_leased_account() {
        let mut active = profile("primary", 0, None, true);
        active.exhausted_indefinitely = true;
        let mut state = RuntimeState {
            persisted: PersistedAccountPool {
                version: STATE_VERSION,
                active_profile_id: Some("primary".into()),
                profiles: vec![active, profile("backup", 1, Some(900), false)],
            },
            pending_login: None,
            account_epoch: 7,
        };
        let lease = active_lease(&state).expect("active lease");
        let outcome = apply_account_observation(
            &mut state,
            &lease,
            &json!({"account": {"email": "primary@example.com", "planType": "pro"}}),
            Some(json!({
                "rateLimits": {
                    "primary": {"usedPercent": 42, "resetsAt": 800}
                }
            })),
            true,
        );
        assert_eq!(
            outcome,
            RefreshOutcome::Current {
                blocking: Some(BlockingState::Available)
            }
        );
        assert_eq!(
            state.persisted.profiles[0].email.as_deref(),
            Some("primary@example.com")
        );
        assert!(!state.persisted.profiles[0].exhausted_indefinitely);
        assert_eq!(state.persisted.profiles[1].exhausted_until, Some(900));
    }

    #[test]
    fn changing_active_account_invalidates_previous_lease() {
        let mut state = RuntimeState {
            persisted: PersistedAccountPool {
                version: STATE_VERSION,
                active_profile_id: Some("primary".into()),
                profiles: vec![
                    profile("primary", 0, None, true),
                    profile("backup", 1, None, false),
                ],
            },
            pending_login: None,
            account_epoch: 3,
        };
        let previous = active_lease(&state).expect("active lease");
        set_active_profile(&mut state, "backup");
        assert_eq!(state.account_epoch, 4);
        assert_ne!(active_lease(&state).as_ref(), Some(&previous));
    }

    #[test]
    fn only_structured_usage_limit_errors_trigger_reconciliation() {
        assert!(is_usage_limit_notification(&json!({
            "method": "error",
            "params": {"error": {"codexErrorInfo": "usageLimitExceeded"}}
        })));
        assert!(!is_usage_limit_notification(&json!({
            "method": "error",
            "params": {"error": {"message": "socket timeout"}}
        })));
    }

    #[test]
    fn enrolled_profile_metadata_does_not_change_the_active_account() {
        let mut enrolled = profile("backup", 1, None, false);
        let blocking = apply_profile_observation(
            &mut enrolled,
            &json!({"account": {"email": "backup@example.com", "planType": "pro"}}),
            Some(json!({
                "rateLimits": {"primary": {"usedPercent": 12, "resetsAt": 900}}
            })),
            true,
        );
        assert_eq!(blocking, Some(BlockingState::Available));
        assert!(!enrolled.active);
        assert_eq!(enrolled.email.as_deref(), Some("backup@example.com"));
        assert_eq!(enrolled.plan_type.as_deref(), Some("pro"));
    }

    #[tokio::test]
    #[ignore = "requires an installed Codex binary"]
    async fn isolated_enrollment_server_does_not_touch_the_main_codex_home()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let codex_home = directory.path().join("main-codex-home");
        let account_root = directory.path().join("account-pool");
        let credentials_dir = account_root.join("credentials");
        let enrollment_dir = account_root.join("enrollment");
        fs::create_dir_all(&codex_home).await?;
        fs::create_dir_all(&credentials_dir).await?;
        fs::create_dir_all(&enrollment_dir).await?;
        fs::write(codex_home.join("auth.json"), b"sentinel").await?;
        let (events, _) = broadcast::channel(8);
        let service = AccountPoolService {
            upstream: UpstreamHandle::spawn(directory.path().join("missing.sock")),
            codex_home: codex_home.clone(),
            state_path: account_root.join("state.json"),
            credentials_dir,
            enrollment_dir,
            http: reqwest::Client::new(),
            state: Arc::new(Mutex::new(RuntimeState::default())),
            switch_lock: Arc::new(Mutex::new(())),
            login_lock: Arc::new(Mutex::new(())),
            events,
        };
        let (upstream, mut child, home) = service.spawn_isolated_enrollment().await?;
        let response = upstream
            .request(json!({
                "id": "probe",
                "method": "account/read",
                "params": {"refreshToken": false}
            }))
            .await?;
        assert!(response.get("result").is_some());
        cleanup_isolated_enrollment(&mut child, &home).await;
        assert_eq!(fs::read(codex_home.join("auth.json")).await?, b"sentinel");
        Ok(())
    }
}
