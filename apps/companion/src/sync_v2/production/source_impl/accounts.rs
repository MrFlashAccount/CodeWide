use super::*;

impl UpstreamSemanticSource {
    pub(super) async fn account_update(
        &self,
        change: AccountChange,
    ) -> Result<CommandResult, V2Error> {
        let accounts = self
            .services
            .accounts
            .as_ref()
            .ok_or_else(|| V2Error::source_unavailable("account service is unavailable"))?;
        let (method, params, affected) = match change {
            AccountChange::Activate { profile_id } => (
                "companion/accountPool/profile/activate",
                json!({"profileId": profile_id.as_str()}),
                profile_id,
            ),
            AccountChange::Configure {
                profile_id,
                enabled,
                priority,
            } => (
                "companion/accountPool/profile/update",
                json!({"profileId": profile_id.as_str(), "enabled": enabled, "priority": priority}),
                profile_id,
            ),
            AccountChange::Remove { profile_id } => (
                "companion/accountPool/profile/remove",
                json!({"profileId": profile_id.as_str()}),
                profile_id,
            ),
        };
        accounts
            .handle(method, &params)
            .await
            .map_err(|error| account_pool_error(&error))?;
        let list = accounts
            .handle("companion/accountPool/list", &json!({}))
            .await
            .map_err(|error| account_pool_error(&error))?;
        let (active_profile_id, _, _) = normalize::accounts(&list)?;
        Ok(CommandResult::AccountUpdate {
            active_profile_id,
            affected_profile_id: affected,
        })
    }

    pub(super) async fn account_login_start(&self) -> Result<CommandResult, V2Error> {
        let accounts = self
            .services
            .accounts
            .as_ref()
            .ok_or_else(|| V2Error::source_unavailable("account service is unavailable"))?;
        let result = accounts
            .handle("companion/accountPool/add/start", &json!({}))
            .await
            .map_err(|error| account_pool_error(&error))?;
        let (login_id, verification_url, user_code) = parse_account_login_start(&result)?;
        Ok(CommandResult::AccountLoginStart {
            login_id,
            verification_url,
            user_code,
        })
    }

    pub(super) async fn account_login_cancel(
        &self,
        login_id: Id,
    ) -> Result<CommandResult, V2Error> {
        let accounts = self
            .services
            .accounts
            .as_ref()
            .ok_or_else(|| V2Error::source_unavailable("account service is unavailable"))?;
        let result = match accounts
            .handle(
                "companion/accountPool/add/cancel",
                &json!({"loginId": login_id.as_str()}),
            )
            .await
        {
            Ok(result) => result,
            Err(AccountPoolError::InvalidRequest(_)) => {
                return Ok(CommandResult::AccountLoginCancel {
                    login_id,
                    state: AccountLoginCancelState::NotFound,
                });
            }
            Err(error) => return Err(account_pool_error(&error)),
        };
        let state = parse_account_login_cancel(&result)?;
        Ok(CommandResult::AccountLoginCancel { login_id, state })
    }
}

fn account_pool_error(error: &AccountPoolError) -> V2Error {
    match error {
        AccountPoolError::InvalidRequest(_) => V2Error::invalid_request("account request invalid"),
        AccountPoolError::Storage(_)
        | AccountPoolError::CredentialsUnavailable
        | AccountPoolError::Exhausted
        | AccountPoolError::Upstream(_)
        | AccountPoolError::Restart(_)
        | AccountPoolError::Deferred(_) => {
            V2Error::source_unavailable("account service is unavailable")
        }
    }
}

fn parse_account_login_start(result: &Value) -> Result<(Id, String, String), V2Error> {
    if result.get("type").and_then(Value::as_str) != Some("chatgptDeviceCode") {
        return Err(V2Error::source_unavailable(
            "account login returned an unsupported flow",
        ));
    }
    Ok((
        source_result_id(result, "loginId", "account login id")?,
        required_result_string(result, "verificationUrl", "account login verification URL")?,
        required_result_string(result, "userCode", "account login user code")?,
    ))
}

fn parse_account_login_cancel(result: &Value) -> Result<AccountLoginCancelState, V2Error> {
    match result.get("status").and_then(Value::as_str) {
        Some("canceled") => Ok(AccountLoginCancelState::Cancelled),
        Some("notFound") => Ok(AccountLoginCancelState::NotFound),
        None if result.is_null() => Ok(AccountLoginCancelState::NotFound),
        _ => Err(V2Error::source_unavailable(
            "account login cancellation returned an invalid status",
        )),
    }
}

fn source_result_id(value: &Value, field: &str, label: &str) -> Result<Id, V2Error> {
    Id::new(required_result_string(value, field, label)?)
        .map_err(|_| V2Error::source_unavailable(format!("{label} is invalid")))
}

fn required_result_string(value: &Value, field: &str, label: &str) -> Result<String, V2Error> {
    value
        .get(field)
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
        .ok_or_else(|| V2Error::source_unavailable(format!("{label} is missing")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn account_login_contract_is_closed_and_typed() -> Result<(), Box<dyn std::error::Error>> {
        let (login_id, verification_url, user_code) = parse_account_login_start(&json!({
            "type": "chatgptDeviceCode",
            "loginId": "login",
            "verificationUrl": "https://example.test/device",
            "userCode": "ABCD-EFGH",
        }))
        .map_err(|error| format!("valid login response was rejected: {error:?}"))?;

        assert_eq!(login_id.as_str(), "login");
        assert_eq!(verification_url, "https://example.test/device");
        assert_eq!(user_code, "ABCD-EFGH");
        assert_eq!(
            parse_account_login_cancel(&json!({"status": "canceled"}))
                .map_err(|error| format!("valid cancel response was rejected: {error:?}"))?,
            AccountLoginCancelState::Cancelled
        );
        assert_eq!(
            parse_account_login_cancel(&Value::Null)
                .map_err(|error| format!("missing login was rejected: {error:?}"))?,
            AccountLoginCancelState::NotFound
        );
        assert!(parse_account_login_cancel(&json!({"status": "mystery"})).is_err());
        Ok(())
    }
}
