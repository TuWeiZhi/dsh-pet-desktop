#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod flush;
mod host;
mod launcher;
mod native;
mod notes;
mod resources;
mod tray;
mod window;

use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};
use tauri::{Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

struct Runtime {
    notes: Mutex<notes::NoteStore>,
    closing: AtomicBool,
    ready_to_exit: AtomicBool,
    host: Arc<host::HostBridge>,
    flushes: flush::Flushes,
    pets: std::collections::HashMap<String, String>,
    flights: Mutex<serde_json::Map<String, serde_json::Value>>,
}

fn check_pet(window: &WebviewWindow) -> Result<(), String> {
    if window.label().starts_with("pet-") {
        Ok(())
    } else {
        Err("This command is only available to the pet window".into())
    }
}

#[tauri::command]
fn read_note(
    window: WebviewWindow,
    state: tauri::State<Runtime>,
    key: String,
    legacy: Option<String>,
) -> Result<Option<String>, String> {
    check_pet(&window)?;
    state
        .notes
        .lock()
        .map_err(|e| e.to_string())?
        .read(&key, legacy.as_deref())
}

#[tauri::command]
fn write_note(
    window: WebviewWindow,
    state: tauri::State<Runtime>,
    key: String,
    text: String,
) -> Result<(), String> {
    check_pet(&window)?;
    state
        .notes
        .lock()
        .map_err(|e| e.to_string())?
        .write(&key, &text)
}

#[tauri::command]
fn finish_window_close(window: WebviewWindow, state: tauri::State<Runtime>) -> Result<(), String> {
    check_pet(&window)?;
    state.flushes.close_saved(window.label(), || {
        window.destroy().map_err(|e| e.to_string())
    })
}

#[tauri::command]
async fn finish_close(window: WebviewWindow) -> Result<(), String> {
    check_pet(&window)?;
    quit_host(window.app_handle()).await
}

#[tauri::command]
fn cancel_close(window: WebviewWindow, state: tauri::State<Runtime>) -> Result<(), String> {
    check_pet(&window)?;
    state.closing.store(false, Ordering::SeqCst);
    Ok(())
}

fn request_close(app: &tauri::AppHandle) {
    let state = app.state::<Runtime>();
    if state.closing.swap(true, Ordering::SeqCst) {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(error) = quit_host(&app).await {
            app.state::<Runtime>()
                .closing
                .store(false, Ordering::SeqCst);
            flush::resume(&app);
            native::show_error("便签未能保存或退出失败", &error);
        }
    });
}

async fn quit_host(app: &tauri::AppHandle) -> Result<(), String> {
    flush::all(app).await?;
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || native::shutdown(&app))
        .await
        .map_err(|e| e.to_string())?
}

fn main() {
    if std::env::var("DSH_PET_ROLE").as_deref() != Ok("helper") {
        launcher::run();
        return;
    }
    tauri::Builder::default()
        .register_asynchronous_uri_scheme_protocol("pet", |context, request,responder| {
            let app=context.app_handle().clone();tauri::async_runtime::spawn_blocking(move||responder.respond(resources::respond(&app,request)));
        })
        .invoke_handler(tauri::generate_handler![read_note, write_note, finish_window_close, finish_close, cancel_close,
            window::set_bounds, window::pointer_state, window::set_passthrough, window::show_settings,
            flush::notes_flushed,flush::flush_notes,flush::resume_notes,window::report_flight,window::report_collision])
        .setup(|app| {
            let data = std::env::var_os("DSH_PET_TAURI_DATA_DIR").map(PathBuf::from)
                .unwrap_or(app.path().app_data_dir()?);
            std::fs::create_dir_all(&data)?;
            let pets=host::pets()?;let bridge=Arc::new(host::HostBridge::default());
            app.manage(Runtime { notes: Mutex::new(notes::NoteStore::new(data.join("notes"))),
                closing: AtomicBool::new(false), ready_to_exit: AtomicBool::new(false),host:bridge.clone(),flushes:Default::default(),
                pets:pets.iter().enumerate().map(|(i,p)|(format!("pet-{i}"),p.id.clone())).collect(),flights:Default::default() });
            bridge.start(app.handle().clone());
            app.manage(window::WindowState::default());
            let geometry = window::geometry(app.handle())?;
            let scale = geometry.scale;
            let mut browser_args = "--autoplay-policy=no-user-gesture-required --force-device-scale-factor=1 --disable-gpu".to_string();
            if let Ok(port) = std::env::var("DSH_PET_TAURI_DEBUG_PORT") {
                if port.parse::<u16>().is_ok() { browser_args.push_str(&format!(" --remote-debugging-port={port}")); }
            }
            #[cfg(debug_assertions)]
            if std::env::var_os("DSH_PET_TAURI_TEST_BACKDROP").is_some() {
                WebviewWindowBuilder::new(app, "backdrop", WebviewUrl::App("index.html".into()))
                    .title("Tauri input validation").position(120.0, 120.0).inner_size(1100.0, 720.0)
                    .additional_browser_args(&browser_args)
                    .initialization_script("document.addEventListener('DOMContentLoaded',()=>{document.body.style.cssText='margin:0;padding:40px;background:#e6f4ff;color:#18334b;font:24px Segoe UI;min-height:100vh';document.body.innerHTML='<h1>Tauri input validation</h1><p>Transparent areas must pass clicks to this window.</p><p id=counter>Background clicks: 0</p>';window.backgroundClicks=0;document.addEventListener('click',()=>{document.querySelector('#counter').textContent='Background clicks: '+(++window.backgroundClicks)});})")
                    .build()?;
            }
            for (index,pet) in pets.iter().enumerate(){
            let mut url: tauri::Url = "pet://localhost/runtime/electron-helper/index.html".parse()?;
            url.query_pairs_mut()
                .append_pair("configUrl", "http://pet.localhost/dsh-pet-7340/config")
                .append_pair("scale", &scale.to_string()).append_pair("settingsMenu", "1")
                .append_pair("petIndex",&index.to_string())
                .append_pair("workAreaX", &geometry.hull.x.to_string())
                .append_pair("workAreaY", &geometry.hull.y.to_string())
                .append_pair("workAreaW", &geometry.hull.width.to_string())
                .append_pair("workAreaH", &geometry.hull.height.to_string())
                .append_pair("areas", &serde_json::to_string(&geometry.areas)?)
                .append_pair("workAreas", &serde_json::to_string(&geometry.areas)?)
                .append_pair("panels", &serde_json::to_string(&geometry.panels)?)
                .append_pair("primaryIndex", &geometry.primary_index.to_string());
            let pointer = include_str!("../../../runtime/electron-helper/pointer-target.js");
            let init = format!("(()=>{{const module={{exports:{{}}}};{pointer}\nwindow.__petPointer=module.exports;}})();\n{}", include_str!("../../bridge.js"));
            let window = WebviewWindowBuilder::new(app, format!("pet-{index}"), WebviewUrl::CustomProtocol(url))
                .title("dsh-pet 桌面宠物")
                .inner_size(pet.size*2.0, pet.size*1.7).decorations(false).transparent(true)
                .background_color(tauri::webview::Color(0, 0, 0, 0))
                .always_on_top(true).skip_taskbar(true).resizable(false)
                .shadow(false).focused(false).visible(false)
                .additional_browser_args(&browser_args).initialization_script(init)
                .data_directory(data.join("webview"))
                .on_navigation(|url| resources::is_local_page(url))
                .build()?;
            window.set_zoom(scale)?;
            window.set_ignore_cursor_events(true)?;
            window.show()?;
            }
            window::start_events(app.handle());
            let app_handle=app.handle().clone();tauri::async_runtime::spawn(async move {
                let response=tauri::async_runtime::spawn_blocking(move||bridge.request("GET","/dsh-pet-7340/config",None)).await;
                match response {Ok(Ok(reply))=>{if let Ok(config)=serde_json::from_str(reply.body.as_deref().unwrap_or("{}")){if let Err(error)=tray::build(&app_handle,config){eprintln!("托盘启动失败：{error}")}}},_=>eprintln!("读取托盘配置失败")}
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if !window.label().starts_with("pet-") { return; }
            match event {
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    if let Some(webview) = window.app_handle().get_webview_window(window.label()) {
                        let _ = webview.eval("window.__petTauri.closeWindowAfterSaving()");
                    }
                }
                tauri::WindowEvent::Destroyed => window::removed(window.app_handle(), window.label()),
                _ => {}
            }
        })
        .build(tauri::generate_context!()).expect("Unable to build the Tauri prototype")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                if !app.state::<Runtime>().ready_to_exit.load(Ordering::SeqCst) {
                    api.prevent_exit();
                }
            }
        });
}
