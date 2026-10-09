mod dashboard;
mod panel;

pub use dashboard::run as dashboard;

use super::Color;
use codewide_relay::{
    Result,
    admin::{Reply, Request, read_frame, write_frame},
    enrollment::Phase,
};
use console::style;
use crossterm::event::{self, Event, KeyCode, KeyEventKind, KeyModifiers};
use std::{io::IsTerminal, process::ExitCode, time::Duration};
use tokio::{net::UnixStream, time::Instant};

#[derive(Clone, Copy)]
enum PairExit {
    Connected,
    Cancelled,
    Expired,
    Interrupted,
    Terminated,
}

impl PairExit {
    fn exit_code(self) -> ExitCode {
        ExitCode::from(match self {
            Self::Connected => 0,
            Self::Cancelled | Self::Interrupted => 130,
            Self::Expired => 124,
            Self::Terminated => 143,
        })
    }
}

pub fn configure_color(color: Color, json: bool) {
    let enabled = |terminal| {
        !json
            && match color {
                Color::Always => true,
                Color::Never => false,
                Color::Auto => {
                    terminal
                        && std::env::var_os("NO_COLOR").is_none()
                        && std::env::var("TERM").is_ok_and(|term| term != "dumb")
                }
            }
    };
    console::set_colors_enabled(enabled(std::io::stdout().is_terminal()));
    console::set_colors_enabled_stderr(enabled(std::io::stderr().is_terminal()));
}

pub fn error(message: &str, json: bool) {
    if json {
        eprintln!("{}", serde_json::json!({"error":message}));
    } else {
        eprintln!("{} {message}", style("Error:").for_stderr().red().bold());
    }
}

pub fn reply(reply: Reply, json: bool) -> Result<()> {
    if let Reply::Error { message } = &reply {
        return Err(message.clone().into());
    }
    if json {
        println!("{}", serde_json::to_string(&reply)?);
        return Ok(());
    }
    match reply {
        Reply::Status { port, routes, .. } => {
            println!(
                "{}  {}",
                style("CodeWide Relay").bold(),
                style("Running").green()
            );
            println!("Port {port} · {} paired computers\n", routes.len());
            if routes.is_empty() {
                println!("Connect your first computer with codewide-relay pair");
            }
            for route in routes {
                println!(
                    "{}\n  {}",
                    style(route.label.as_deref().unwrap_or("Unlabelled computer")).bold(),
                    style(route.route_id).dim()
                );
            }
        }
        Reply::Invitation { bundle } => println!("{}", serde_json::to_string(&bundle)?),
        Reply::Revoked { removed } => println!(
            "{}",
            if removed {
                "Computer access revoked."
            } else {
                "This route was already absent."
            }
        ),
        Reply::Renamed { updated } => println!(
            "{}",
            if updated {
                "Computer renamed."
            } else {
                "This route was already absent."
            }
        ),
        Reply::Error { .. } | Reply::Pairing { .. } => {
            return Err("Unexpected Relay control response".into());
        }
    }
    Ok(())
}

pub async fn pair(socket: UnixStream, endpoint: &str) -> Result<ExitCode> {
    // Install both handlers before raw mode: even a signal during the first draw
    // must unwind Screen and close the daemon's enrollment owner.
    let mut terminate = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())?;
    let mut interrupt = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::interrupt())?;
    let mut screen = panel::Screen::open()?;
    pair_on_screen(
        socket,
        endpoint,
        &mut screen,
        &mut terminate,
        &mut interrupt,
        false,
    )
    .await
    .map(PairExit::exit_code)
}

async fn pair_on_screen(
    socket: UnixStream,
    endpoint: &str,
    screen: &mut panel::Screen,
    terminate: &mut tokio::signal::unix::Signal,
    interrupt: &mut tokio::signal::unix::Signal,
    menu: bool,
) -> Result<PairExit> {
    let mut model = panel::Model {
        endpoint: endpoint.to_owned(),
        phase: Phase::Waiting,
        remaining: 60,
        failure: None,
        menu,
    };
    screen.draw(&model)?;
    let result = run_pair(socket, screen, &mut model, terminate, interrupt).await;
    if let Err(error) = &result {
        model.failure = Some(error.to_string());
        let _ = screen.draw(&model);
    }
    result
}

async fn run_pair(
    mut socket: UnixStream,
    screen: &mut panel::Screen,
    model: &mut panel::Model,
    terminate: &mut tokio::signal::unix::Signal,
    interrupt: &mut tokio::signal::unix::Signal,
) -> Result<PairExit> {
    tokio::time::timeout(
        Duration::from_secs(5),
        write_frame(&mut socket, &Request::Pair),
    )
    .await??;
    let (mut reader, mut writer) = socket.into_split();
    let (sender, mut replies) = tokio::sync::mpsc::channel(8);
    let reading = tokio::spawn(async move {
        loop {
            let reply = read_frame::<Reply>(&mut reader).await;
            let failed = reply.is_err();
            if sender.send(reply).await.is_err() || failed {
                break;
            }
        }
    });
    let _reader = ReaderGuard(reading);
    let mut deadline = Instant::now() + Duration::from_mins(1);
    let mut ticks = tokio::time::interval(Duration::from_millis(100));
    loop {
        tokio::select! {
            reply = replies.recv() => {
                match reply.ok_or("The Relay service disconnected")?? {
                    Reply::Pairing { remaining_seconds, phase } => {
                        if matches!(phase, Phase::Confirm { .. }) {
                            // An Enter typed before the code appeared must not approve it.
                            if let Some(exit) = discard_early_keys()? { return cancel(&mut writer, screen, model, exit).await; }
                        }
                        deadline = deadline.min(Instant::now() + Duration::from_secs(remaining_seconds.min(60)));
                        model.phase = phase;
                        model.remaining = remaining(deadline);
                        screen.draw(model)?;
                        if model.phase.finished() {
                            return Ok(match model.phase { Phase::Connected { .. } => PairExit::Connected, Phase::Expired => PairExit::Expired, _ => PairExit::Cancelled });
                        }
                    }
                    Reply::Error { message } => return Err(message.into()),
                    _ => return Err("Unexpected Relay control response".into()),
                }
            }
            _ = ticks.tick() => {
                while event::poll(Duration::ZERO)? {
                    let Event::Key(key) = event::read()? else { continue; };
                    if key.kind != KeyEventKind::Press { continue; }
                    if let Some(exit) = cancellation(key.code, key.modifiers) { return cancel(&mut writer, screen, model, exit).await; }
                    if key.code == KeyCode::Enter && screen.can_confirm()
                        && let Phase::Confirm { candidate, .. } = &model.phase {
                            tokio::time::timeout(Duration::from_secs(1), write_frame(&mut writer, &Request::Approve { candidate: candidate.clone() })).await??;
                            model.phase = Phase::Approved;
                    }
                }
                model.remaining = remaining(deadline);
                screen.draw(model)?;
                if Instant::now() > deadline + Duration::from_secs(2) {
                    model.phase = Phase::Expired;
                    screen.draw(model)?;
                    return Ok(PairExit::Expired);
                }
            }
            _ = terminate.recv() => return cancel(&mut writer, screen, model, PairExit::Terminated).await,
            _ = interrupt.recv() => return cancel(&mut writer, screen, model, PairExit::Interrupted).await,
        }
    }
}

fn remaining(deadline: Instant) -> u16 {
    let millis = deadline
        .saturating_duration_since(Instant::now())
        .as_millis();
    u16::try_from(millis.div_ceil(1000).min(60)).unwrap_or(0)
}

fn cancellation(code: KeyCode, modifiers: KeyModifiers) -> Option<PairExit> {
    match code {
        KeyCode::Char('c') if modifiers.contains(KeyModifiers::CONTROL) => {
            Some(PairExit::Interrupted)
        }
        KeyCode::Esc => Some(PairExit::Cancelled),
        _ => None,
    }
}

fn discard_early_keys() -> Result<Option<PairExit>> {
    let mut cancel = None;
    while event::poll(Duration::ZERO)? {
        if let Event::Key(key) = event::read()? {
            cancel = cancel.or(cancellation(key.code, key.modifiers));
        }
    }
    Ok(cancel)
}

async fn cancel(
    writer: &mut tokio::net::unix::OwnedWriteHalf,
    screen: &mut panel::Screen,
    model: &mut panel::Model,
    exit: PairExit,
) -> Result<PairExit> {
    let _ = tokio::time::timeout(
        Duration::from_secs(1),
        write_frame(writer, &Request::Cancel),
    )
    .await;
    model.phase = Phase::Cancelled;
    screen.draw(model)?;
    Ok(exit)
}

struct ReaderGuard(tokio::task::JoinHandle<()>);
impl Drop for ReaderGuard {
    fn drop(&mut self) {
        self.0.abort();
    }
}
