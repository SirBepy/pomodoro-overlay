pub(crate) struct PausedSessionsState(pub(crate) std::sync::Mutex<Vec<String>>);
pub(crate) struct DndState(pub(crate) std::sync::Mutex<Option<Vec<u8>>>);

/// `Some(prev_visible)` while a connected widget host owns the compact surface,
/// holding the corner window's visibility from just before suppression so a
/// disconnect can put it back exactly as the user left it.
pub(crate) struct HostSuppressionState(pub(crate) std::sync::Mutex<Option<bool>>);

/// Mirrors the frontend's fullscreen mode. Compact and fullscreen are two modes
/// of the one `main` window, and suppression may only ever gate the compact one.
pub(crate) struct FullscreenState(pub(crate) std::sync::Mutex<bool>);
