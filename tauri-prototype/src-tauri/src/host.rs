use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Write},
    sync::{
        atomic::{AtomicU64, Ordering},
        mpsc, Arc, Mutex,
    },
    time::Duration,
};
use tauri::Manager;

const PREFIX: &str = "dsh-pet-bridge:";
pub const CONTROL: &str = "dsh-pet-control:";
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Reply {
    pub status: u16,
    pub content_type: Option<String>,
    pub body: Option<String>,
    pub file: Option<String>,
}
#[derive(Default)]
pub struct HostBridge {
    sequence: AtomicU64,
    pending: Mutex<HashMap<u64, mpsc::Sender<Reply>>>,
}
pub fn send(value: &Value, prefix: &str) -> Result<(), String> {
    let mut output = std::io::stdout().lock();
    writeln!(output, "{prefix}{value}")
        .and_then(|_| output.flush())
        .map_err(|e| e.to_string())
}
impl HostBridge {
    pub fn request(&self, method: &str, url: &str, body: Option<String>) -> Result<Reply, String> {
        let id = self.sequence.fetch_add(1, Ordering::SeqCst) + 1;
        let (tx, rx) = mpsc::channel();
        self.pending.lock().unwrap().insert(id, tx);
        let result = send(
            &json!({"id":id,"method":method,"url":url,"body":body}),
            PREFIX,
        )
        .and_then(|_| {
            rx.recv_timeout(Duration::from_secs(45))
                .map_err(|_| "宿主请求超时".into())
        });
        self.pending.lock().unwrap().remove(&id);
        result
    }
    pub fn start(self: &Arc<Self>, app: tauri::AppHandle) {
        let this = self.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(std::io::stdin()).lines() {
                let Ok(line) = line else { break };
                if let Some(raw) = line.strip_prefix(PREFIX) {
                    if let Ok(value) = serde_json::from_str::<Value>(raw) {
                        if let Some(id) = value["id"].as_u64() {
                            if let (Some(tx), Ok(reply)) = (
                                this.pending.lock().unwrap().remove(&id),
                                serde_json::from_value::<Reply>(value),
                            ) {
                                let _ = tx.send(reply);
                            }
                        }
                    }
                } else if let Some(raw) = line.strip_prefix(CONTROL) {
                    if let Ok(value) = serde_json::from_str::<Value>(raw) {
                        let app = app.clone();
                        tauri::async_runtime::spawn(async move {
                            let result = if value["action"] == "flush" {
                                super::flush::all(&app).await
                            } else {
                                super::flush::resume(&app);
                                Ok(())
                            };
                            let _ = send(
                                &json!({"id":value["id"],"ok":result.is_ok(),"error":result.err()}),
                                CONTROL,
                            );
                        });
                    }
                }
            }
            app.state::<super::Runtime>()
                .ready_to_exit
                .store(true, Ordering::SeqCst);
            app.exit(0);
        });
    }
}

#[derive(Clone, Deserialize, Serialize)]
pub struct Pet {
    pub id: String,
    pub size: f64,
}
pub fn pets() -> Result<Vec<Pet>, String> {
    serde_json::from_str(&std::env::var("DSH_PET_PETS").map_err(|_| "缺少宿主宠物配置")?)
        .map_err(|e| e.to_string())
}
