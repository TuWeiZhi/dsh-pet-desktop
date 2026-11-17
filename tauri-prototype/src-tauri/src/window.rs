use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::Mutex;
use std::{collections::HashMap, time::Duration};
use tauri::{Manager, WebviewWindow};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    SetWindowPos, SWP_NOACTIVATE, SWP_NOSIZE, SWP_NOZORDER,
};

#[derive(Clone, Copy, Default, PartialEq, Eq, Deserialize, Serialize)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Default)]
pub struct WindowState(pub Mutex<HashMap<String, Rect>>);

pub fn removed(app: &tauri::AppHandle, label: &str) {
    let state = app.state::<super::Runtime>();
    state.flushes.destroyed(label);
    app.state::<WindowState>().0.lock().unwrap().remove(label);
    if let Some(id) = state.pets.get(label) {
        let snapshot = {
            let mut flights = state.flights.lock().unwrap();
            flights.remove(id);
            json!(*flights)
        };
        for peer in app.webview_windows().into_values() {
            let _ = peer.eval(format!("window.__petTauri.flightStates({snapshot})"));
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Geometry {
    pub hull: Rect,
    pub areas: Vec<Rect>,
    pub panels: Vec<Rect>,
    pub primary_index: usize,
    pub scale: f64,
}

pub fn geometry(app: &tauri::AppHandle) -> tauri::Result<Geometry> {
    let monitors = app.available_monitors()?;
    let primary = app.primary_monitor()?;
    let mut areas = Vec::new();
    let mut panels = Vec::new();
    let mut primary_index = 0;
    for (index, monitor) in monitors.iter().enumerate() {
        let area = monitor.work_area();
        areas.push(Rect {
            x: area.position.x,
            y: area.position.y,
            width: area.size.width,
            height: area.size.height,
        });
        panels.push(Rect {
            x: monitor.position().x,
            y: monitor.position().y,
            width: monitor.size().width,
            height: monitor.size().height,
        });
        if primary
            .as_ref()
            .map(|p| p.position() == monitor.position())
            .unwrap_or(false)
        {
            primary_index = index;
        }
    }
    let x = areas.iter().map(|r| r.x).min().unwrap_or(0);
    let y = areas.iter().map(|r| r.y).min().unwrap_or(0);
    let right = areas
        .iter()
        .map(|r| r.x + r.width as i32)
        .max()
        .unwrap_or(1920);
    let bottom = areas
        .iter()
        .map(|r| r.y + r.height as i32)
        .max()
        .unwrap_or(1080);
    Ok(Geometry {
        hull: Rect {
            x,
            y,
            width: (right - x) as u32,
            height: (bottom - y) as u32,
        },
        areas,
        panels,
        primary_index,
        scale: primary.map(|m| m.scale_factor()).unwrap_or(1.0),
    })
}

#[tauri::command]
pub fn set_bounds(
    window: WebviewWindow,
    state: tauri::State<WindowState>,
    bounds: Rect,
) -> Result<(), String> {
    super::check_pet(&window)?;
    if bounds.width == 0 || bounds.height == 0 || bounds.width > 16384 || bounds.height > 16384 {
        return Err("Invalid window size".into());
    }
    let previous = state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .get(window.label())
        .copied();
    if previous.as_ref() == Some(&bounds) {
        return Ok(());
    }
    let same_size = previous
        .as_ref()
        .map(|old| old.width == bounds.width && old.height == bounds.height)
        .unwrap_or(false);
    let flags = SWP_NOACTIVATE | SWP_NOZORDER | if same_size { SWP_NOSIZE } else { 0 };
    let hwnd = window.hwnd().map_err(|e| e.to_string())?;
    let success = unsafe {
        SetWindowPos(
            hwnd.0 as _,
            std::ptr::null_mut(),
            bounds.x,
            bounds.y,
            bounds.width as i32,
            bounds.height as i32,
            flags,
        )
    };
    if success == 0 {
        return Err(std::io::Error::last_os_error().to_string());
    }
    state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .insert(window.label().into(), bounds);
    Ok(())
}

#[derive(Serialize)]
pub struct PointerState {
    pub x: f64,
    pub y: f64,
    pub bounds: Rect,
}

#[tauri::command]
pub fn pointer_state(window: WebviewWindow) -> Result<PointerState, String> {
    super::check_pet(&window)?;
    let point = window.cursor_position().map_err(|e| e.to_string())?;
    let position = window.inner_position().map_err(|e| e.to_string())?;
    let size = window.inner_size().map_err(|e| e.to_string())?;
    let bounds = Rect {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
    };
    Ok(PointerState {
        x: point.x,
        y: point.y,
        bounds,
    })
}

#[tauri::command]
pub fn set_passthrough(window: WebviewWindow, ignore: bool) -> Result<(), String> {
    super::check_pet(&window)?;
    window
        .set_ignore_cursor_events(ignore)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn show_settings(window: WebviewWindow) -> Result<(), String> {
    super::check_pet(&window)?;
    super::native::open(&super::native::settings_url()?)
}

#[tauri::command]
pub fn report_flight(
    window: WebviewWindow,
    state: tauri::State<super::Runtime>,
    motion: Value,
) -> Result<(), String> {
    super::check_pet(&window)?;
    if !["x", "y", "vx", "vy", "size", "bottomPad"]
        .iter()
        .all(|key| {
            motion[*key]
                .as_f64()
                .map(|v| v.is_finite())
                .unwrap_or(false)
        })
    {
        return Err("Invalid motion".into());
    }
    if let Some(id) = state.pets.get(window.label()) {
        state.flights.lock().unwrap().insert(id.clone(), motion);
        let snapshot = json!(*state.flights.lock().unwrap());
        for peer in window.app_handle().webview_windows().into_values() {
            let _ = peer.eval(format!("window.__petTauri.flightStates({snapshot})"));
        }
    }
    Ok(())
}
#[tauri::command]
pub fn report_collision(
    window: WebviewWindow,
    state: tauri::State<super::Runtime>,
    target_id: String,
    vx: f64,
    vy: f64,
) -> Result<(), String> {
    super::check_pet(&window)?;
    if !vx.is_finite() || !vy.is_finite() {
        return Err("Invalid velocity".into());
    }
    if let Some((label, _)) = state.pets.iter().find(|(_, id)| **id == target_id) {
        if let Some(target) = window.app_handle().get_webview_window(label) {
            target
                .eval(format!(
                    "window.__petTauri.petHit({})",
                    json!({"vx":vx,"vy":vy})
                ))
                .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}
pub fn start_events(app: &tauri::AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        let mut previous = geometry(&app)
            .ok()
            .and_then(|g| serde_json::to_string(&g).ok())
            .unwrap_or_default();
        loop {
            std::thread::sleep(Duration::from_millis(250));
            {
                if let Ok(geometry) = geometry(&app) {
                    let next = serde_json::to_string(&geometry).unwrap();
                    if next != previous {
                        previous = next.clone();
                        app.state::<WindowState>().0.lock().unwrap().clear();
                        for window in app.webview_windows().into_values() {
                            let _ = window.eval(format!("window.__petTauri.displays({next})"));
                        }
                    }
                }
            }
        }
    });
}
