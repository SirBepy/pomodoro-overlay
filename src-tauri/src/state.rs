pub(crate) struct PausedSessionsState(pub(crate) std::sync::Mutex<Vec<String>>);
pub(crate) struct DndState(pub(crate) std::sync::Mutex<Option<Vec<u8>>>);
