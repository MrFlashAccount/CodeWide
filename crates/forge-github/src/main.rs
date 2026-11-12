//! The built-in GitHub forge plugin executable. Each host ships it in its
//! bundled plugin directory (`libexec/` on Linux, `Contents/Helpers/` in the
//! macOS app); the companion resolves `bundled:github` to it and talks to it
//! over stdin/stdout.

#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Update proofs read the shipped version without speaking the protocol.
    if std::env::args().nth(1).as_deref() == Some("--version") {
        println!(
            "codewide-forge-github {}",
            env!("CODEWIDE_FORGE_PLUGIN_VERSION")
        );
        return Ok(());
    }
    let config = forge_github::PluginConfig::from_process(env!("CODEWIDE_FORGE_PLUGIN_VERSION"));
    forge_github::run_stdio(config).await?;
    Ok(())
}
