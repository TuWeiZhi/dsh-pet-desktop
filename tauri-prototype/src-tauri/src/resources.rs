use std::{
    fs,
    path::{Component, Path, PathBuf},
};
use tauri::http::{Request, Response, StatusCode};
use tauri::Manager;

pub fn is_local_page(url: &tauri::Url) -> bool {
    (url.scheme() == "pet" && url.host_str() == Some("localhost"))
        || (url.scheme() == "http" && url.host_str() == Some("pet.localhost"))
}

pub fn root(app: &tauri::AppHandle) -> PathBuf {
    #[cfg(debug_assertions)]
    {
        let _ = app;
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../web")
    }
    #[cfg(not(debug_assertions))]
    {
        app.path()
            .resource_dir()
            .expect("Application resource directory")
            .join("web")
    }
}

fn response(status: StatusCode, mime: &str, bytes: Vec<u8>) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header("Content-Type", mime)
        .header("Access-Control-Allow-Origin", "http://pet.localhost")
        .body(bytes)
        .unwrap()
}

pub fn respond(app: &tauri::AppHandle, request: Request<Vec<u8>>) -> Response<Vec<u8>> {
    if request.uri().path().starts_with("/dsh-pet-7340/") {
        if request.body().len() > 1024 * 1024 {
            return response(
                StatusCode::PAYLOAD_TOO_LARGE,
                "text/plain",
                b"Request too large".to_vec(),
            );
        }
        let url = request
            .uri()
            .path_and_query()
            .map(|p| p.as_str())
            .unwrap_or("/");
        let body = if request.body().is_empty() {
            None
        } else {
            match String::from_utf8(request.body().clone()) {
                Ok(s) => Some(s),
                Err(_) => {
                    return response(
                        StatusCode::BAD_REQUEST,
                        "text/plain",
                        b"Invalid UTF-8".to_vec(),
                    )
                }
            }
        };
        return match app.state::<super::Runtime>().host.request(
            request.method().as_str(),
            url,
            body,
        ) {
            Ok(reply) => {
                let bytes = if let Some(file) = reply.file {
                    match fs::read(file) {
                        Ok(bytes) => bytes,
                        Err(_) => {
                            return response(
                                StatusCode::NOT_FOUND,
                                "text/plain",
                                b"Asset missing".to_vec(),
                            )
                        }
                    }
                } else {
                    reply.body.unwrap_or_default().into_bytes()
                };
                response(
                    StatusCode::from_u16(reply.status).unwrap_or(StatusCode::BAD_GATEWAY),
                    reply.content_type.as_deref().unwrap_or("application/json"),
                    bytes,
                )
            }
            Err(error) => response(StatusCode::BAD_GATEWAY, "text/plain", error.into_bytes()),
        };
    }
    let decoded = match percent_encoding::percent_decode_str(request.uri().path()).decode_utf8() {
        Ok(path) => path,
        Err(_) => {
            return response(
                StatusCode::BAD_REQUEST,
                "text/plain",
                b"Invalid path".to_vec(),
            )
        }
    };
    let path = decoded.trim_start_matches('/');
    if !path.starts_with("assets/") && !path.starts_with("runtime/electron-helper/") {
        return response(
            StatusCode::NOT_FOUND,
            "text/plain",
            b"Resource not found".to_vec(),
        );
    }
    if path.contains('\\')
        || Path::new(path)
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
    {
        return response(
            StatusCode::BAD_REQUEST,
            "text/plain",
            b"Invalid path".to_vec(),
        );
    }
    let relative = path.to_owned();
    if request.method() != "GET" && request.method() != "HEAD" {
        return response(
            StatusCode::METHOD_NOT_ALLOWED,
            "text/plain",
            b"Read-only resource".to_vec(),
        );
    }
    let file = root(app).join(relative);
    let mime = match file.extension().and_then(|s| s.to_str()).unwrap_or("") {
        "html" => "text/html; charset=utf-8",
        "js" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" => "application/json",
        "webm" => "video/webm",
        "png" => "image/png",
        "ttf" => "font/ttf",
        _ => "application/octet-stream",
    };
    match fs::read(file) {
        Ok(bytes) => response(StatusCode::OK, mime, bytes),
        Err(_) => response(
            StatusCode::NOT_FOUND,
            "text/plain",
            b"Resource not found".to_vec(),
        ),
    }
}
