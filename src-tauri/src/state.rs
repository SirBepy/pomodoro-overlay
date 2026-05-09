pub(crate) struct PausedSessionsState(pub(crate) std::sync::Mutex<Vec<String>>);
pub(crate) struct DndState(pub(crate) std::sync::Mutex<Option<Vec<u8>>>);
pub(crate) struct TrayPlayPauseItem(pub(crate) tauri::menu::MenuItem<tauri::Wry>);
