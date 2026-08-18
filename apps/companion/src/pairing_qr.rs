use std::fmt::Write as _;

use qrcode::{Color, EcLevel, QrCode};

const QUIET_ZONE_MODULES: usize = 4;

#[derive(Debug)]
struct Matrix {
    modules: Vec<bool>,
    width: usize,
}

impl Matrix {
    fn encode(value: &str) -> Result<Self, String> {
        let code = QrCode::with_error_correction_level(value.as_bytes(), EcLevel::Q)
            .map_err(|error| format!("cannot encode pairing QR: {error}"))?;
        Ok(Self {
            modules: code
                .to_colors()
                .into_iter()
                .map(|color| color == Color::Dark)
                .collect(),
            width: code.width(),
        })
    }

    fn total_width(&self) -> usize {
        self.width + QUIET_ZONE_MODULES * 2
    }

    fn is_dark(&self, x: usize, y: usize) -> bool {
        if x < QUIET_ZONE_MODULES
            || y < QUIET_ZONE_MODULES
            || x >= self.width + QUIET_ZONE_MODULES
            || y >= self.width + QUIET_ZONE_MODULES
        {
            return false;
        }
        let module_x = x - QUIET_ZONE_MODULES;
        let module_y = y - QUIET_ZONE_MODULES;
        self.modules[module_y * self.width + module_x]
    }
}

/// Number of terminal columns used by the compact half-block renderer.
///
/// # Errors
///
/// Returns an error when the pairing value does not fit in a QR symbol.
pub fn unicode_width(value: &str) -> Result<usize, String> {
    Ok(Matrix::encode(value)?.total_width())
}

/// Number of terminal columns used by the ASCII/ANSI background renderer.
///
/// # Errors
///
/// Returns an error when the pairing value does not fit in a QR symbol.
pub fn ansi_width(value: &str) -> Result<usize, String> {
    Ok(Matrix::encode(value)?.total_width() * 2)
}

/// Renders two QR module rows per terminal cell. Explicit black foreground on
/// a white background keeps the symbol polarity independent of terminal theme.
///
/// # Errors
///
/// Returns an error when the pairing value does not fit in a QR symbol.
pub fn render_unicode(value: &str) -> Result<String, String> {
    let matrix = Matrix::encode(value)?;
    let size = matrix.total_width();
    let mut output = String::with_capacity(size * size * 2);
    for y in (0..size).step_by(2) {
        output.push_str("\u{1b}[47;30m");
        for x in 0..size {
            let top = matrix.is_dark(x, y);
            let bottom = y + 1 < size && matrix.is_dark(x, y + 1);
            output.push(match (top, bottom) {
                (true, true) => '█',
                (true, false) => '▀',
                (false, true) => '▄',
                (false, false) => ' ',
            });
        }
        output.push_str("\u{1b}[0m\n");
    }
    Ok(output)
}

/// Renders square modules using only spaces and the standard ANSI black/white
/// background colors. This is wider, but does not require block glyphs.
///
/// # Errors
///
/// Returns an error when the pairing value does not fit in a QR symbol.
pub fn render_ansi(value: &str) -> Result<String, String> {
    let matrix = Matrix::encode(value)?;
    let size = matrix.total_width();
    let mut output = String::with_capacity(size * size * 4);
    for y in 0..size {
        let mut current = None;
        for x in 0..size {
            let dark = matrix.is_dark(x, y);
            if current != Some(dark) {
                output.push_str(if dark { "\u{1b}[40m" } else { "\u{1b}[47m" });
                current = Some(dark);
            }
            output.push_str("  ");
        }
        output.push_str("\u{1b}[0m\n");
    }
    Ok(output)
}

/// Produces a self-contained vector fallback without embedding the pairing
/// secret as text or metadata. The four-module quiet zone is part of viewBox.
///
/// # Errors
///
/// Returns an error when the pairing value does not fit in a QR symbol.
pub fn render_svg(value: &str) -> Result<String, String> {
    let matrix = Matrix::encode(value)?;
    let size = matrix.total_width();
    let mut path = String::new();
    for y in 0..size {
        for x in 0..size {
            if matrix.is_dark(x, y) {
                let _ = write!(path, "M{x},{y}h1v1h-1z");
            }
        }
    }
    Ok(format!(
        concat!(
            "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"768\" height=\"768\" ",
            "viewBox=\"0 0 {size} {size}\" shape-rendering=\"crispEdges\">",
            "<rect width=\"{size}\" height=\"{size}\" fill=\"#fff\"/>",
            "<path d=\"{path}\" fill=\"#000\"/></svg>\n"
        ),
        size = size,
        path = path,
    ))
}

#[cfg(test)]
fn render_luma(value: &str, module_size: usize) -> Result<(usize, Vec<u8>), String> {
    let matrix = Matrix::encode(value)?;
    let modules = matrix.total_width();
    let size = modules * module_size;
    let mut pixels = vec![255_u8; size * size];
    for module_y in 0..modules {
        for module_x in 0..modules {
            if !matrix.is_dark(module_x, module_y) {
                continue;
            }
            for pixel_y in module_y * module_size..(module_y + 1) * module_size {
                for pixel_x in module_x * module_size..(module_x + 1) * module_size {
                    pixels[pixel_y * size + pixel_x] = 0;
                }
            }
        }
    }
    Ok((size, pixels))
}

#[cfg(test)]
fn unicode_luma(value: &str, module_size: usize) -> Result<(usize, usize, Vec<u8>), String> {
    let rendered = render_unicode(value)?;
    let rows = rendered
        .lines()
        .map(|line| {
            line.strip_prefix("\u{1b}[47;30m")
                .and_then(|line| line.strip_suffix("\u{1b}[0m"))
                .ok_or_else(|| "invalid Unicode QR line".to_owned())
        })
        .collect::<Result<Vec<_>, _>>()?;
    let module_width = rows
        .first()
        .map(|line| line.chars().count())
        .ok_or_else(|| "empty Unicode QR".to_owned())?;
    if rows.iter().any(|line| line.chars().count() != module_width) {
        return Err("inconsistent Unicode QR width".to_owned());
    }
    let module_height = rows.len() * 2;
    let width = module_width * module_size;
    let height = module_height * module_size;
    let mut pixels = vec![255_u8; width * height];
    for (cell_y, row) in rows.iter().enumerate() {
        for (module_x, cell) in row.chars().enumerate() {
            let (top, bottom) = match cell {
                '█' => (true, true),
                '▀' => (true, false),
                '▄' => (false, true),
                ' ' => (false, false),
                _ => return Err("invalid Unicode QR cell".to_owned()),
            };
            for (row_offset, dark) in [top, bottom].into_iter().enumerate() {
                if !dark {
                    continue;
                }
                let module_y = cell_y * 2 + row_offset;
                for pixel_y in module_y * module_size..(module_y + 1) * module_size {
                    for pixel_x in module_x * module_size..(module_x + 1) * module_size {
                        pixels[pixel_y * width + pixel_x] = 0;
                    }
                }
            }
        }
    }
    Ok((width, height, pixels))
}

#[cfg(test)]
mod tests {
    use super::*;

    const PAIRING_LINK: &str = concat!(
        "codewide://pair?v=1&e=wss%3A%2F%2Fhost.example%2Fv1%2Fsync",
        "&t=Q1zVhTF2a4BqJR7gG0p4XKlr5lymRuYOIx6dLfiF5kM",
        "&x=1787068800000&n=Home+workstation&i=%F0%9F%8F%A0",
        "&p=sha256%2F9JQBDlN4VhJ9CmhGKBYd3PcqE4eVZl4hWlKlQpWgqdU%3D"
    );

    #[test]
    fn renders_compact_unicode_and_ascii_ansi_fallbacks() -> Result<(), Box<dyn std::error::Error>>
    {
        let unicode = render_unicode(PAIRING_LINK)?;
        assert!(unicode.contains('▀') || unicode.contains('▄') || unicode.contains('█'));
        assert!(unicode.contains("\u{1b}[47;30m"));
        let ansi = render_ansi(PAIRING_LINK)?;
        assert!(ansi.is_ascii());
        assert!(ansi.contains("\u{1b}[40m"));
        assert!(ansi.contains("\u{1b}[47m"));
        assert!(ansi_width(PAIRING_LINK)? > unicode_width(PAIRING_LINK)?);
        Ok(())
    }

    #[test]
    fn svg_fallback_contains_a_quiet_zone_and_no_raw_secret()
    -> Result<(), Box<dyn std::error::Error>> {
        let svg = render_svg(PAIRING_LINK)?;
        assert!(svg.starts_with("<svg "));
        assert!(svg.contains("shape-rendering=\"crispEdges\""));
        assert!(svg.contains("fill=\"#fff\""));
        assert!(!svg.contains("Q1zVhTF2"));
        Ok(())
    }

    #[test]
    fn generated_symbol_decodes_to_the_exact_pairing_link() -> Result<(), Box<dyn std::error::Error>>
    {
        let (size, pixels) = render_luma(PAIRING_LINK, 8)?;
        let mut decoder = quircs::Quirc::default();
        let mut codes = decoder.identify(size, size, &pixels);
        let code = codes.next().ok_or("missing QR code")??;
        let payload = code.decode()?;
        assert_eq!(payload.payload, PAIRING_LINK.as_bytes());
        assert!(codes.next().is_none());
        Ok(())
    }

    #[test]
    fn terminal_unicode_decodes_to_the_exact_pairing_link() -> Result<(), Box<dyn std::error::Error>>
    {
        let (width, height, pixels) = unicode_luma(PAIRING_LINK, 8)?;
        let mut decoder = quircs::Quirc::default();
        let mut codes = decoder.identify(width, height, &pixels);
        let code = codes.next().ok_or("missing terminal QR code")??;
        let payload = code.decode()?;
        assert_eq!(payload.payload, PAIRING_LINK.as_bytes());
        assert!(codes.next().is_none());
        Ok(())
    }
}
