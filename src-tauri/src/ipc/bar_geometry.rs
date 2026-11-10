//! Pure bar geometry: where the bar sits on a monitor's work area, where a drop
//! snaps to, which monitor is picked. No window or app handle, so it is unit-tested.
/// Bar thickness bounds in logical px. The bar's content is a fixed size, so these
/// are what keeps it from ever being a slab, whatever the monitor's size or scale.
/// Top/bottom bars hold one row of controls; side bars must fit the horizontal time.
pub(crate) const THICKNESS_RANGE: (u32, u32) = (36, 96);
pub(crate) const SIDE_THICKNESS_RANGE: (u32, u32) = (96, 160);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub w: u32,
    pub h: u32,
}

pub(crate) fn is_side_edge(edge: &str) -> bool {
    edge == "left" || edge == "right"
}

fn thickness_range(edge: &str) -> (u32, u32) {
    if is_side_edge(edge) {
        SIDE_THICKNESS_RANGE
    } else {
        THICKNESS_RANGE
    }
}

/// Logical thickness of the bar: the user's hand-resized value (`custom`, 0 when
/// unset) or the size preset, clamped to the edge's range. Unknown sizes are medium.
pub fn bar_thickness(edge: &str, size: &str, custom: u32) -> u32 {
    let preset = match (is_side_edge(edge), size) {
        (false, "small") => 44,
        (false, "large") => 72,
        (false, _) => 56,
        (true, "small") => 104,
        (true, "large") => 136,
        (true, _) => 120,
    };
    let (min, max) = thickness_range(edge);
    (if custom > 0 { custom } else { preset }).clamp(min, max)
}

/// Inverse of the placement: the logical thickness a hand-resized bar window has,
/// from its extent (px) across the thin axis, clamped like `bar_thickness`.
pub fn thickness_from_extent(edge: &str, extent_px: u32, scale: f64) -> u32 {
    let (min, max) = thickness_range(edge);
    ((extent_px as f64 / scale).round() as u32).clamp(min, max)
}

/// Bar rect inside a monitor's work area (never the taskbar), in physical px.
/// Top/bottom: full width; left/right: full height. The thin side is
/// `bar_thickness` logical px times `scale`; the work area is physical, the
/// thickness is not, so the scale must be applied or a 150% monitor gets a bar
/// that is too thin. Unknown values fall back to top / medium.
pub fn bar_rect(work: Rect, scale: f64, edge: &str, size: &str, custom: u32) -> Rect {
    let px = ((bar_thickness(edge, size, custom) as f64) * scale).round() as u32;
    let thick = px.min(work.h);
    let side_w = px.min(work.w);
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
