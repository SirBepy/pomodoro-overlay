pub(crate) struct PausedSessionsState(pub(crate) std::sync::Mutex<Vec<String>>);
pub(crate) struct DndState(pub(crate) std::sync::Mutex<Option<Vec<u8>>>);

/// `Some(prev_visible)` while a connected widget host owns the compact surface,
/// holding the corner window's visibility from just before suppression so a
/// disconnect can put it back exactly as the user left it.
pub(crate) struct HostSuppressionState(pub(crate) std::sync::Mutex<Option<bool>>);

/// Mirrors the frontend's fullscreen mode. Compact and fullscreen are two modes
/// of the one `main` window, and suppression may only ever gate the compact one.
pub(crate) struct FullscreenState(pub(crate) std::sync::Mutex<bool>);

/// True while the focus sign (edge strip) owns the `main` window. Like
/// fullscreen, it is a surface the user asked for, so host suppression ignores it.
pub(crate) struct SignState(pub(crate) std::sync::Mutex<bool>);

/// Corner-window geometry from just before the sign took over. Outlives the
/// sign's own flag only within one call, never across them.
pub(crate) struct SavedGeometry {
    pub(crate) x: i32,
    pub(crate) y: i32,
    pub(crate) w: u32,
    pub(crate) h: u32,
    /// Top-left of the monitor the corner window was on.
    pub(crate) monitor: Option<(i32, i32)>,
    pub(crate) visible: bool,
    /// Top-left the sign was last placed at, to tell a user drag from the sign's
    /// own moves.
    pub(crate) placed: (i32, i32),
}

pub(crate) struct SignSavedGeometry(pub(crate) std::sync::Mutex<Option<SavedGeometry>>);
