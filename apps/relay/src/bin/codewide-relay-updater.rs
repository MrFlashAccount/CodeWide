use std::path::PathBuf;

use codewide_relay::update::{RelayUpdaterRunConfig, ServiceScope};

#[tokio::main]
async fn main() -> std::process::ExitCode {
    let arguments = std::env::args_os().skip(1).collect::<Vec<_>>();
    if arguments.len() == 1 && arguments[0] == "--print-trust" {
        let (key_id, public_key) = codewide_relay::update::embedded_trust();
        if key_id.is_empty() || public_key.is_empty() {
            eprintln!("Relay Updater has no embedded release trust anchor");
            return std::process::ExitCode::FAILURE;
        }
        println!(
            "{key_id}\t{public_key}\t{}\t{}",
            env!("CODEWIDE_RELAY_VERSION"),
            env!("CODEWIDE_RELAY_SOURCE_REVISION")
        );
        return std::process::ExitCode::SUCCESS;
    }
    if arguments.len() != 8 {
        usage();
        return std::process::ExitCode::from(2);
    }
    if arguments[0] != "--state"
        || arguments[2] != "--install-path"
        || arguments[4] != "--scope"
        || arguments[6] != "--service"
    {
        usage();
        return std::process::ExitCode::from(2);
    }
    let service_scope = match arguments[5].to_str() {
        Some("user") => ServiceScope::User,
        Some("system") => ServiceScope::System,
        _ => {
            usage();
            return std::process::ExitCode::from(2);
        }
    };
    let updater_path = match std::env::current_exe() {
        Ok(path) => path,
        Err(error) => {
            eprintln!("Cannot resolve the Relay Updater executable: {error}");
            return std::process::ExitCode::FAILURE;
        }
    };
    match codewide_relay::update::run_pending(RelayUpdaterRunConfig {
        relay_state_root: PathBuf::from(&arguments[1]),
        install_path: PathBuf::from(&arguments[3]),
        updater_path,
        service_scope,
        service_name: arguments[7].to_string_lossy().into_owned(),
    })
    .await
    {
        Ok(()) => std::process::ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("Relay update failed: {error}");
            std::process::ExitCode::FAILURE
        }
    }
}

fn usage() {
    eprintln!(
        "Usage: codewide-relay-updater --state DIR --install-path FILE --scope user|system --service codewide-relay.service"
    );
}
