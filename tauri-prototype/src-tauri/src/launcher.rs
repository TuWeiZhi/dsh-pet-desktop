use std::{
    fs,
    io::Write,
    os::windows::process::CommandExt,
    process::{Child, Command, Stdio},
    sync::Mutex,
    time::Duration,
};
use tauri::Manager;
struct HostProcess(Mutex<Child>);
impl Drop for HostProcess {
    fn drop(&mut self) {
        if let Ok(child) = self.0.get_mut() {
            let _ = child.kill();
        }
    }
}
fn open_settings(app: &tauri::AppHandle) {
    if let Ok(data) = super::native::data(app) {
        if let Ok(raw) = fs::read(data.join("dsh-pet/standalone-runtime.json")) {
            if let Ok(value) = serde_json::from_slice::<serde_json::Value>(&raw) {
                if let Some(url) = value["settingsUrl"].as_str() {
                    if super::native::validate_settings_url(url).is_ok() {
                        let _ = super::native::open(url);
                    }
                }
            }
        }
    }
}
pub fn run() {
    let application = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            open_settings(app)
        }))
        .setup(|app| {
            let data = super::native::data(app.handle())?;
            let logs = data.join("logs");
            fs::create_dir_all(&logs)?;
            let log_path = logs.join("host.log");
            if fs::metadata(&log_path)
                .map(|m| m.len() > 2 * 1024 * 1024)
                .unwrap_or(false)
            {
                let _ = fs::rename(&log_path, logs.join("host.log.1"));
            }
            let mut log = fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(log_path)?;
            writeln!(log, "Starting Tauri standalone host")?;
            let root = super::resources::root(app.handle());
            let child = Command::new(root.join("host/node.exe"))
                .arg(root.join("lib/standalone.js"))
                .current_dir(&data)
                .env("DSH_HOME", &data)
                .env("DSH_PET_TAURI_DATA_DIR", &data)
                .env("DSH_PET_DESKTOP_APP", "1")
                .env("DSH_PET_ROLE", "host")
                .env("DSH_PET_ELECTRON_PATH", std::env::current_exe()?)
                .env_remove("NODE_OPTIONS")
                .env_remove("ELECTRON_RUN_AS_NODE")
                .creation_flags(0x08000000)
                .stdin(Stdio::null())
                .stdout(log.try_clone()?)
                .stderr(log)
                .spawn()?;
            app.manage(HostProcess(Mutex::new(child)));
            let app = app.handle().clone();
            std::thread::spawn(move || loop {
                let status = app.state::<HostProcess>().0.lock().unwrap().try_wait();
                if let Ok(Some(status)) = status {
                    app.exit(status.code().unwrap_or(1));
                    break;
                }
                std::thread::sleep(Duration::from_millis(200));
            });
            Ok(())
        })
        .build(tauri::generate_context!());
    let application = match application {
        Ok(app) => app,
        Err(error) => {
            super::native::show_error("桌宠启动失败", &error.to_string());
            return;
        }
    };
    application.run(|app, event| {
        if let tauri::RunEvent::Exit = event {
            let _ = app.state::<HostProcess>().0.lock().unwrap().kill();
        }
    });
}
