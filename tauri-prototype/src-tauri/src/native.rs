use serde_json::{json, Value};
use std::{
    io::{BufRead, BufReader, Write},
    os::windows::{ffi::OsStrExt, process::CommandExt},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{Arc, Mutex},
};
use windows_sys::Win32::UI::{
    Shell::ShellExecuteW,
    WindowsAndMessaging::{MessageBoxW, MB_ICONERROR, MB_OK, SW_SHOWNORMAL},
};

fn wide(value: impl AsRef<std::ffi::OsStr>) -> Vec<u16> {
    value.as_ref().encode_wide().chain(Some(0)).collect()
}
pub fn open(value: &str) -> Result<(), String> {
    let result = unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            wide("open").as_ptr(),
            wide(value).as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            SW_SHOWNORMAL,
        )
    };
    if result as isize <= 32 {
        Err("无法打开目标".into())
    } else {
        Ok(())
    }
}
pub fn show_error(title: &str, message: &str) {
    unsafe {
        MessageBoxW(
            std::ptr::null_mut(),
            wide(message).as_ptr(),
            wide(title).as_ptr(),
            MB_OK | MB_ICONERROR,
        );
    }
}

pub fn installer_command(file: &Path) -> Command {
    let mut command = Command::new(file);
    command.arg("/UPDATE");
    for name in [
        "DSH_PET_ROLE",
        "DSH_PET_HOST_PID",
        "DSH_PET_SITE_URL",
        "DSH_PET_CONFIG_URL",
        "DSH_PET_PETS",
        "DSH_PET_TAURI_DEBUG_PORT",
        "DSH_PET_TAURI_DATA_DIR",
        "ELECTRON_RUN_AS_NODE",
    ] {
        command.env_remove(name);
    }
    command
}
pub fn data(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    use tauri::Manager;
    std::env::var_os("DSH_PET_TAURI_DATA_DIR")
        .map(PathBuf::from)
        .map(Ok)
        .unwrap_or_else(|| app.path().app_data_dir().map_err(|e| e.to_string()))
}
pub fn settings_url() -> Result<String, String> {
    let raw = std::env::var("DSH_PET_SITE_URL").map_err(|_| "设置地址尚未就绪")?;
    validate_settings_url(&raw)?;
    Ok(raw)
}
pub fn validate_settings_url(raw: &str) -> Result<(), String> {
    let url = tauri::Url::parse(raw).map_err(|e| e.to_string())?;
    if url.scheme() != "http"
        || url.host_str() != Some("127.0.0.1")
        || !url.username().is_empty()
        || url.password().is_some()
    {
        Err("设置地址必须是本机宿主".into())
    } else {
        Ok(())
    }
}
#[derive(Default)]
pub struct TaskCancel {
    pub input: Mutex<Option<std::process::ChildStdin>>,
    pub requested: std::sync::atomic::AtomicBool,
}
pub type Cancel = Arc<TaskCancel>;
pub fn cancel(task: &Cancel) {
    task.requested
        .store(true, std::sync::atomic::Ordering::SeqCst);
    if let Some(input) = task.input.lock().unwrap().as_mut() {
        let _ = writeln!(input, "{}", json!({"action":"cancel"}));
    }
}
pub fn service(
    root: &Path,
    request: Value,
    cancel: Option<Cancel>,
    progress: impl Fn(u64),
) -> Result<Value, String> {
    let mut command = Command::new(root.join("host/node.exe"));
    command.arg(root.join("host/native-services.cjs"));
    execute_service(command, request, cancel, progress)
}
fn execute_service(
    mut command: Command,
    request: Value,
    cancel: Option<Cancel>,
    progress: impl Fn(u64),
) -> Result<Value, String> {
    let mut child = command
        .env_remove("NODE_OPTIONS")
        .creation_flags(0x08000000)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| e.to_string())?;
    let mut input = child.stdin.take().unwrap();
    writeln!(input, "{request}").map_err(|e| e.to_string())?;
    let _keep_input = if let Some(ref handle) = cancel {
        if handle.requested.load(std::sync::atomic::Ordering::SeqCst) {
            let _ = writeln!(input, "{}", json!({"action":"cancel"}));
        }
        *handle.input.lock().unwrap() = Some(input);
        None
    } else {
        Some(input)
    };
    let mut result = Err("后台服务未返回结果".into());
    for line in BufReader::new(child.stdout.take().unwrap()).lines() {
        let line = line.map_err(|e| e.to_string())?;
        if let Ok(value) = serde_json::from_str::<Value>(&line) {
            if let Some(p) = value["progress"].as_u64() {
                progress(p)
            }
            if let Some(value) = value.get("result") {
                result = Ok(value.clone())
            }
            if let Some(error) = value["error"].as_str() {
                result = Err(error.into())
            }
        }
    }
    if let Some(handle) = cancel {
        handle.input.lock().unwrap().take();
    }
    let _ = child.wait();
    result
}
pub fn shutdown(app: &tauri::AppHandle) -> Result<(), String> {
    service(
        &super::resources::root(app),
        json!({"action":"shutdown","settingsUrl":settings_url()?}),
        None,
        |_| {},
    )?;
    Ok(())
}
pub fn startup_enabled() -> bool {
    startup_enabled_at(
        "Software\\Microsoft\\Windows\\CurrentVersion\\Run",
        "Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run",
        &std::env::current_exe().unwrap_or_default(),
    )
}
fn startup_enabled_at(run_path: &str, approved_path: &str, exe: &Path) -> bool {
    use winreg::{enums::*, RegKey};
    let hk = RegKey::predef(HKEY_CURRENT_USER);
    let Ok(run) = hk.open_subkey(run_path) else {
        return false;
    };
    let value: Result<String, _> = run.get_value("dsh-pet-tauri");
    if !value
        .map(|value| {
            value
                .trim()
                .trim_matches('"')
                .eq_ignore_ascii_case(&exe.to_string_lossy())
        })
        .unwrap_or(false)
    {
        return false;
    }
    if let Ok(approved) = hk.open_subkey(approved_path) {
        if let Ok(value) = approved.get_raw_value("dsh-pet-tauri") {
            if value.vtype == REG_BINARY && !matches!(value.bytes.first(), Some(0) | Some(2)) {
                return false;
            }
        }
    }
    true
}
pub fn set_startup(enabled: bool) -> Result<(), String> {
    set_startup_at(
        "Software\\Microsoft\\Windows\\CurrentVersion\\Run",
        "Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run",
        &std::env::current_exe().map_err(|e| e.to_string())?,
        enabled,
    )
}
fn set_startup_at(
    run_path: &str,
    approved_path: &str,
    exe: &Path,
    enabled: bool,
) -> Result<(), String> {
    use winreg::{enums::*, RegKey};
    let hk = RegKey::predef(HKEY_CURRENT_USER);
    let (run, _) = hk.create_subkey(run_path).map_err(|e| e.to_string())?;
    if enabled {
        run.set_value("dsh-pet-tauri", &format!("\"{}\"", exe.display()))
            .map_err(|e| e.to_string())?;
    } else if let Err(e) = run.delete_value("dsh-pet-tauri") {
        if e.kind() != std::io::ErrorKind::NotFound {
            return Err(e.to_string());
        }
    }
    if let Ok(approved) = hk.open_subkey_with_flags(approved_path, KEY_SET_VALUE) {
        let _ = approved.delete_value("dsh-pet-tauri");
    }
    if startup_enabled_at(run_path, approved_path, exe) != enabled {
        return Err("系统未应用开机自启设置".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn startup_settings_follow_windows_approval_without_touching_real_startup() {
        use winreg::{enums::*, RegKey, RegValue};
        let base = format!("Software\\dsh-pet-tauri-tests\\{}", std::process::id());
        let run = format!("{base}\\Run");
        let approved = format!("{base}\\Approved");
        let exe = Path::new("C:\\测试目录\\pet.exe");
        assert!(!startup_enabled_at(&run, &approved, exe));
        set_startup_at(&run, &approved, exe, true).unwrap();
        assert!(startup_enabled_at(&run, &approved, exe));
        let hk = RegKey::predef(HKEY_CURRENT_USER);
        let (key, _) = hk.create_subkey(&approved).unwrap();
        key.set_raw_value(
            "dsh-pet-tauri",
            &RegValue {
                vtype: REG_BINARY,
                bytes: vec![3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            },
        )
        .unwrap();
        assert!(!startup_enabled_at(&run, &approved, exe));
        set_startup_at(&run, &approved, exe, true).unwrap();
        assert!(startup_enabled_at(&run, &approved, exe));
        assert!(!startup_enabled_at(
            &run,
            &approved,
            Path::new("C:\\old\\pet.exe")
        ));
        set_startup_at(&run, &approved, exe, false).unwrap();
        assert!(!startup_enabled_at(&run, &approved, exe));
        drop(key);
        assert!(base.starts_with("Software\\dsh-pet-tauri-tests\\"));
        hk.delete_subkey_all(base).unwrap();
    }
    #[test]
    fn installer_does_not_inherit_helper_role() {
        let cmd = installer_command(Path::new("C:\\updates\\setup.exe"));
        assert!(cmd.get_args().any(|arg| arg == "/UPDATE"));
        assert!(cmd
            .get_envs()
            .any(|(key, value)| key == "DSH_PET_ROLE" && value.is_none()));
    }
    #[test]
    fn service_cancellation_survives_cancel_before_process_spawn() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
        let mut command = Command::new(root.join("web/host/node.exe"));
        command.arg(root.join("test/native-service-fixture.cjs"));
        let cancellation = Arc::new(TaskCancel::default());
        cancel(&cancellation);
        let observed = Mutex::new(Vec::new());
        let result = execute_service(
            command,
            json!({"action":"download"}),
            Some(cancellation),
            |p| observed.lock().unwrap().push(p),
        );
        assert_eq!(result.unwrap_err(), "cancelled fixture");
        assert_eq!(*observed.lock().unwrap(), vec![25]);
    }
}
