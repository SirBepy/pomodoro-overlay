use crate::state::DndState;
use tauri::{AppHandle, Manager, State};

#[cfg(target_os = "windows")]
mod dnd_impl {
    use windows_sys::Win32::System::Registry::{
        RegCloseKey, RegOpenKeyExW, RegQueryValueExW, RegSetValueExW,
        HKEY_CURRENT_USER, KEY_QUERY_VALUE, KEY_SET_VALUE, REG_BINARY,
    };

    const KEY_PATH: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\CloudStore\\Store\\Cache\\DefaultAccount\\$$windows.data.notifications.quiethourssettings\\Current";
    const VALUE_NAME: &str = "Data";
    const PROFILE_ALARMS_ONLY: &str = "Microsoft.QuietHoursProfile.AlarmsOnly";

    const STR_OFFSET: usize = 26;
    const COUNT_OFFSET: usize = 25;

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(Some(0)).collect()
    }

    pub fn read_blob() -> Option<Vec<u8>> {
        unsafe {
            let mut hkey: windows_sys::Win32::System::Registry::HKEY = std::ptr::null_mut();
            let key = wide(KEY_PATH);
            if RegOpenKeyExW(HKEY_CURRENT_USER, key.as_ptr(), 0, KEY_QUERY_VALUE, &mut hkey) != 0 {
                return None;
            }
            let val = wide(VALUE_NAME);
            let mut size: u32 = 0;
            let mut kind: u32 = 0;
            let rc1 = RegQueryValueExW(
                hkey,
                val.as_ptr(),
                std::ptr::null_mut(),
                &mut kind,
                std::ptr::null_mut(),
                &mut size,
            );
            if rc1 != 0 || kind != REG_BINARY || size == 0 {
                RegCloseKey(hkey);
                return None;
            }
            let mut buf = vec![0u8; size as usize];
            let rc2 = RegQueryValueExW(
                hkey,
                val.as_ptr(),
                std::ptr::null_mut(),
                &mut kind,
                buf.as_mut_ptr(),
                &mut size,
            );
            RegCloseKey(hkey);
            if rc2 == 0 {
                buf.truncate(size as usize);
                Some(buf)
            } else {
                None
            }
        }
    }

    pub fn write_blob(data: &[u8]) -> bool {
        if data.is_empty() {
            return false;
        }
        unsafe {
            let mut hkey: windows_sys::Win32::System::Registry::HKEY = std::ptr::null_mut();
            let key = wide(KEY_PATH);
            if RegOpenKeyExW(HKEY_CURRENT_USER, key.as_ptr(), 0, KEY_SET_VALUE, &mut hkey) != 0 {
                return false;
            }
            let val = wide(VALUE_NAME);
            let rc = RegSetValueExW(
                hkey,
                val.as_ptr(),
                0,
                REG_BINARY,
                data.as_ptr(),
                data.len() as u32,
            );
            RegCloseKey(hkey);
            rc == 0
        }
    }

    fn current_filetime() -> u64 {
        use std::time::SystemTime;
        let nanos = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .map(|d| d.as_nanos() as u64)
            .unwrap_or(0);
        (nanos / 100) + 116_444_736_000_000_000u64
    }

    fn stamp_filetime(buf: &mut [u8]) {
        if buf.len() >= 12 {
            buf[4..12].copy_from_slice(&current_filetime().to_le_bytes());
        }
    }

    pub fn build_alarms_only(original: &[u8]) -> Option<Vec<u8>> {
        if original.len() < STR_OFFSET {
            return None;
        }
        let old_count = original[COUNT_OFFSET] as usize;
        let old_str_end = STR_OFFSET + old_count * 2;
        if old_str_end > original.len() {
            return None;
        }
        let trailing = &original[old_str_end..];

        let new_chars: Vec<u16> = PROFILE_ALARMS_ONLY.encode_utf16().collect();
        let new_count = new_chars.len();
        let mut new_str_bytes = Vec::with_capacity(new_count * 2);
        for u in &new_chars {
            new_str_bytes.extend_from_slice(&u.to_le_bytes());
        }

        let mut out = Vec::with_capacity(STR_OFFSET + new_str_bytes.len() + trailing.len());
        out.extend_from_slice(&original[..STR_OFFSET]);
        out[COUNT_OFFSET] = new_count as u8;
        stamp_filetime(&mut out);
        out.extend_from_slice(&new_str_bytes);

        if trailing.len() >= 4
            && trailing[0] == 0xCA
            && trailing[1] as usize == old_count
            && trailing[2] == 0x00
            && trailing[3] == 0x00
        {
            out.push(0xCA);
            out.push(new_count as u8);
            out.push(0x00);
            out.push(0x00);
            out.extend_from_slice(&trailing[4..]);
        } else {
            out.extend_from_slice(trailing);
        }

        Some(out)
    }

    pub fn refresh_filetime(blob: &[u8]) -> Vec<u8> {
        let mut out = blob.to_vec();
        stamp_filetime(&mut out);
        out
    }

    pub fn kick_wpn_user_service() {
        use std::os::windows::process::CommandExt;
        use std::process::Command;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let _ = Command::new("powershell.exe")
            .creation_flags(CREATE_NO_WINDOW)
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-WindowStyle",
                "Hidden",
                "-Command",
                "Get-Service -Name 'WpnUserService_*' -ErrorAction SilentlyContinue | Restart-Service -Force -ErrorAction SilentlyContinue",
            ])
            .output();
    }
}

#[cfg(target_os = "windows")]
fn dnd_backup_path(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path()
        .app_local_data_dir()
        .ok()
        .map(|d| d.join("dnd_backup.bin"))
}

#[cfg(target_os = "windows")]
pub(crate) fn recover_dnd_backup(blob: &[u8]) -> bool {
    let refreshed = dnd_impl::refresh_filetime(blob);
    if dnd_impl::write_blob(&refreshed) {
        dnd_impl::kick_wpn_user_service();
        true
    } else {
        false
    }
}

#[tauri::command]
pub fn enable_dnd(app: AppHandle, state: State<'_, DndState>) {
    #[cfg(target_os = "windows")]
    {
        let mut guard = state.0.lock().unwrap();
        if guard.is_some() {
            return;
        }
        let Some(original) = dnd_impl::read_blob() else {
            log::warn!("enable_dnd: CloudStore quiethours blob not present; skipping");
            return;
        };
        let Some(new_blob) = dnd_impl::build_alarms_only(&original) else {
            log::warn!("enable_dnd: failed to build AlarmsOnly blob; skipping");
            return;
        };
        if let Some(p) = dnd_backup_path(&app) {
            if let Some(parent) = p.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            if let Err(e) = std::fs::write(&p, &original) {
                log::warn!("enable_dnd: failed to write backup file: {e}");
            }
        }
        if dnd_impl::write_blob(&new_blob) {
            *guard = Some(original);
            dnd_impl::kick_wpn_user_service();
        } else {
            log::warn!("enable_dnd: failed to write CloudStore blob");
        }
    }
    #[cfg(not(target_os = "windows"))]
    let _ = (app, state);
}

#[tauri::command]
pub fn disable_dnd(app: AppHandle, state: State<'_, DndState>) {
    #[cfg(target_os = "windows")]
    {
        let prev = state.0.lock().unwrap().take();
        if let Some(blob) = prev {
            let refreshed = dnd_impl::refresh_filetime(&blob);
            if dnd_impl::write_blob(&refreshed) {
                dnd_impl::kick_wpn_user_service();
                if let Some(p) = dnd_backup_path(&app) {
                    let _ = std::fs::remove_file(p);
                }
            } else {
                log::warn!("disable_dnd: failed to restore CloudStore blob");
            }
        }
    }
    #[cfg(not(target_os = "windows"))]
    let _ = (app, state);
}
