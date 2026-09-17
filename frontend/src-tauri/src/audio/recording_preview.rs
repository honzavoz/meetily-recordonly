//! Read-only media protocol for recordings explicitly selected in the trim dialog.
//! WebKit requests entire MP4 sample tables. Truncating a requested byte range
//! (as Tauri's asset protocol does at 1,024,000 bytes) makes long recordings fail.

use http::{header::*, Method, Request, Response, StatusCode};
use std::{
    collections::HashMap,
    fs::{self, File},
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    sync::Mutex,
    time::SystemTime,
};

#[derive(Clone)]
struct Snapshot {
    size: u64,
    modified: SystemTime,
}

#[derive(Default)]
pub struct RecordingPreviewScope(Mutex<HashMap<PathBuf, Snapshot>>);

impl RecordingPreviewScope {
    pub fn allow_file(&self, path: &Path) -> Result<(), String> {
        let path = path.canonicalize().map_err(|e| e.to_string())?;
        let metadata = fs::metadata(&path).map_err(|e| e.to_string())?;
        if !metadata.is_file() {
            return Err("Recording preview requires an audio file".into());
        }
        self.0.lock().map_err(|e| e.to_string())?.insert(
            path,
            Snapshot {
                size: metadata.len(),
                modified: metadata.modified().map_err(|e| e.to_string())?,
            },
        );
        Ok(())
    }

    pub fn respond(&self, request: Request<Vec<u8>>) -> Response<Vec<u8>> {
        self.read_response(&request).unwrap_or_else(|status| {
            Response::builder()
                .status(status)
                .header(CACHE_CONTROL, "no-store")
                .body(Vec::new())
                .unwrap()
        })
    }

    fn read_response(&self, request: &Request<Vec<u8>>) -> Result<Response<Vec<u8>>, StatusCode> {
        if request.method() != Method::GET && request.method() != Method::HEAD {
            return Err(StatusCode::METHOD_NOT_ALLOWED);
        }
        let encoded = request
            .uri()
            .path()
            .strip_prefix('/')
            .ok_or(StatusCode::BAD_REQUEST)?;
        let path = PathBuf::from(
            percent_encoding::percent_decode_str(encoded)
                .decode_utf8()
                .map_err(|_| StatusCode::BAD_REQUEST)?
                .as_ref(),
        );
        let snapshot = self
            .0
            .lock()
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
            .get(&path)
            .cloned()
            .ok_or(StatusCode::FORBIDDEN)?;
        // Authorization never comes from a directory wildcard or a URL alone.
        if path.canonicalize().map_err(|_| StatusCode::NOT_FOUND)? != path {
            return Err(StatusCode::FORBIDDEN);
        }
        let mut file = File::open(&path).map_err(|_| StatusCode::NOT_FOUND)?;
        let metadata = file
            .metadata()
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        if !metadata.is_file()
            || metadata.len() != snapshot.size
            || metadata.modified().ok() != Some(snapshot.modified)
        {
            return Err(StatusCode::CONFLICT);
        }
        let size = snapshot.size;
        let mut response = Response::builder()
            .header(CONTENT_TYPE, "audio/mp4")
            .header(ACCEPT_RANGES, "bytes")
            .header(CACHE_CONTROL, "no-store");
        let (start, length) =
            if request.method() == Method::GET && request.headers().contains_key(RANGE) {
                let ranges = request.headers()[RANGE]
                    .to_str()
                    .ok()
                    .and_then(|value| http_range::HttpRange::parse(value, size).ok());
                let range = match ranges.as_deref() {
                    Some([range]) if range.length > 0 => range,
                    _ => {
                        return Ok(response
                            .status(StatusCode::RANGE_NOT_SATISFIABLE)
                            .header(CONTENT_RANGE, format!("bytes */{size}"))
                            .body(Vec::new())
                            .unwrap())
                    }
                };
                response = response.status(StatusCode::PARTIAL_CONTENT).header(
                    CONTENT_RANGE,
                    format!(
                        "bytes {}-{}/{size}",
                        range.start,
                        range.start + range.length - 1
                    ),
                );
                (range.start, range.length)
            } else {
                (0, size)
            };
        response = response.header(CONTENT_LENGTH, length);
        let mut body = Vec::new();
        if request.method() != Method::HEAD {
            let capacity =
                usize::try_from(length).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
            body.try_reserve_exact(capacity)
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
            file.seek(SeekFrom::Start(start))
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
            file.take(length)
                .read_to_end(&mut body)
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
            if body.len() != capacity {
                return Err(StatusCode::CONFLICT);
            }
        }
        Ok(response.body(body).unwrap())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn request(path: &std::path::Path, range: Option<&str>) -> Request<Vec<u8>> {
        let path = path.canonicalize().unwrap();
        let encoded = percent_encoding::utf8_percent_encode(
            path.to_str().unwrap(),
            percent_encoding::NON_ALPHANUMERIC,
        );
        let mut request = Request::builder().uri(format!("recording://localhost/{encoded}?v=1"));
        if let Some(range) = range {
            request = request.header(RANGE, range);
        }
        request.body(Vec::new()).unwrap()
    }

    #[test]
    fn serves_complete_large_metadata_ranges_without_the_asset_protocol_cap() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("Přehrávání.mp4");
        let data: Vec<u8> = (0..2_100_000).map(|i| (i % 251) as u8).collect();
        std::fs::write(&path, &data).unwrap();
        let scope = RecordingPreviewScope::default();
        scope.allow_file(&path).unwrap();
        let response = scope.respond(request(&path, Some("bytes=500000-1893135")));
        assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(
            response.headers()[CONTENT_RANGE],
            "bytes 500000-1893135/2100000"
        );
        assert_eq!(response.headers()[CONTENT_LENGTH], "1393136");
        assert_eq!(response.body(), &data[500_000..1_893_136]);
    }

    #[test]
    fn supports_seek_suffix_head_and_rejects_invalid_ranges() {
        let mut file = tempfile::NamedTempFile::new().unwrap();
        file.write_all(b"0123456789").unwrap();
        let scope = RecordingPreviewScope::default();
        scope.allow_file(file.path()).unwrap();
        for (range, expected) in [
            ("bytes=7-", "789"),
            ("bytes=-3", "789"),
            ("bytes=0-1", "01"),
        ] {
            let response = scope.respond(request(file.path(), Some(range)));
            assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
            assert_eq!(response.body(), expected.as_bytes());
        }
        let mut head = request(file.path(), None);
        *head.method_mut() = http::Method::HEAD;
        let response = scope.respond(head);
        assert_eq!(response.headers()[CONTENT_LENGTH], "10");
        assert!(response.body().is_empty());
        for range in ["bytes=20-30", "bytes=9-2", "bytes=0-1,4-5", "invalid"] {
            let response = scope.respond(request(file.path(), Some(range)));
            assert_eq!(response.status(), StatusCode::RANGE_NOT_SATISFIABLE);
            assert_eq!(response.headers()[CONTENT_RANGE], "bytes */10");
        }
    }

    #[test]
    fn refuses_unapproved_and_changed_files() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("audio.mp4");
        std::fs::write(&path, b"original").unwrap();
        let scope = RecordingPreviewScope::default();
        assert_eq!(
            scope.respond(request(&path, None)).status(),
            StatusCode::FORBIDDEN
        );
        scope.allow_file(&path).unwrap();
        let other = temp.path().join("other.mp4");
        std::fs::write(&other, b"not selected").unwrap();
        assert_eq!(
            scope.respond(request(&other, None)).status(),
            StatusCode::FORBIDDEN
        );
        std::fs::write(&path, b"changed recording").unwrap();
        assert_eq!(
            scope.respond(request(&path, None)).status(),
            StatusCode::CONFLICT
        );
    }
}
