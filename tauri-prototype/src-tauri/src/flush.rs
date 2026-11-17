use std::{
    collections::{HashMap, HashSet},
    sync::{
        atomic::{AtomicU64, Ordering},
        mpsc, Mutex,
    },
    time::Duration,
};
use tauri::Manager;
struct Pending {
    windows: HashSet<String>,
    result: mpsc::Sender<Result<(), String>>,
}
#[derive(Default)]
struct State {
    pending: HashMap<u64, Pending>,
    saved_closed: HashSet<String>,
}
impl State {
    fn acknowledge(&mut self, id: u64, label: &str, error: Option<String>) {
        if let Some(pending) = self.pending.get_mut(&id) {
            if !pending.windows.remove(label) {
                return;
            }
            if let Some(error) = error {
                let _ = pending.result.send(Err(error));
                self.pending.remove(&id);
            } else if pending.windows.is_empty() {
                let _ = pending.result.send(Ok(()));
                self.pending.remove(&id);
            }
        }
    }
    fn finish_window(&mut self, label: &str, error: Option<String>) {
        let ids: Vec<_> = self.pending.keys().copied().collect();
        for id in ids {
            self.acknowledge(id, label, error.clone());
        }
    }
}
#[derive(Default)]
pub struct Flushes {
    next: AtomicU64,
    state: Mutex<State>,
}
impl Flushes {
    pub fn close_saved(
        &self,
        label: &str,
        destroy: impl FnOnce() -> Result<(), String>,
    ) -> Result<(), String> {
        // Tauri destroy queues a native event. Serialize dispatch and registration with global flushes.
        let mut state = self.state.lock().unwrap();
        destroy()?;
        state.saved_closed.insert(label.into());
        state.finish_window(label, None);
        Ok(())
    }
    pub fn destroyed(&self, label: &str) {
        let mut state = self.state.lock().unwrap();
        if !state.saved_closed.contains(label) {
            state.finish_window(label, Some("宠物窗口在便签保存完成前关闭".into()));
        }
    }
}
pub async fn all(app: &tauri::AppHandle) -> Result<(), String> {
    let mut windows: Vec<_> = app
        .webview_windows()
        .into_values()
        .filter(|w| w.label().starts_with("pet-"))
        .collect();
    if windows.is_empty() {
        return Ok(());
    }
    let state = app.state::<super::Runtime>();
    let id = state.flushes.next.fetch_add(1, Ordering::SeqCst) + 1;
    let (tx, rx) = mpsc::channel();
    {
        let mut flushes = state.flushes.state.lock().unwrap();
        windows.retain(|window| !flushes.saved_closed.contains(window.label()));
        if windows.is_empty() {
            return Ok(());
        }
        flushes.pending.insert(
            id,
            Pending {
                windows: windows.iter().map(|w| w.label().into()).collect(),
                result: tx,
            },
        );
    }
    for window in windows {
        if let Err(error) = window.eval(format!("window.__petTauri.flushForHost({id})")) {
            let mut flushes = state.flushes.state.lock().unwrap();
            if flushes.saved_closed.contains(window.label()) {
                continue;
            }
            flushes.pending.remove(&id);
            drop(flushes);
            resume(app);
            return Err(error.to_string());
        }
    }
    let result = tauri::async_runtime::spawn_blocking(move || {
        rx.recv_timeout(Duration::from_secs(25))
            .unwrap_or_else(|_| Err("等待便签保存超时".into()))
    })
    .await
    .map_err(|e| e.to_string())?;
    state.flushes.state.lock().unwrap().pending.remove(&id);
    if result.is_err() {
        resume(app)
    }
    result
}
pub fn resume(app: &tauri::AppHandle) {
    for window in app
        .webview_windows()
        .into_values()
        .filter(|w| w.label().starts_with("pet-"))
    {
        let _ = window.eval("window.PetNotes?.resumeEditing()");
    }
}
#[tauri::command]
pub fn notes_flushed(
    window: tauri::WebviewWindow,
    state: tauri::State<super::Runtime>,
    id: u64,
    error: Option<String>,
) -> Result<(), String> {
    super::check_pet(&window)?;
    state
        .flushes
        .state
        .lock()
        .unwrap()
        .acknowledge(id, window.label(), error);
    Ok(())
}
#[tauri::command]
pub async fn flush_notes(window: tauri::WebviewWindow) -> Result<(), String> {
    super::check_pet(&window)?;
    all(window.app_handle()).await
}
#[tauri::command]
pub fn resume_notes(window: tauri::WebviewWindow) -> Result<(), String> {
    super::check_pet(&window)?;
    resume(window.app_handle());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn pending(flushes: &Flushes) -> mpsc::Receiver<Result<(), String>> {
        let (tx, rx) = mpsc::channel();
        flushes.state.lock().unwrap().pending.insert(
            1,
            Pending {
                windows: ["pet-0".into(), "pet-1".into()].into(),
                result: tx,
            },
        );
        rx
    }
    #[test]
    fn saved_close_completes_only_its_window_in_pending_flush() {
        let flushes = Flushes::default();
        let rx = pending(&flushes);
        flushes.close_saved("pet-0", || Ok(())).unwrap();
        assert!(rx.try_recv().is_err());
        flushes.state.lock().unwrap().acknowledge(1, "pet-1", None);
        assert_eq!(rx.try_recv().unwrap(), Ok(()));
        assert!(flushes.state.lock().unwrap().saved_closed.contains("pet-0"));
    }
    #[test]
    fn failed_destroy_does_not_skip_window_or_acknowledge_save() {
        let flushes = Flushes::default();
        let rx = pending(&flushes);
        assert!(flushes
            .close_saved("pet-0", || Err("failed".into()))
            .is_err());
        assert!(rx.try_recv().is_err());
        assert!(!flushes.state.lock().unwrap().saved_closed.contains("pet-0"));
        flushes.destroyed("pet-0");
        assert!(rx.try_recv().unwrap().is_err());
    }
}
