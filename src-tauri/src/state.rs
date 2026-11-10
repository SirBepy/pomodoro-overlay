pub(crate) struct PausedSessionsState(pub(crate) std::sync::Mutex<Vec<String>>);
pub(crate) struct DndState(pub(crate) std::sync::Mutex<Option<Vec<u8>>>);

/// `Some(prev_visible)` while suppression is applied (a connected widget host owns
/// the compact surface AND `hide_when_widget_hosted` is on), holding the overlay's
/// visibility from just before so lifting it puts the overlay back as the user left it.
pub(crate) struct HostSuppressionState(pub(crate) std::sync::Mutex<Option<bool>>);

/// Mirrors the frontend's fullscreen mode. Compact and fullscreen are two modes
/// of the one `main` window, and suppression may only ever gate the compact one.
pub(crate) struct FullscreenState(pub(crate) std::sync::Mutex<bool>);

/// True while the overlay's bar form (an edge strip) is the `main` window's shape.
pub(crate) struct BarState(pub(crate) std::sync::Mutex<bool>);

/// What the widget host last asked for via `host_overlay`. Whether that hides the
/// overlay also depends on the `hide_when_widget_hosted` setting (see bridge.rs).
pub(crate) struct HostWantsState(pub(crate) std::sync::Mutex<bool>);

/// Box geometry from just before the bar took over. Outlives the bar's own flag
/// only within one call, never across them.
pub(crate) struct SavedGeometry {
    pub(crate) x: i32,
    pub(crate) y: i32,
    pub(crate) w: u32,
    pub(crate) h: u32,
    /// Top-left of the monitor the corner window was on.
    pub(crate) monitor: Option<(i32, i32)>,
    /// Top-left the bar was last placed at, to tell a user drag from the bar's
    /// own moves.
    pub(crate) placed: (i32, i32),
}

pub(crate) struct BarSavedGeometry(pub(crate) std::sync::Mutex<Option<SavedGeometry>>);
