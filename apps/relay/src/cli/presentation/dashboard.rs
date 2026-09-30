use super::{PairExit, cancellation, pair_on_screen, panel};
use crate::cli::discovery;
use codewide_relay::{
    Result,
    admin::{Reply, Request, SOCKET, read_frame, write_frame},
    registry::RouteSummary,
};
use crossterm::event::{self, Event, KeyCode, KeyEvent, KeyEventKind, KeyModifiers};
use ratatui::{
    Frame,
    layout::{Constraint, Layout},
    style::{Modifier, Style},
    text::{Line, Span},
    widgets::{Paragraph, Wrap},
};
use std::{path::Path, process::ExitCode, time::Duration};
use tokio::{net::UnixStream, signal::unix::Signal};

struct Model {
    port: u16,
    routes: Vec<RouteSummary>,
    selection: usize,
    computers: bool,
    offset: usize,
    issue: Option<String>,
    notice: Option<String>,
    computer_mode: ComputerMode,
}

enum ComputerMode {
    Browse,
    Rename(String),
    ConfirmRevoke,
}

impl Model {
    fn update(&mut self, reply: Reply) -> Result<()> {
        match reply {
            Reply::Status { port, routes } => {
                self.port = port;
                self.routes = routes;
                self.offset = self.offset.min(self.routes.len().saturating_sub(1));
                self.issue = None;
                Ok(())
            }
            Reply::Error { message } => Err(message.into()),
            _ => Err("The Relay returned an incompatible status response".into()),
        }
    }

    async fn refresh(&mut self, state: &Path) {
        self.notice = None;
        let result = request(state, Request::Status)
            .await
            .and_then(|reply| self.update(reply));
        if let Err(error) = result {
            self.issue = Some(error.to_string());
        }
    }

    fn move_selection(&mut self, down: bool) {
        if self.computers {
            self.offset = if down {
                self.offset
                    .saturating_add(1)
                    .min(self.routes.len().saturating_sub(1))
            } else {
                self.offset.saturating_sub(1)
            };
        } else {
            self.selection = (self.selection + if down { 1 } else { 2 }) % 3;
        }
        self.notice = None;
    }

    fn selected_route(&self) -> Option<&RouteSummary> {
        self.routes.get(self.offset)
    }

    async fn rename_selected(&mut self, state: &Path, label: String) {
        let Some(route) = self.selected_route().map(|route| route.route_id.clone()) else {
            return;
        };
        let label = label.trim().to_owned();
        let result = request(state, Request::Rename { route, label }).await;
        match result {
            Ok(Reply::Renamed { updated: true }) => {
                self.refresh(state).await;
                self.notice = Some("Computer renamed.".into());
            }
            Ok(Reply::Renamed { updated: false }) => {
                self.refresh(state).await;
                self.issue = Some("That computer was already removed.".into());
            }
            Ok(Reply::Error { message }) => self.issue = Some(message),
            Ok(_) => self.issue = Some("The Relay returned an incompatible response".into()),
            Err(error) => self.issue = Some(error.to_string()),
        }
    }

    async fn revoke_selected(&mut self, state: &Path) {
        let Some(route) = self.selected_route().map(|route| route.route_id.clone()) else {
            return;
        };
        let result = request(state, Request::Revoke { route }).await;
        match result {
            Ok(Reply::Revoked { removed: true }) => {
                self.refresh(state).await;
                self.notice = Some("Computer access revoked.".into());
            }
            Ok(Reply::Revoked { removed: false }) => {
                self.refresh(state).await;
                self.issue = Some("That computer was already removed.".into());
            }
            Ok(Reply::Error { message }) => self.issue = Some(message),
            Ok(_) => self.issue = Some("The Relay returned an incompatible response".into()),
            Err(error) => self.issue = Some(error.to_string()),
        }
    }
}

async fn request(state: &Path, request: Request) -> Result<Reply> {
    tokio::time::timeout(Duration::from_secs(2), async {
        let mut socket = UnixStream::connect(state.join(SOCKET)).await?;
        write_frame(&mut socket, &request).await?;
        read_frame(&mut socket).await
    })
    .await?
}

pub async fn run(state: &Path, initial: Reply, address: Option<&str>) -> Result<ExitCode> {
    let mut model = Model {
        port: 0,
        routes: Vec::new(),
        selection: 0,
        computers: false,
        offset: 0,
        issue: None,
        notice: None,
        computer_mode: ComputerMode::Browse,
    };
    model.update(initial)?;
    // Signals must be owned before raw mode, including during address discovery.
    let mut terminate = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())?;
    let mut interrupt = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::interrupt())?;
    let mut screen = panel::Screen::open()?;
    let mut ticks = tokio::time::interval(Duration::from_millis(100));
    loop {
        screen.draw_with(|frame| render(frame, &model, console::colors_enabled_stderr()))?;
        tokio::select! {
            _ = terminate.recv() => return Ok(PairExit::Terminated.exit_code()),
            _ = interrupt.recv() => return Ok(PairExit::Interrupted.exit_code()),
            _ = ticks.tick() => {}
        }
        while event::poll(Duration::ZERO)? {
            let Event::Key(key) = event::read()? else {
                continue;
            };
            if key.kind != KeyEventKind::Press {
                continue;
            }
            if let Some(exit) = cancellation(key.code, key.modifiers) {
                if matches!(exit, PairExit::Interrupted) {
                    return Ok(exit.exit_code());
                }
                if model.computers {
                    if matches!(model.computer_mode, ComputerMode::Browse) {
                        model.computers = false;
                    } else {
                        model.computer_mode = ComputerMode::Browse;
                    }
                    continue;
                }
                return Ok(ExitCode::SUCCESS);
            }
            if model.computers {
                handle_computer_key(&mut model, state, &key).await;
                continue;
            }
            match key.code {
                KeyCode::Char('q') => return Ok(ExitCode::SUCCESS),
                KeyCode::Down | KeyCode::Tab | KeyCode::Char('j') => model.move_selection(true),
                KeyCode::Up | KeyCode::BackTab | KeyCode::Char('k') => model.move_selection(false),
                KeyCode::Char('r') => model.refresh(state).await,
                KeyCode::Enter if screen.can_confirm() && !model.computers => match model.selection
                {
                    0 => {
                        match connect(
                            state,
                            address,
                            model.port,
                            &mut screen,
                            &mut terminate,
                            &mut interrupt,
                        )
                        .await
                        {
                            Ok(Some(exit)) => return Ok(exit),
                            Ok(None) => model.refresh(state).await,
                            Err(error) => model.issue = Some(error.to_string()),
                        }
                    }
                    1 => {
                        model.refresh(state).await;
                        model.computers = true;
                        model.computer_mode = ComputerMode::Browse;
                    }
                    _ => return Ok(ExitCode::SUCCESS),
                },
                _ => {}
            }
        }
    }
}

async fn handle_computer_key(model: &mut Model, state: &Path, key: &KeyEvent) {
    if matches!(model.computer_mode, ComputerMode::Rename(_)) {
        match key.code {
            KeyCode::Enter => {
                let ComputerMode::Rename(label) =
                    std::mem::replace(&mut model.computer_mode, ComputerMode::Browse)
                else {
                    unreachable!()
                };
                model.rename_selected(state, label).await;
            }
            KeyCode::Backspace => {
                if let ComputerMode::Rename(label) = &mut model.computer_mode {
                    label.pop();
                }
            }
            KeyCode::Char(value) if !key.modifiers.contains(KeyModifiers::CONTROL) => {
                if let ComputerMode::Rename(label) = &mut model.computer_mode {
                    label.push(value);
                }
            }
            _ => {}
        }
        return;
    }
    if matches!(model.computer_mode, ComputerMode::ConfirmRevoke) {
        if matches!(key.code, KeyCode::Char('y' | 'Y')) {
            model.computer_mode = ComputerMode::Browse;
            model.revoke_selected(state).await;
        }
        return;
    }
    match key.code {
        KeyCode::Down | KeyCode::Tab | KeyCode::Char('j') => model.move_selection(true),
        KeyCode::Up | KeyCode::BackTab | KeyCode::Char('k') => model.move_selection(false),
        KeyCode::Char('r' | 'R') => model.refresh(state).await,
        KeyCode::Char('e' | 'E') if model.selected_route().is_some() => {
            let label = model
                .selected_route()
                .and_then(|route| route.label.clone())
                .unwrap_or_default();
            model.computer_mode = ComputerMode::Rename(label);
            model.issue = None;
            model.notice = None;
        }
        KeyCode::Char('d' | 'D') | KeyCode::Delete if model.selected_route().is_some() => {
            model.computer_mode = ComputerMode::ConfirmRevoke;
            model.issue = None;
            model.notice = None;
        }
        _ => {}
    }
}

async fn connect(
    state: &Path,
    address: Option<&str>,
    port: u16,
    screen: &mut panel::Screen,
    terminate: &mut Signal,
    interrupt: &mut Signal,
) -> Result<Option<ExitCode>> {
    let preparing = async {
        let endpoint = discovery::public_address(address, port).await?;
        let socket = UnixStream::connect(state.join(SOCKET)).await?;
        Ok::<_, codewide_relay::Error>((endpoint, socket))
    };
    let (endpoint, socket) = tokio::select! {
        _ = terminate.recv() => return Ok(Some(PairExit::Terminated.exit_code())),
        _ = interrupt.recv() => return Ok(Some(PairExit::Interrupted.exit_code())),
        prepared = preparing => prepared?,
    };
    match pair_on_screen(socket, &endpoint, screen, terminate, interrupt, true).await {
        Ok(exit @ (PairExit::Interrupted | PairExit::Terminated)) => Ok(Some(exit.exit_code())),
        Ok(PairExit::Cancelled) => Ok(None),
        _ => wait_for_back(terminate, interrupt).await,
    }
}

async fn wait_for_back(terminate: &mut Signal, interrupt: &mut Signal) -> Result<Option<ExitCode>> {
    let mut ticks = tokio::time::interval(Duration::from_millis(100));
    loop {
        tokio::select! {
            _ = terminate.recv() => return Ok(Some(PairExit::Terminated.exit_code())),
            _ = interrupt.recv() => return Ok(Some(PairExit::Interrupted.exit_code())),
            _ = ticks.tick() => {}
        }
        while event::poll(Duration::ZERO)? {
            let Event::Key(key) = event::read()? else {
                continue;
            };
            if key.kind != KeyEventKind::Press {
                continue;
            }
            match cancellation(key.code, key.modifiers) {
                Some(PairExit::Interrupted) => return Ok(Some(PairExit::Interrupted.exit_code())),
                Some(_) => return Ok(None),
                None if key.code == KeyCode::Enter => return Ok(None),
                _ => {}
            }
        }
    }
}

fn render(frame: &mut Frame<'_>, model: &Model, colors: bool) {
    if frame.area().width < panel::MIN_WIDTH || frame.area().height < panel::HEIGHT {
        frame.render_widget(
            Paragraph::new("Enlarge the terminal to use Relay.\nEnter is disabled. Esc exits.")
                .wrap(Wrap { trim: false }),
            frame.area(),
        );
        return;
    }
    let inner = panel::surface(frame, colors);
    let rows = Layout::vertical([
        Constraint::Length(1),
        Constraint::Length(1),
        Constraint::Length(1),
        Constraint::Length(1),
        Constraint::Length(7),
        Constraint::Min(1),
        Constraint::Length(1),
    ])
    .split(inner);
    frame.render_widget(
        Paragraph::new(Line::from(vec![
            Span::styled(
                "CodeWide Relay",
                Style::default().add_modifier(Modifier::BOLD),
            ),
            Span::styled(
                if model.computers {
                    "  / Paired computers"
                } else {
                    "  / Home"
                },
                panel::themed(panel::SECONDARY, colors),
            ),
        ])),
        rows[0],
    );
    let status = if model.issue.is_some() {
        "Needs attention"
    } else {
        "Running"
    };
    frame.render_widget(
        Paragraph::new(format!(
            "{status}  ·  Port {}  ·  {} paired",
            model.port,
            model.routes.len()
        ))
        .style(panel::themed(panel::SECONDARY, colors)),
        rows[2],
    );
    if model.computers {
        computers(frame, model, rows[4], colors);
    } else {
        let options = [
            "Connect a computer".to_owned(),
            format!("Paired computers ({})", model.routes.len()),
            "Exit".to_owned(),
        ];
        let mut lines = Vec::new();
        for (index, label) in options.into_iter().enumerate() {
            let selected = index == model.selection;
            let style = if selected {
                panel::themed(panel::ACCENT, colors).add_modifier(Modifier::BOLD)
            } else {
                Style::default()
            };
            lines.push(Line::styled(
                format!("{} {label}", if selected { "›" } else { " " }),
                style,
            ));
            lines.push(Line::from(""));
        }
        frame.render_widget(Paragraph::new(lines), rows[4]);
    }
    frame.render_widget(
        Paragraph::new(detail(model))
            .wrap(Wrap { trim: false })
            .style(panel::themed(panel::SECONDARY, colors)),
        rows[5],
    );
    frame.render_widget(
        Paragraph::new(footer(model)).style(panel::themed(panel::SECONDARY, colors)),
        rows[6],
    );
}

fn detail(model: &Model) -> String {
    if let Some(issue) = &model.issue {
        return issue.clone();
    }
    if !model.computers {
        return "Connect securely in 60 seconds. No keys to copy.".into();
    }
    match &model.computer_mode {
        ComputerMode::Rename(label) => format!("New name: {label}_"),
        ComputerMode::ConfirmRevoke => format!(
            "Revoke {}? This disconnects it now.",
            model
                .selected_route()
                .and_then(|route| route.label.as_deref())
                .unwrap_or("this computer")
        ),
        ComputerMode::Browse => model
            .notice
            .clone()
            .unwrap_or_else(|| "Create, rename, or revoke paired computers here.".into()),
    }
}

fn footer(model: &Model) -> &'static str {
    if !model.computers {
        return "↑↓ Choose  Enter Open  R ↻  Esc Exit";
    }
    match &model.computer_mode {
        ComputerMode::Browse => "↑↓ Pick  E Edit  D Revoke  Esc Back",
        ComputerMode::Rename(_) => "Type name  Enter Save  Esc Cancel",
        ComputerMode::ConfirmRevoke => "Y Revoke  Esc Cancel",
    }
}

fn computers(frame: &mut Frame<'_>, model: &Model, area: ratatui::layout::Rect, colors: bool) {
    let lines = if model.routes.is_empty() {
        vec![
            Line::from("No computers paired yet."),
            Line::from(""),
            Line::from("Go back and choose Connect a computer."),
        ]
    } else {
        model
            .routes
            .iter()
            .enumerate()
            .skip(model.offset)
            .take(3)
            .flat_map(|(index, route)| {
                let selected = index == model.offset;
                [
                    Line::styled(
                        format!(
                            "{} {}",
                            if selected { "›" } else { " " },
                            route.label.as_deref().unwrap_or("Unnamed computer")
                        ),
                        if selected {
                            panel::themed(panel::ACCENT, colors).add_modifier(Modifier::BOLD)
                        } else {
                            Style::default().add_modifier(Modifier::BOLD)
                        },
                    ),
                    Line::styled(
                        format!("  {}", route.route_id.get(..8).unwrap_or(&route.route_id)),
                        panel::themed(panel::SECONDARY, colors),
                    ),
                ]
            })
            .collect()
    };
    frame.render_widget(Paragraph::new(lines), area);
}

#[cfg(test)]
pub(super) fn preview(frame: &mut Frame<'_>, computers: bool) {
    render(
        frame,
        &Model {
            port: 8780,
            routes: vec![RouteSummary {
                route_id: "0123456789abcdef".into(),
                label: Some("MacBook Pro".into()),
            }],
            selection: 0,
            computers,
            offset: 0,
            issue: None,
            notice: None,
            computer_mode: ComputerMode::Browse,
        },
        true,
    );
}
