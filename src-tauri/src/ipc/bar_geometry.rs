//! Pure bar geometry: where the bar sits on a monitor's work area, where a drop
//! snaps to, which monitor is picked. No window or app handle, so it is unit-tested.
/// Floor for a top/bottom bar, in physical px, so tiny work areas stay legible.
pub(crate) const MIN_BAR_THICKNESS: u32 = 64;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub w: u32,
    pub h: u32,
}

/// Bar rect inside a monitor's work area (never the taskbar).
/// Top/bottom: full width, thickness a share of the work-area height.
/// Left/right: full height, narrow (sized for the horizontal time text).
/// `scale` converts the logical side widths. Unknown values fall back to top / medium.
pub fn bar_rect(work: Rect, scale: f64, edge: &str, size: &str) -> Rect {
    let pct = match size {
        "small" => 10,
        "large" => 18,
        _ => 14,
    };
    let thick = (work.h * pct / 100).max(MIN_BAR_THICKNESS);
    let side_w = ((match size {
        "small" => 112.0,
        "large" => 148.0,
        _ => 128.0,
    }) * scale)
        .round() as u32;
    let side_w = side_w.min(work.w);
    match edge {
        "bottom" => Rect { x: work.x, y: work.y + work.h as i32 - thick as i32, w: work.w, h: thick },
        "left" => Rect { x: work.x, y: work.y, w: side_w, h: work.h },
        "right" => Rect { x: work.x + work.w as i32 - side_w as i32, y: work.y, w: side_w, h: work.h },
        _ => Rect { x: work.x, y: work.y, w: work.w, h: thick },
    }
}

/// Where a dropped bar settles: the nearest edge, each distance normalised by the
/// work-area side it is measured along so a wide monitor does not favour top/bottom.
pub fn snap_target(drop: (f64, f64), work: Rect) -> &'static str {
    let (w, h) = (work.w as f64, work.h as f64);
    let (dx, dy) = (drop.0 - work.x as f64, drop.1 - work.y as f64);
    let candidates = [
        ("left", dx / w),
        ("right", (w - dx) / w),
        ("top", dy / h),
        ("bottom", (h - dy) / h),
    ];
    candidates
        .iter()
        .min_by(|a, b| a.1.total_cmp(&b.1))
        .map(|c| c.0)
        .unwrap_or("top")
}

pub(crate) type MonitorKey = (i32, i32);

/// Picks the monitor (by top-left position) the bar lands on. Resolved at every
/// placement so an unplugged monitor cannot strand it. `secondary` is the first
/// monitor that is not the primary; with none it falls back to the overlay's.
pub fn resolve_monitor(
    mode: &str,
    monitors: &[MonitorKey],
    primary: Option<MonitorKey>,
    current: Option<MonitorKey>,
) -> Option<MonitorKey> {
    // The overlay's monitor was recorded earlier; it may have been unplugged since.
    let live = |k: Option<MonitorKey>| k.filter(|k| monitors.contains(k));
    let (primary, current) = (live(primary), live(current));
    let picked = match mode {
        "primary" => primary.or(current),
        "secondary" => monitors
            .iter()
            .copied()
            .find(|m| Some(*m) != primary)
            .or(current),
        _ => current.or(primary),
    };
    picked.or_else(|| monitors.first().copied())
}

#[cfg(test)]
#[path = "bar_geometry_tests.rs"]
mod tests;
