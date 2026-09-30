use codewide_relay::{Result, enrollment::Phase};
use ratatui::{
    Frame, Terminal, TerminalOptions, Viewport,
    backend::CrosstermBackend,
    layout::{Constraint, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, BorderType, Borders, Gauge, Padding, Paragraph, Wrap},
};
use std::io::{Stderr, stderr};

pub(super) const HEIGHT: u16 = 16;
pub(super) const MIN_WIDTH: u16 = 44;
pub(super) const ACCENT: Color = Color::Rgb(88, 120, 255);
const WHITE: Color = Color::Rgb(244, 244, 245);
const BACKGROUND: Color = Color::Rgb(15, 15, 16);
pub(super) const SECONDARY: Color = Color::Rgb(176, 178, 188);
const BORDER: Color = Color::Rgb(96, 98, 109);

pub struct Model {
    pub endpoint: String,
    pub phase: Phase,
    pub remaining: u16,
    pub failure: Option<String>,
    pub menu: bool,
}

pub struct Screen {
    terminal: Terminal<CrosstermBackend<Stderr>>,
    can_confirm: bool,
    bottom: u16,
}

impl Screen {
    pub fn open() -> Result<Self> {
        if std::env::var("TERM").is_ok_and(|value| value == "dumb") {
            return Err("The Relay menu needs a terminal with cursor support; use status for plain-text output.".into());
        }
        let (width, height) = crossterm::terminal::size()?;
        if width < MIN_WIDTH || height < HEIGHT {
            return Err(format!("Make the terminal at least {MIN_WIDTH} columns × {HEIGHT} rows, then open Relay again.").into());
        }
        crossterm::terminal::enable_raw_mode()?;
        match Terminal::with_options(
            CrosstermBackend::new(stderr()),
            TerminalOptions {
                viewport: Viewport::Inline(HEIGHT),
            },
        ) {
            Ok(terminal) => Ok(Self {
                terminal,
                can_confirm: true,
                bottom: 0,
            }),
            Err(error) => {
                let _ = crossterm::terminal::disable_raw_mode();
                Err(error.into())
            }
        }
    }

    pub fn can_confirm(&self) -> bool {
        self.can_confirm
            && crossterm::terminal::size()
                .is_ok_and(|(width, height)| width >= MIN_WIDTH && height >= HEIGHT)
    }

    pub fn draw(&mut self, model: &Model) -> Result<()> {
        let colors = console::colors_enabled_stderr();
        self.draw_with(|frame| render(frame, model, colors))
    }

    pub fn draw_with(&mut self, render: impl FnOnce(&mut Frame<'_>)) -> Result<()> {
        let frame = self.terminal.draw(render)?;
        let area = frame.buffer.area;
        self.can_confirm = area.width >= MIN_WIDTH && area.height >= HEIGHT;
        self.bottom = area.bottom().saturating_sub(1);
        Ok(())
    }
}

impl Drop for Screen {
    fn drop(&mut self) {
        let _ = self.terminal.show_cursor();
        let _ = crossterm::execute!(
            stderr(),
            crossterm::style::ResetColor,
            crossterm::cursor::MoveTo(0, self.bottom),
            crossterm::cursor::MoveToNextLine(1)
        );
        let _ = crossterm::terminal::disable_raw_mode();
    }
}

pub(super) fn themed(color: Color, enabled: bool) -> Style {
    if enabled {
        Style::default().fg(color)
    } else {
        Style::default()
    }
}

pub(super) fn surface(frame: &mut Frame<'_>, colors: bool) -> Rect {
    let full = frame.area();
    let area = Rect {
        width: full.width.min(78),
        ..full
    };
    let base = if colors {
        Style::default().fg(WHITE).bg(BACKGROUND)
    } else {
        Style::default()
    };
    let block = Block::default()
        .borders(Borders::ALL)
        .border_type(BorderType::Rounded)
        .border_style(themed(BORDER, colors))
        .style(base)
        .padding(Padding::horizontal(2));
    let inner = block.inner(area);
    frame.render_widget(block, area);
    inner
}

pub fn render(frame: &mut Frame<'_>, model: &Model, colors: bool) {
    let full = frame.area();
    if full.width < MIN_WIDTH || full.height < HEIGHT {
        frame.render_widget(Paragraph::new("Terminal too small. Enlarge it to see the symbols.\nEnter is disabled. Esc cancels pairing.").wrap(Wrap { trim: false }), full);
        return;
    }
    let inner = surface(frame, colors);
    let rows = Layout::vertical([
        Constraint::Length(1),
        Constraint::Length(1),
        Constraint::Length(1),
        Constraint::Length(2),
        Constraint::Length(1),
        Constraint::Length(2),
        Constraint::Length(1),
        Constraint::Length(1),
        Constraint::Length(1),
        Constraint::Min(1),
    ])
    .split(inner);
    frame.render_widget(
        Paragraph::new(Line::from(vec![
            Span::styled(
                "CodeWide Relay",
                Style::default().add_modifier(Modifier::BOLD),
            ),
            Span::styled("  / Pair a computer", themed(SECONDARY, colors)),
        ])),
        rows[0],
    );
    let (heading, primary, detail, footer, tone) = text(model);
    frame.render_widget(Paragraph::new(heading).style(themed(tone, colors)), rows[2]);
    frame.render_widget(
        Paragraph::new(primary)
            .style(Style::default().add_modifier(Modifier::BOLD))
            .wrap(Wrap { trim: false }),
        rows[3],
    );
    frame.render_widget(
        Paragraph::new(detail)
            .style(themed(SECONDARY, colors))
            .wrap(Wrap { trim: false }),
        rows[5],
    );
    if model.failure.is_some() {
        frame.render_widget(
            Paragraph::new(if model.menu {
                "Return to Relay to try again"
            } else {
                "Run pair again to reconnect"
            }),
            rows[8],
        );
    } else if model.phase.finished() {
        frame.render_widget(
            Paragraph::new(match model.phase {
                Phase::Connected { .. } => "Access saved · discovery closed",
                Phase::Expired => "No new access was saved",
                _ => "Discovery closed",
            })
            .style(themed(tone, colors)),
            rows[7],
        );
    } else {
        let label = format!(
            "{:02}:{:02} remaining",
            model.remaining / 60,
            model.remaining % 60
        );
        frame.render_widget(
            Gauge::default()
                .gauge_style(themed(ACCENT, colors))
                .ratio(f64::from(model.remaining.min(60)) / 60.0)
                .label(label),
            rows[7],
        );
    }
    let footer = if model.menu && (model.phase.finished() || model.failure.is_some()) {
        "Enter  Back to Relay    Esc  Back"
    } else {
        footer
    };
    frame.render_widget(
        Paragraph::new(footer)
            .style(themed(SECONDARY, colors))
            .wrap(Wrap { trim: false }),
        rows[9],
    );
}

fn text(model: &Model) -> (&str, &str, String, &str, Color) {
    if let Some(message) = &model.failure {
        return (
            "Pairing failed",
            "Connection interrupted",
            message.clone(),
            "codewide-relay pair  Try again",
            Color::Rgb(233, 193, 108),
        );
    }
    match &model.phase {
        Phase::Waiting => (
            "Visible for pairing",
            &model.endpoint,
            "In CodeWide, choose Add Relay and enter this address.".into(),
            "Esc  Cancel    Ctrl+C  Cancel",
            ACCENT,
        ),
        Phase::Confirm { label, code, .. } => (
            "Same symbols on your Mac?",
            code,
            format!("{label}\nIf they match, press Enter to connect."),
            "Enter  Connect    Esc  Reject",
            ACCENT,
        ),
        Phase::Approved => (
            "Computer approved",
            &model.endpoint,
            "CodeWide is saving access and opening its secure connection.".into(),
            "Esc  Cancel    Ctrl+C  Cancel",
            ACCENT,
        ),
        Phase::Connecting { label } => (
            "Secure connection",
            label,
            "CodeWide has saved access. Confirming its connection.".into(),
            "Esc  Cancel    Ctrl+C  Cancel",
            ACCENT,
        ),
        Phase::Connected { label, .. } => (
            "Connected successfully",
            label,
            "Your computer is ready to use this Relay.".into(),
            "codewide-relay status  Show paired computers",
            Color::Rgb(131, 219, 160),
        ),
        Phase::Expired => (
            "Pairing window closed",
            "Time is up",
            "No computer was connected within one minute.".into(),
            "codewide-relay pair  Try again",
            Color::Rgb(233, 193, 108),
        ),
        Phase::Cancelled => (
            "Pairing cancelled",
            "Window closed",
            "The incomplete pairing has been cancelled.".into(),
            "codewide-relay pair  Try again",
            SECONDARY,
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ratatui::backend::TestBackend;
    use std::fmt::Write as _;

    #[test]
    fn narrow_terminal_keeps_the_code_and_action_visible_without_color() -> Result<()> {
        let mut terminal = Terminal::new(TestBackend::new(44, HEIGHT))?;
        let model = Model {
            menu: false,
            endpoint: "[2001:db8::1]:8780".into(),
            remaining: 9,
            failure: None,
            phase: Phase::Confirm {
                candidate: "test".into(),
                label: "MacBook".into(),
                code: "🍋  🚀  🐳  🎸\nLemon · Rocket · Whale · Guitar".into(),
            },
        };
        terminal.draw(|frame| render(frame, &model, false))?;
        let text = terminal
            .backend()
            .buffer()
            .content()
            .iter()
            .map(ratatui::buffer::Cell::symbol)
            .collect::<String>();
        assert!(text.contains("Lemon · Rocket · Whale · Guitar"));
        assert!(text.contains("Enter  Connect"));
        assert!(text.contains("00:09 remaining"));
        Ok(())
    }

    #[test]
    fn terminal_smaller_than_the_contract_disables_confirmation_visually() -> Result<()> {
        let mut terminal = Terminal::new(TestBackend::new(35, HEIGHT))?;
        let model = Model {
            menu: false,
            endpoint: "host:8780".into(),
            remaining: 60,
            phase: Phase::Waiting,
            failure: None,
        };
        terminal.draw(|frame| render(frame, &model, true))?;
        let text = terminal
            .backend()
            .buffer()
            .content()
            .iter()
            .map(ratatui::buffer::Cell::symbol)
            .collect::<String>();
        assert!(text.contains("Enter is disabled"));
        Ok(())
    }

    #[test]
    fn dashboard_actions_and_saved_computers_are_visible() -> Result<()> {
        for (name, computers) in [("home", false), ("computers", true)] {
            let mut terminal = Terminal::new(TestBackend::new(78, HEIGHT))?;
            terminal.draw(|frame| super::super::dashboard::preview(frame, computers))?;
            if let Some(root) = std::env::var_os("CODEWIDE_RELAY_RENDER_DIR") {
                std::fs::write(
                    std::path::Path::new(&root).join(format!("relay-panel-{name}.svg")),
                    svg(terminal.backend().buffer())?,
                )?;
            }
            let mut narrow = Terminal::new(TestBackend::new(44, HEIGHT))?;
            narrow.draw(|frame| super::super::dashboard::preview(frame, computers))?;
            let text = narrow
                .backend()
                .buffer()
                .content()
                .iter()
                .map(ratatui::buffer::Cell::symbol)
                .collect::<String>();
            assert!(text.contains(if computers {
                "MacBook Pro"
            } else {
                "Connect a computer"
            }));
            assert!(text.contains(if computers { "Esc Back" } else { "Esc Exit" }));
        }
        Ok(())
    }

    #[test]
    fn render_pairing_states() -> Result<()> {
        let states = [
            ("waiting", Phase::Waiting, 48),
            (
                "confirm",
                Phase::Confirm {
                    candidate: "test".into(),
                    label: "MacBook Pro".into(),
                    code: "🍋  🚀  🐳  🎸\nLemon · Rocket · Whale · Guitar".into(),
                },
                35,
            ),
            (
                "success",
                Phase::Connected {
                    label: "MacBook Pro".into(),
                    route_id: "test".into(),
                },
                0,
            ),
            ("expired", Phase::Expired, 0),
        ];
        for (name, phase, remaining) in states {
            let mut terminal = Terminal::new(TestBackend::new(78, HEIGHT))?;
            let model = Model {
                menu: true,
                endpoint: "203.0.113.42:8780".into(),
                phase,
                remaining,
                failure: None,
            };
            terminal.draw(|frame| render(frame, &model, true))?;
            if let Some(root) = std::env::var_os("CODEWIDE_RELAY_RENDER_DIR") {
                std::fs::write(
                    std::path::Path::new(&root).join(format!("relay-panel-{name}.svg")),
                    svg(terminal.backend().buffer())?,
                )?;
            }
        }
        Ok(())
    }

    fn svg(buffer: &ratatui::buffer::Buffer) -> Result<String> {
        let mut result = String::from(
            "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"702\" height=\"304\" viewBox=\"0 0 702 304\"><rect width=\"100%\" height=\"100%\" fill=\"#0f0f10\"/><g font-family=\"Menlo,monospace\" font-size=\"14\">",
        );
        let mut foreground = String::new();
        for (index, cell) in buffer.content().iter().enumerate() {
            let x = index % 78 * 9;
            let y = index / 78 * 19;
            if let Color::Rgb(red, green, blue) = cell.bg {
                write!(
                    result,
                    "<rect x=\"{x}\" y=\"{y}\" width=\"9\" height=\"19\" fill=\"#{red:02x}{green:02x}{blue:02x}\"/>"
                )?;
            }
            let fill = match cell.fg {
                Color::Rgb(red, green, blue) => format!("#{red:02x}{green:02x}{blue:02x}"),
                _ => "#f4f4f5".into(),
            };
            let weight = if cell.modifier.contains(Modifier::BOLD) {
                700
            } else {
                400
            };
            let symbol = cell
                .symbol()
                .replace('&', "&amp;")
                .replace('<', "&lt;")
                .replace('>', "&gt;");
            write!(
                foreground,
                "<text x=\"{x}\" y=\"{}\" fill=\"{fill}\" font-weight=\"{weight}\">{symbol}</text>",
                y + 14
            )?;
        }
        result.push_str(&foreground);
        result.push_str("</g></svg>");
        Ok(result)
    }
}
