use serde_json::{json, Value};
use std::{
    path::PathBuf,
    sync::{atomic::Ordering, Arc, Mutex},
    time::Duration,
};
use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    Manager,
};
#[derive(Default)]
struct Update {
    phase: &'static str,
    percent: u64,
    release: Option<Value>,
    installer: Option<PathBuf>,
    checked: bool,
    check_failed: bool,
    update_failed: bool,
    cancel: Option<super::native::Cancel>,
    cancel_visible: bool,
}
pub struct DesktopMenu {
    menu: Menu<tauri::Wry>,
    update: Mutex<Update>,
    startup: CheckMenuItem<tauri::Wry>,
    check: MenuItem<tauri::Wry>,
    install: MenuItem<tauri::Wry>,
    cancel: MenuItem<tauri::Wry>,
    pets: Vec<(String, String)>,
}
fn refresh(app: &tauri::AppHandle) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || refresh_menu(&handle));
}
fn refresh_menu(app: &tauri::AppHandle) {
    let menu = app.state::<DesktopMenu>();
    let mut state = menu.update.lock().unwrap();
    let visible = state.phase == "downloading";
    if visible != state.cancel_visible {
        let changed = if visible {
            menu.menu.items().and_then(|items| {
                menu.menu
                    .insert(&menu.cancel, items.len().saturating_sub(2))
            })
        } else {
            menu.menu.remove(&menu.cancel)
        };
        if changed.is_ok() {
            state.cancel_visible = visible;
        }
    }
    let label = match state.phase {
        "checking" => "正在检查更新…".to_string(),
        "downloading" => format!("正在下载更新：{}%", state.percent),
        "ready" => format!(
            "点击安装 v{}…",
            state
                .release
                .as_ref()
                .and_then(|r| r["version"].as_str())
                .unwrap_or("")
        ),
        "installing" => "正在启动安装…".into(),
        "launched" => "安装程序已启动，请手动退出桌宠".into(),
        _ => {
            if state.update_failed {
                "更新失败，点击重试".into()
            } else if let Some(release) = &state.release {
                format!("点击更新（v{}）", release["version"].as_str().unwrap_or(""))
            } else if state.check_failed {
                "检查更新失败，点击重试".into()
            } else {
                format!(
                    "{}：v{}",
                    if state.checked {
                        "已是最新版本"
                    } else {
                        "当前版本"
                    },
                    app.package_info().version
                )
            }
        }
    };
    let _ = menu.startup.set_checked(super::native::startup_enabled());
    let _ = menu.check.set_enabled(state.phase == "idle");
    let _ = menu.install.set_text(label);
    let _ = menu.install.set_enabled(
        state.phase == "ready"
            || (state.phase == "idle" && (state.release.is_some() || state.check_failed)),
    );
    let _ = menu.cancel.set_enabled(state.phase == "downloading");
}
fn check(app: tauri::AppHandle) {
    {
        let menu = app.state::<DesktopMenu>();
        let mut state = menu.update.lock().unwrap();
        if state.phase != "idle" {
            return;
        }
        state.phase = "checking";
    }
    refresh(&app);
    std::thread::spawn(move || {
        let result = super::native::service(
            &super::resources::root(&app),
            json!({"action":"check","version":app.package_info().version.to_string()}),
            None,
            |_| {},
        );
        {
            let menu = app.state::<DesktopMenu>();
            let mut state = menu.update.lock().unwrap();
            match result {
                Ok(release) => {
                    state.release = if release.is_null() {
                        None
                    } else {
                        Some(release)
                    };
                    state.checked = true;
                    state.check_failed = false;
                    state.update_failed = false
                }
                Err(error) => {
                    eprintln!("检查更新失败：{error}");
                    state.check_failed = true
                }
            }
            state.phase = "idle";
        }
        refresh(&app);
    });
}
fn update(app: tauri::AppHandle) {
    let phase = app.state::<DesktopMenu>().update.lock().unwrap().phase;
    if phase == "ready" {
        app.state::<DesktopMenu>().update.lock().unwrap().phase = "installing";
        refresh(&app);
        tauri::async_runtime::spawn(async move {
            let (file, release) = {
                let menu = app.state::<DesktopMenu>();
                let state = menu.update.lock().unwrap();
                (
                    state.installer.clone().unwrap(),
                    state.release.clone().unwrap(),
                )
            };
            let root = super::resources::root(&app);
            let verify_file = file.clone();
            let verified = tauri::async_runtime::spawn_blocking(move || {
                super::native::service(
                    &root,
                    json!({"action":"verify","file":verify_file,"release":release}),
                    None,
                    |_| {},
                )
            })
            .await;
            let mut launched = false;
            let result = async {
                verified.map_err(|e| e.to_string())??;
                super::flush::all(&app).await?;
                let _child = super::native::installer_command(&file)
                    .spawn()
                    .map_err(|e| e.to_string())?;
                launched = true;
                super::quit_host(&app).await
            }
            .await;
            if let Err(error) = result {
                eprintln!("更新安装失败：{error}");
                super::flush::resume(&app);
                let menu = app.state::<DesktopMenu>();
                let mut state = menu.update.lock().unwrap();
                state.installer = None;
                state.phase = if launched { "launched" } else { "idle" };
                state.update_failed = !launched;
                drop(state);
                refresh(&app);
            }
        });
        return;
    }
    if phase != "idle" {
        return;
    }
    let release = app
        .state::<DesktopMenu>()
        .update
        .lock()
        .unwrap()
        .release
        .clone();
    let Some(release) = release else {
        check(app);
        return;
    };
    let cancel = Arc::new(super::native::TaskCancel::default());
    {
        let menu = app.state::<DesktopMenu>();
        let mut state = menu.update.lock().unwrap();
        state.phase = "downloading";
        state.percent = 0;
        state.update_failed = false;
        state.cancel = Some(cancel.clone());
    }
    refresh(&app);
    std::thread::spawn(move || {
        let directory = super::native::data(&app).unwrap().join("updates");
        let result = super::native::service(
            &super::resources::root(&app),
            json!({"action":"download","release":release,"directory":directory}),
            Some(cancel.clone()),
            |percent| {
                app.state::<DesktopMenu>().update.lock().unwrap().percent = percent;
                refresh(&app);
            },
        );
        {
            let menu = app.state::<DesktopMenu>();
            let mut state = menu.update.lock().unwrap();
            state.cancel = None;
            if cancel.requested.load(Ordering::SeqCst) {
                state.phase = "idle";
                state.installer = None;
            } else {
                match result {
                    Ok(path) => {
                        state.installer = path.as_str().map(PathBuf::from);
                        state.phase = "ready"
                    }
                    Err(error) => {
                        eprintln!("下载更新失败：{error}");
                        state.installer = None;
                        state.update_failed = true;
                        state.phase = "idle";
                    }
                }
            }
        }
        refresh(&app);
    });
}
pub fn build(app: &tauri::AppHandle, config: Value) -> tauri::Result<()> {
    let menu = Menu::new(app)?;
    menu.append(&MenuItem::with_id(
        app,
        "settings",
        "设置",
        true,
        None::<&str>,
    )?)?;
    let mut pets = Vec::new();
    for conf in config.as_object().into_iter().flat_map(|map| map.values()) {
        for pet in conf["pets"].as_array().into_iter().flatten() {
            let id = pet["id"].as_str().unwrap_or("").to_string();
            if id.is_empty() {
                continue;
            }
            if pets.is_empty() {
                menu.append(&PredefinedMenuItem::separator(app)?)?;
            }
            let display = pet["display"].as_str().unwrap_or("").to_string();
            let item = CheckMenuItem::with_id(
                app,
                format!("display-{}", pets.len()),
                pet["name"].as_str().unwrap_or(&id).trim(),
                true,
                display == "both" || display == "desktop",
                None::<&str>,
            )?;
            menu.append(&item)?;
            pets.push((id, display));
        }
    }
    let startup = CheckMenuItem::with_id(
        app,
        "startup",
        "开机自启",
        true,
        super::native::startup_enabled(),
        None::<&str>,
    )?;
    let check_item = MenuItem::with_id(app, "check", "手动检查更新", true, None::<&str>)?;
    let install = MenuItem::with_id(
        app,
        "update",
        format!("当前版本：v{}", app.package_info().version),
        false,
        None::<&str>,
    )?;
    let cancel = MenuItem::with_id(app, "cancel", "取消下载更新", false, None::<&str>)?;
    menu.append_items(&[
        &startup,
        &check_item,
        &install,
        &PredefinedMenuItem::separator(app)?,
        &MenuItem::with_id(app, "quit", "退出桌宠", true, None::<&str>)?,
    ])?;
    app.manage(DesktopMenu {
        menu: menu.clone(),
        update: Mutex::new(Update {
            phase: "idle",
            ..Default::default()
        }),
        startup,
        check: check_item,
        install,
        cancel,
        pets,
    });
    tauri::tray::TrayIconBuilder::new()
        .icon(app.default_window_icon().unwrap().clone())
        .tooltip("dsh-pet 桌面宠物")
        .menu(&menu)
        .on_menu_event(|app, event| action(app.clone(), event.id.as_ref()))
        .on_tray_icon_event(|tray, _| refresh(tray.app_handle()))
        .build(app)?;
    eprintln!("[dsh-pet] tray ready");
    check(app.clone());
    let handle = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(86400));
        check(handle.clone())
    });
    Ok(())
}
fn action(app: tauri::AppHandle, id: &str) {
    match id {
        "settings" => {
            if let Ok(url) = super::native::settings_url() {
                let _ = super::native::open(&url);
            }
        }
        "startup" => {
            if let Err(error) = super::native::set_startup(!super::native::startup_enabled()) {
                super::native::show_error("开机自启设置失败", &error)
            }
            refresh(&app)
        }
        "check" => check(app),
        "update" => update(app),
        "cancel" => {
            if let Some(cancel) = &app.state::<DesktopMenu>().update.lock().unwrap().cancel {
                super::native::cancel(cancel)
            }
        }
        "quit" => super::request_close(&app),
        _ => {
            if let Some(index) = id
                .strip_prefix("display-")
                .and_then(|i| i.parse::<usize>().ok())
            {
                let pet = app.state::<DesktopMenu>().pets.get(index).cloned();
                if let Some((id, display)) = pet {
                    tauri::async_runtime::spawn(async move {
                        let next = match display.as_str() {
                            "both" => "web",
                            "web" => "both",
                            "desktop" => "none",
                            _ => "desktop",
                        };
                        let result: Result<(), String> = async {
                            super::flush::all(&app).await?;
                            let host = app.state::<super::Runtime>().host.clone();
                            let reply = tauri::async_runtime::spawn_blocking(move || {
                                host.request(
                                    "POST",
                                    "/dsh-pet-7340/pet-display",
                                    Some(json!({"id":id,"display":next}).to_string()),
                                )
                            })
                            .await
                            .map_err(|e| e.to_string())??;
                            if reply.status != 200 {
                                return Err("显示设置保存失败".into());
                            }
                            let body: Value =
                                serde_json::from_str(reply.body.as_deref().unwrap_or("{}"))
                                    .map_err(|e| e.to_string())?;
                            if body["ok"] == false {
                                return Err(body["error"]
                                    .as_str()
                                    .unwrap_or("显示设置保存失败")
                                    .into());
                            }
                            Ok(())
                        }
                        .await;
                        if let Err(error) = result {
                            super::flush::resume(&app);
                            eprintln!("{error}")
                        }
                    });
                }
            }
        }
    }
}
