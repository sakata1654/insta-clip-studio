#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use serde_json::{json, Value};
use std::collections::{HashMap, VecDeque};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, ExitStatus, Stdio};
use std::sync::{Arc, Mutex, OnceLock};
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Emitter};

// ---------------------------------------------------------------- paths & tool discovery
static OVR: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();

fn ovr(k: &str) -> Option<String> {
    let g = OVR.get_or_init(|| Mutex::new(HashMap::new())).lock().ok()?;
    g.get(k).cloned().filter(|s| !s.trim().is_empty())
}

#[tauri::command]
fn set_overrides(map: HashMap<String, String>) {
    if let Ok(mut g) = OVR.get_or_init(|| Mutex::new(HashMap::new())).lock() { *g = map; }
}

fn local_app() -> PathBuf {
    std::env::var_os("LOCALAPPDATA").map(PathBuf::from).unwrap_or_else(std::env::temp_dir).join("InstaClipStudio")
}
fn tools_dir() -> PathBuf { local_app().join("tools") }
fn models_dir() -> PathBuf { local_app().join("models") }
fn exe_dir() -> PathBuf {
    std::env::current_exe().ok().and_then(|e| e.parent().map(|p| p.to_path_buf())).unwrap_or_default()
}

fn nowin(c: &mut Command) {
    #[cfg(windows)]
    { use std::os::windows::process::CommandExt; c.creation_flags(0x0800_0000); }
    #[cfg(not(windows))]
    { let _ = c; }
}

fn which(name: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    for d in std::env::split_paths(&path) {
        for ext in [".exe", ""] {
            let p = d.join(format!("{name}{ext}"));
            if p.is_file() { return Some(p); }
        }
    }
    None
}

fn python() -> Option<(String, Vec<String>)> {
    let mut c: Vec<(String, Vec<String>)> = Vec::new();
    if let Some(o) = ovr("python") { c.push((o, vec![])); }
    c.push(("python".into(), vec![]));
    c.push(("py".into(), vec!["-3".into()]));
    c.push(("python3".into(), vec![]));
    for (p, pre) in c {
        let mut cm = Command::new(&p);
        nowin(&mut cm);
        if let Ok(o) = cm.args(&pre).args(["-c", "import sys;print(sys.executable)"]).output() {
            if o.status.success() && !o.stdout.is_empty() { return Some((p, pre)); }
        }
    }
    None
}

fn pycmd() -> Option<Command> {
    let (p, pre) = python()?;
    let mut c = Command::new(p);
    nowin(&mut c);
    c.args(pre);
    Some(c)
}

fn py_has(m: &str) -> bool {
    pycmd()
        .and_then(|mut c| c.args(["-c", &format!("import importlib.util as u,sys;sys.exit(0 if u.find_spec('{m}') else 1)")]).status().ok())
        .map(|s| s.success())
        .unwrap_or(false)
}

fn imageio_ffmpeg() -> Option<PathBuf> {
    static C: OnceLock<Option<PathBuf>> = OnceLock::new();
    C.get_or_init(|| {
        let mut c = pycmd()?;
        let o = c.args(["-c", "import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())"]).output().ok()?;
        if !o.status.success() { return None; }
        let p = PathBuf::from(String::from_utf8_lossy(&o.stdout).trim().to_string());
        if p.is_file() { Some(p) } else { None }
    }).clone()
}

// custom path -> tools dir (downloaded by Setup) -> next to the app -> PATH -> (ffmpeg) the copy bundled with moviepy
fn find_tool(name: &str) -> Option<PathBuf> {
    if let Some(o) = ovr(name) { let p = PathBuf::from(o); if p.is_file() { return Some(p); } }
    for d in [tools_dir(), exe_dir()] {
        for n in [format!("{name}.exe"), name.to_string()] {
            let p = d.join(&n);
            if p.is_file() { return Some(p); }
        }
    }
    if let Some(p) = which(name) { return Some(p); }
    if name == "ffmpeg" { return imageio_ffmpeg(); }
    None
}

fn cohere_python() -> Option<PathBuf> {
    let p = local_app().join("cohere-venv").join("Scripts").join("python.exe");
    if p.is_file() { Some(p) } else { None }
}

fn find_whisper_cli() -> Option<PathBuf> {
    for d in [tools_dir().join("whisper"), exe_dir().join("whisper")] {
        for n in ["whisper-cli.exe", "main.exe"] {
            let p = d.join(n);
            if p.is_file() { return Some(p); }
        }
    }
    which("whisper-cli")
}

fn ffmpeg() -> Result<Command, String> {
    let p = find_tool("ffmpeg").ok_or("FFmpeg not found. Open the Setup tab and press Install missing.")?;
    let mut c = Command::new(p);
    nowin(&mut c);
    Ok(c)
}

fn ytdlp_cmd() -> Result<Command, String> {
    if let Some(p) = find_tool("yt-dlp") { let mut c = Command::new(p); nowin(&mut c); return Ok(c); }
    if py_has("yt_dlp") { if let Some(mut c) = pycmd() { c.args(["-m", "yt_dlp"]); return Ok(c); } }
    Err("yt-dlp not found. Open the Setup tab and press Install missing.".into())
}

fn hf_hub() -> PathBuf {
    if let Some(p) = std::env::var_os("HUGGINGFACE_HUB_CACHE") { return PathBuf::from(p); }
    if let Some(p) = std::env::var_os("HF_HOME") { return PathBuf::from(p).join("hub"); }
    std::env::var_os("USERPROFILE").map(PathBuf::from).unwrap_or_default().join(".cache").join("huggingface").join("hub")
}

fn fw_models() -> Vec<String> {
    let mut v = vec![];
    if let Ok(rd) = std::fs::read_dir(hf_hub()) {
        for e in rd.flatten() {
            let n = e.file_name().to_string_lossy().to_string();
            if let Some(s) = n.strip_prefix("models--Systran--faster-whisper-") { v.push(s.to_string()); }
            else if let Some(s) = n.strip_prefix("models--Systran--faster-distil-whisper-") { v.push(format!("distil-{s}")); }
        }
    }
    v
}

fn cpp_models() -> Vec<String> {
    let mut v = vec![];
    for d in [models_dir(), tools_dir().join("whisper"), exe_dir().join("whisper")] {
        if let Ok(rd) = std::fs::read_dir(d) {
            for e in rd.flatten() {
                let n = e.file_name().to_string_lossy().to_string();
                if let Some(s) = n.strip_prefix("ggml-").and_then(|s| s.strip_suffix(".bin")) { v.push(s.to_string()); }
            }
        }
    }
    v
}

fn demucs_weights() -> bool {
    let base = std::env::var_os("TORCH_HOME").map(PathBuf::from)
        .unwrap_or_else(|| std::env::var_os("USERPROFILE").map(PathBuf::from).unwrap_or_default().join(".cache").join("torch"));
    std::fs::read_dir(base.join("hub").join("checkpoints")).map(|rd| rd.flatten().any(|e| e.file_name().to_string_lossy().ends_with(".th"))).unwrap_or(false)
}

// ---------------------------------------------------------------- helpers
fn run_stream(app: &AppHandle, ev: &str, mut c: Command) -> Result<ExitStatus, String> {
    let mut ch = c.stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().map_err(|e| e.to_string())?;
    let (a2, e2) = (app.clone(), ev.to_string());
    let err = ch.stderr.take().unwrap();
    let t = std::thread::spawn(move || { for l in BufReader::new(err).lines().flatten() { let _ = a2.emit(&e2, l); } });
    for l in BufReader::new(ch.stdout.take().unwrap()).lines().flatten() { let _ = app.emit(ev, l); }
    let _ = t.join();
    ch.wait().map_err(|e| e.to_string())
}

// Cohere diagnostics: retain a bounded tail of stdout/stderr so a failed run explains
// whether the cause was gated model access, a missing dependency, or a runtime/GPU error.
fn remember_line(lines: &Arc<Mutex<VecDeque<String>>>, line: String) {
    if let Ok(mut items) = lines.lock() {
        if items.len() >= 60 { items.pop_front(); }
        items.push_back(line);
    }
}

fn run_stream_capture(app: &AppHandle, ev: &str, mut c: Command) -> Result<(ExitStatus, Vec<String>), String> {
    let mut ch = c.stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().map_err(|e| e.to_string())?;
    let recent = Arc::new(Mutex::new(VecDeque::<String>::new()));
    let stderr = ch.stderr.take().ok_or("Cohere stderr stream unavailable")?;
    let stdout = ch.stdout.take().ok_or("Cohere stdout stream unavailable")?;

    let err_app = app.clone();
    let err_event = ev.to_string();
    let err_recent = Arc::clone(&recent);
    let err_thread = std::thread::spawn(move || {
        for line in BufReader::new(stderr).lines().flatten() {
            let _ = err_app.emit(&err_event, line.clone());
            remember_line(&err_recent, line);
        }
    });
    for line in BufReader::new(stdout).lines().flatten() {
        let _ = app.emit(ev, line.clone());
        remember_line(&recent, line);
    }
    let _ = err_thread.join();
    let status = ch.wait().map_err(|e| e.to_string())?;
    let output = recent.lock().map(|v| v.iter().cloned().collect()).unwrap_or_default();
    Ok((status, output))
}

// Run a video encode without buffering the entire FFmpeg output until exit.
// FFmpeg's progress channel keeps the UI responsive and exposes real progress.
fn run_encode_progress(app: &AppHandle, mut c: Command, total_seconds: f64, encoder: &str) -> Result<(ExitStatus, String), String> {
    let mut ch = c.stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().map_err(|e| e.to_string())?;
    let out = ch.stdout.take().ok_or("FFmpeg stdout unavailable")?;
    let err = ch.stderr.take().ok_or("FFmpeg stderr unavailable")?;
    let a2 = app.clone();
    let enc = encoder.to_string();
    let err_thread = std::thread::spawn(move || {
        let mut last = String::new();
        for line in BufReader::new(err).lines().flatten() {
            let line = line.trim().to_string();
            if line.is_empty() { continue; }
            let lower = line.to_lowercase();
            if lower.contains("error") || lower.contains("failed") || lower.contains("cannot") || lower.contains("no capable devices") {
                let _ = a2.emit("export-log", format!("FFmpeg {enc}: {line}"));
            }
            last = line;
        }
        last
    });
    let mut last_percent = u32::MAX;
    for line in BufReader::new(out).lines().flatten() {
        // FFmpeg reports out_time_ms in microseconds despite the legacy field name.
        if let Some(value) = line.strip_prefix("out_time_ms=") {
            if let Ok(us) = value.parse::<f64>() {
                if total_seconds.is_finite() && total_seconds > 0.0 {
                    let pct = ((us / 1_000_000.0 / total_seconds) * 100.0).round().clamp(0.0, 99.0) as u32;
                    if pct != last_percent {
                        last_percent = pct;
                        let _ = app.emit("export-log", format!("Encoding video ({encoder})… {pct}%"));
                    }
                }
            }
        } else if line == "progress=end" {
            let _ = app.emit("export-log", format!("Encoding video ({encoder})… 100%"));
        }
    }
    let status = ch.wait().map_err(|e| e.to_string())?;
    let last_error = err_thread.join().unwrap_or_else(|_| "FFmpeg error output unavailable".to_string());
    Ok((status, last_error))
}

fn dec(s: &str) -> String {
    let b = s.as_bytes();
    let (mut o, mut i) = (Vec::new(), 0);
    while i < b.len() {
        if b[i] == b'%' && i + 3 <= b.len() {
            if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) { o.push(v); i += 3; continue; }
        }
        o.push(b[i]); i += 1;
    }
    String::from_utf8_lossy(&o).into_owned()
}

fn dl(app: &AppHandle, url: &str, dest: &Path) -> Result<(), String> {
    if let Some(d) = dest.parent() { let _ = std::fs::create_dir_all(d); }
    let tmp = dest.with_extension("part");
    let mut c = Command::new("curl.exe");
    nowin(&mut c);
    c.args(["-L", "--fail", "-s", "-S", "-o"]).arg(&tmp).arg(url);
    let _ = app.emit("setup-log", format!("Downloading {url}"));
    let st = run_stream(app, "setup-log", c)?;
    if !st.success() { let _ = std::fs::remove_file(&tmp); return Err(format!("download failed ({st})")); }
    std::fs::rename(&tmp, dest).map_err(|e| e.to_string())
}

fn unzip(app: &AppHandle, zip: &Path, dest: &Path) -> Result<(), String> {
    let mut c = Command::new("powershell");
    nowin(&mut c);
    c.args(["-NoProfile", "-Command", &format!("Expand-Archive -LiteralPath '{}' -DestinationPath '{}' -Force", zip.display(), dest.display())]);
    if run_stream(app, "setup-log", c)?.success() { Ok(()) } else { Err("could not unzip".into()) }
}

fn find_file(dir: &Path, name: &str) -> Option<PathBuf> {
    for e in std::fs::read_dir(dir).ok()?.flatten() {
        let p = e.path();
        if p.is_dir() { if let Some(f) = find_file(&p, name) { return Some(f); } }
        else if p.file_name().map(|n| n.to_string_lossy().eq_ignore_ascii_case(name)).unwrap_or(false) { return Some(p); }
    }
    None
}

fn ensure_cpp_model(app: &AppHandle, model: &str) -> Result<PathBuf, String> {
    if !model.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_') { return Err("bad model name".into()); }
    let file = format!("ggml-{model}.bin");
    for d in [tools_dir().join("whisper"), exe_dir().join("whisper"), models_dir()] {
        let p = d.join(&file);
        if p.is_file() { return Ok(p); }
    }
    let total_mb: f64 = match model { "tiny" => 75.0, "base" => 142.0, "small" => 466.0, "medium" => 1530.0, "large-v3" => 3100.0, "large-v3-turbo" => 1620.0, "large-v3-turbo-q5_0" => 574.0, _ => 500.0 };
    let dir = models_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let dest = dir.join(&file);
    let tmp = dir.join(format!("{file}.part"));
    let mut c = Command::new("curl.exe");
    nowin(&mut c);
    let mut child = c.args(["-L", "--fail", "-s", "-o"]).arg(&tmp)
        .arg(format!("https://huggingface.co/ggerganov/whisper.cpp/resolve/main/{file}"))
        .spawn().map_err(|e| format!("curl not available: {e}"))?;
    loop {
        if let Some(st) = child.try_wait().map_err(|e| e.to_string())? {
            if !st.success() { let _ = std::fs::remove_file(&tmp); return Err(format!("model download failed ({st})")); }
            break;
        }
        let mb = std::fs::metadata(&tmp).map(|m| m.len() as f64 / 1048576.0).unwrap_or(0.0);
        let _ = app.emit("model-log", format!("{}", ((mb / total_mb) * 100.0).min(99.0) as u32));
        std::thread::sleep(std::time::Duration::from_millis(500));
    }
    std::fs::rename(&tmp, &dest).map_err(|e| e.to_string())?;
    Ok(dest)
}

// ---------------------------------------------------------------- environment check + installer
#[tauri::command]
async fn env_check() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let py = python();
        let mut pyver = Value::Null;
        let mut pkgs = json!({});
        if let Some((p, pre)) = &py {
            let mut c = Command::new(p);
            nowin(&mut c);
            if let Ok(o) = c.args(pre).arg("--version").output() {
                pyver = json!(format!("{}{}", String::from_utf8_lossy(&o.stdout).trim(), String::from_utf8_lossy(&o.stderr).trim()));
            }
            let script = std::env::temp_dir().join("ics_env.py");
            if std::fs::write(&script, include_str!("../env_check.py")).is_ok() {
                if let Some(mut c) = pycmd() {
                    if let Ok(o) = c.arg(&script).output() { pkgs = serde_json::from_slice::<Value>(&o.stdout).unwrap_or(json!({})); }
                }
            }
        }
        let yt = find_tool("yt-dlp");
        let ff = find_tool("ffmpeg");
        let ffsrc = ff.as_ref().map(|p| {
            let s = p.display().to_string();
            if s.contains("imageio_ffmpeg") { "found with moviepy" } else if s.starts_with(&tools_dir().display().to_string()) { "installed by this app" } else { "system" }
        });
        let wc = find_whisper_cli();
        let hub = hf_hub();
        let mut cm: Vec<&str> = vec![];
        if hub.join("models--CohereLabs--cohere-transcribe-03-2026").is_dir() { cm.push("general"); }
        if hub.join("models--CohereLabs--cohere-transcribe-arabic-07-2026").is_dir() { cm.push("arabic"); }
        let mut cver = String::new();
        if let Some(p) = cohere_python() {
            let mut c = Command::new(p);
            nowin(&mut c);
            if let Ok(o) = c.args(["-c", "import transformers;print(transformers.__version__)"]).output() {
                if o.status.success() { cver = String::from_utf8_lossy(&o.stdout).trim().to_string(); }
            }
        }
        let ok_rt = { let mut it = cver.split('.').filter_map(|x| x.parse::<u32>().ok()); match (it.next(), it.next()) { (Some(a), Some(b)) => a > 5 || (a == 5 && b >= 4), _ => false } };
        Ok(json!({
            "cohere": { "runtime": ok_rt, "version": cver, "models": cm, "token": ovr("hf_token").is_some() },
            "elevenlabs": { "key": ovr("elevenlabs_key").is_some() },
            "groq": { "key": ovr("groq_key").is_some() },
            "python": { "ok": py.is_some(), "version": pyver },
            "pkgs": pkgs,
            "yt_dlp": { "ok": yt.is_some() || pkgs["yt_dlp"] == true, "path": yt.map(|p| p.display().to_string()), "module": pkgs["yt_dlp"] == true },
            "ffmpeg": { "ok": ff.is_some(), "path": ff.map(|p| p.display().to_string()), "source": ffsrc },
            "whispercpp": { "ok": wc.is_some(), "path": wc.map(|p| p.display().to_string()) },
            "fw_models": fw_models(),
            "cpp_models": cpp_models(),
            "demucs_weights": demucs_weights(),
            "tools_dir": tools_dir().display().to_string(),
        }).to_string())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn install_tool(app: AppHandle, name: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let td = tools_dir();
        let log = |m: &str| { let _ = app.emit("setup-log", m.to_string()); };
        match name.as_str() {
            "ytdlp" => { dl(&app, "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe", &td.join("yt-dlp.exe"))?; }
            "ffmpeg" => {
                let zip = td.join("ffmpeg_dl.zip");
                let x = td.join("ffmpeg_x");
                dl(&app, "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip", &zip)?;
                log("Unpacking FFmpeg…");
                unzip(&app, &zip, &x)?;
                for n in ["ffmpeg.exe", "ffprobe.exe"] {
                    if let Some(f) = find_file(&x, n) { std::fs::copy(&f, td.join(n)).map_err(|e| e.to_string())?; }
                }
                let _ = std::fs::remove_dir_all(&x);
                let _ = std::fs::remove_file(&zip);
            }
            "whispercpp" => {
                let zip = td.join("whisper_dl.zip");
                let x = td.join("whisper_x");
                dl(&app, "https://github.com/ggml-org/whisper.cpp/releases/latest/download/whisper-bin-x64.zip", &zip)?;
                unzip(&app, &zip, &x)?;
                let exe = find_file(&x, "whisper-cli.exe").ok_or("whisper-cli.exe not found in the download")?;
                let dst = td.join("whisper");
                std::fs::create_dir_all(&dst).map_err(|e| e.to_string())?;
                for e in std::fs::read_dir(exe.parent().unwrap()).map_err(|e| e.to_string())?.flatten() {
                    if e.path().is_file() { let _ = std::fs::copy(e.path(), dst.join(e.file_name())); }
                }
                let _ = std::fs::remove_dir_all(&x);
                let _ = std::fs::remove_file(&zip);
            }
            "faster_whisper" | "demucs" => {
                let pkg = if name == "demucs" { "demucs" } else { "faster-whisper" };
                let mut c = pycmd().ok_or("Python not found")?;
                c.args(["-m", "pip", "install", "--upgrade", "--progress-bar", "off", pkg]);
                if !run_stream(&app, "setup-log", c)?.success() { return Err(format!("pip install {pkg} failed")); }
            }
            "python" => {
                let mut c = Command::new("winget");
                nowin(&mut c);
                c.args(["install", "-e", "--id", "Python.Python.3.12", "--accept-package-agreements", "--accept-source-agreements"]);
                if !run_stream(&app, "setup-log", c)?.success() { return Err("winget could not install Python".into()); }
                log("Python installed — restart the app so it is picked up.");
            }
            "cohere" => {
                let venv = local_app().join("cohere-venv");
                let mut c = pycmd().ok_or("Python not found")?;
                c.args(["-m", "venv", "--system-site-packages"]).arg(&venv);
                if !run_stream(&app, "setup-log", c)?.success() { return Err("could not create the Cohere Python environment".into()); }
                let vp = venv.join("Scripts").join("python.exe");
                let mut pk: Vec<&str> = vec!["transformers>=5.4.0", "accelerate", "soundfile", "librosa", "sentencepiece", "protobuf", "huggingface_hub"];
                if !py_has("torch") { pk.push("torch"); }
                let mut c = Command::new(&vp);
                nowin(&mut c);
                c.args(["-m", "pip", "install", "--upgrade", "--progress-bar", "off"]).args(&pk);
                if !run_stream(&app, "setup-log", c)?.success() { return Err("pip install for the Cohere runtime failed".into()); }
            }
            n if n.starts_with("cohere_model:") => {
                let id = &n[13..];
                if id != "CohereLabs/cohere-transcribe-03-2026" && id != "CohereLabs/cohere-transcribe-arabic-07-2026" { return Err("unknown model".into()); }
                let vp = cohere_python().ok_or("Install the Cohere runtime first")?;
                let tok = ovr("hf_token").ok_or("Add your Hugging Face token first (the Cohere models are gated)")?;
                let mut c = Command::new(vp);
                nowin(&mut c);
                c.args(["-c", &format!("from huggingface_hub import snapshot_download; print(snapshot_download('{id}'))")]).env("HF_TOKEN", tok);
                if !run_stream(&app, "setup-log", c)?.success() { return Err("model download failed — accept the model's terms on huggingface.co and check your token".into()); }
            }
            n if n.starts_with("fwmodel:") => {
                let m = &n[8..];
                if !m.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_') { return Err("bad model name".into()); }
                let mut c = pycmd().ok_or("Python not found")?;
                c.args(["-c", &format!("from faster_whisper import download_model; print(download_model('{m}'))")]);
                if !run_stream(&app, "setup-log", c)?.success() { return Err("model download failed".into()); }
            }
            n if n.starts_with("cppmodel:") => { ensure_cpp_model(&app, &n[9..])?; }
            _ => return Err("unknown item".into()),
        }
        Ok("ok".to_string())
    }).await.map_err(|e| e.to_string())?
}

// ---------------------------------------------------------------- files
#[tauri::command]
fn read_file(path: String) -> Result<Response, String> {
    std::fs::read(&path).map(Response::new).map_err(|e| format!("{path}: {e}"))
}

#[tauri::command]
fn write_file(request: Request<'_>) -> Result<(), String> {
    let InvokeBody::Raw(data) = request.body() else { return Err("no data".into()) };
    let p = request.headers().get("path").and_then(|h| h.to_str().ok()).map(dec).ok_or("no path header")?;
    if let Some(d) = Path::new(&p).parent() { let _ = std::fs::create_dir_all(d); }
    std::fs::write(&p, data).map_err(|e| format!("{p}: {e}"))
}

// MediaRecorder output can be hundreds of megabytes. Append each small chunk
// as it arrives instead of sending the entire finished video through IPC.
#[tauri::command]
fn append_file(request: Request<'_>) -> Result<(), String> {
    let InvokeBody::Raw(data) = request.body() else { return Err("no data".into()) };
    let p = request.headers().get("path").and_then(|h| h.to_str().ok()).map(dec).ok_or("no path header")?;
    if let Some(d) = Path::new(&p).parent() { std::fs::create_dir_all(d).map_err(|e| format!("{p}: {e}"))?; }
    let mut f = std::fs::OpenOptions::new().create(true).append(true).open(&p)
        .map_err(|e| format!("{p}: {e}"))?;
    f.write_all(data).map_err(|e| format!("{p}: {e}"))
}


#[tauri::command]
fn copy_file(source: String, destination: String) -> Result<(), String> {
    let src = Path::new(&source);
    if !src.is_file() { return Err(format!("Source media does not exist: {source}")); }
    if let Some(parent) = Path::new(&destination).parent() { std::fs::create_dir_all(parent).map_err(|e| e.to_string())?; }
    if src == Path::new(&destination) { return Ok(()); }
    std::fs::copy(&source, &destination).map(|_| ()).map_err(|e| format!("Could not copy media to {destination}: {e}"))
}
#[tauri::command]
fn ensure_dir(path: String) -> Result<(), String> {
    std::fs::create_dir_all(&path).map_err(|e| format!("Could not create directory {path}: {e}"))
}

#[tauri::command]
fn reveal(path: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        let mut c = Command::new("explorer");
        if Path::new(&path).is_file() { c.arg(format!("/select,{}", path)); } else { c.arg(&path); }
        c.spawn().map_err(|e| e.to_string())?;
    }
    #[cfg(not(windows))]
    { let _ = path; }
    Ok(())
}

// ---------------------------------------------------------------- yt-dlp
#[tauri::command]
fn ytdlp_version() -> Result<String, String> {
    let o = ytdlp_cmd()?.arg("--version").output().map_err(|e| format!("yt-dlp: {e}"))?;
    Ok(String::from_utf8_lossy(&o.stdout).trim().to_string())
}

#[tauri::command]
fn ytdlp_update() -> Result<String, String> {
    if find_tool("yt-dlp").is_some() {
        let o = ytdlp_cmd()?.arg("-U").output().map_err(|e| e.to_string())?;
        return Ok(format!("{}{}", String::from_utf8_lossy(&o.stdout), String::from_utf8_lossy(&o.stderr)).trim().to_string());
    }
    let mut c = pycmd().ok_or("Python not found")?;
    let o = c.args(["-m", "pip", "install", "-U", "yt-dlp"]).output().map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&o.stdout).lines().last().unwrap_or("").to_string())
}

#[tauri::command]
async fn ytdlp_download(app: AppHandle, url: String, fmt: String, dir: String, start: String, end: String) -> Result<String, String> {
    let (sel, extra): (&str, Vec<&str>) = match fmt.as_str() {
        "1080" => ("bv*[height<=1080]+ba/b[height<=1080]", vec!["--merge-output-format", "mp4"]),
        "720" => ("bv*[height<=720]+ba/b[height<=720]", vec!["--merge-output-format", "mp4"]),
        "audio" => ("ba/b", vec!["-x", "--audio-format", "mp3"]),
        _ => ("bv*+ba/b", vec!["--merge-output-format", "mp4"]),
    };
    let extra: Vec<String> = extra.into_iter().map(String::from).collect();
    let sel = sel.to_string();
    let san = |s: &str| s.trim().chars().filter(|c| c.is_ascii_alphanumeric() || *c == ':' || *c == '.').collect::<String>();
    let (s0, e0) = (san(&start), san(&end));
    tauri::async_runtime::spawn_blocking(move || {
        let mut c = ytdlp_cmd()?;
        let mut name = String::from("%(title).80s [%(id)s]");
        if !s0.is_empty() || !e0.is_empty() {
            let a = if s0.is_empty() { "0".to_string() } else { s0.clone() };
            let b = if e0.is_empty() { "inf".to_string() } else { e0.clone() };
            name.push_str(&format!(" {}-{}", a.replace(':', "."), b.replace(':', ".")));
            c.args(["--download-sections", &format!("*{a}-{b}"), "--force-keyframes-at-cuts"]);
        }
        name.push_str(".%(ext)s");
        c.args(["--newline", "--no-playlist", "--no-quiet", "--progress", "-f", &sel, "-P", &dir, "-o", &name, "--print", "after_move:filepath"]);
        if let Some(ff) = find_tool("ffmpeg") { c.arg("--ffmpeg-location").arg(&ff); }
        let mut child = c.args(&extra).arg(&url).stdout(Stdio::piped()).stderr(Stdio::piped())
            .spawn().map_err(|e| format!("could not start yt-dlp: {e}"))?;
        let err = child.stderr.take().unwrap();
        let a2 = app.clone();
        std::thread::spawn(move || { for l in BufReader::new(err).lines().flatten() { let _ = a2.emit("ytdlp-log", l); } });
        let mut last = String::new();
        for l in BufReader::new(child.stdout.take().unwrap()).lines().flatten() {
            if !l.starts_with('[') && !l.trim().is_empty() { last = l.clone(); }
            let _ = app.emit("ytdlp-log", l);
        }
        let st = child.wait().map_err(|e| e.to_string())?;
        if st.success() && !last.is_empty() { Ok(last) } else { Err(format!("yt-dlp exited with {st}")) }
    }).await.map_err(|e| e.to_string())?
}

// Probe a media duration for progress percentages; the frontend also supplies a hint
// when it already has metadata, so ffprobe is only a fallback.
fn probe_media_duration(path: &str) -> Option<f64> {
    let exe = find_tool("ffprobe")?;
    let mut c = Command::new(exe);
    nowin(&mut c);
    let output = c.args(["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1"])
        .arg(path).output().ok()?;
    if !output.status.success() { return None; }
    let d = String::from_utf8_lossy(&output.stdout).trim().parse::<f64>().ok()?;
    if d.is_finite() && d > 0.0 { Some(d) } else { None }
}

// FFmpeg extraction used to buffer all output and show a static "Extracting audio…"
// message. Read its progress pipe as it runs and keep a small stderr tail for failures.
fn run_ffmpeg_progress(app: &AppHandle, mut c: Command, total_seconds: Option<f64>) -> Result<(ExitStatus, String), String> {
    let mut child = c.stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().map_err(|e| format!("FFmpeg could not start: {e}"))?;
    let stdout = child.stdout.take().ok_or("FFmpeg stdout unavailable")?;
    let stderr = child.stderr.take().ok_or("FFmpeg stderr unavailable")?;
    let tail = Arc::new(Mutex::new(VecDeque::<String>::new()));
    let tail_for_thread = Arc::clone(&tail);
    let app_for_thread = app.clone();
    let stderr_thread = std::thread::spawn(move || {
        for line in BufReader::new(stderr).lines().flatten() {
            remember_line(&tail_for_thread, line.clone());
            let lower = line.to_lowercase();
            if lower.contains("error") || lower.contains("invalid") || lower.contains("failed") {
                let _ = app_for_thread.emit("whisper-log", format!("FFmpeg: {line}"));
            }
        }
    });
    let mut last_percent = u32::MAX;
    for line in BufReader::new(stdout).lines().flatten() {
        let timestamp = line.strip_prefix("out_time_us=").or_else(|| line.strip_prefix("out_time_ms="));
        if let Some(value) = timestamp {
            if let (Some(total), Ok(micros)) = (total_seconds, value.parse::<f64>()) {
                // FFmpeg's out_time_ms field is historically reported in microseconds.
                let pct = ((micros / 1_000_000.0 / total) * 100.0).round().clamp(0.0, 99.0) as u32;
                if pct != last_percent {
                    last_percent = pct;
                    let _ = app.emit("whisper-log", format!("extract-progress={pct}%"));
                }
            } else if last_percent == u32::MAX {
                let _ = app.emit("whisper-log", "extract-progress=working");
                last_percent = 0;
            }
        } else if line == "progress=end" {
            let _ = app.emit("whisper-log", "extract-progress=100%");
        }
    }
    let status = child.wait().map_err(|e| format!("FFmpeg wait failed: {e}"))?;
    let _ = stderr_thread.join();
    let detail = tail.lock().map(|lines| lines.iter().rev().take(12).cloned().collect::<Vec<_>>().into_iter().rev().collect::<Vec<_>>().join("\n"))
        .unwrap_or_else(|_| "Could not read FFmpeg diagnostics.".to_string());
    if status.success() { let _ = app.emit("whisper-log", "extract-progress=100%"); }
    Ok((status, detail))
}

#[tauri::command]
async fn media_duration(path: String) -> Result<f64, String> {
    tauri::async_runtime::spawn_blocking(move || probe_media_duration(&path).ok_or_else(|| format!("Could not determine media duration: {path}")))
        .await.map_err(|e| e.to_string())?
}

// Create a timed source clip from a still image and audio so the preview has the right
// duration. The selected original audio is also passed separately to final export, where
// the app applies its normal audio-processing chain without re-encoding the preview audio.
#[tauri::command]
async fn make_background_video(image: String, audio: String, duration: f64, width: u32, height: u32, out: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if !Path::new(&image).is_file() { return Err(format!("Background image not found: {image}")); }
        if !Path::new(&audio).is_file() { return Err(format!("Audio source not found: {audio}")); }
        if !duration.is_finite() || duration <= 0.0 || duration > 43_200.0 { return Err("Audio duration is missing or outside the supported range (0–12 hours).".into()); }
        let w = ((width.clamp(320, 2160)) / 2) * 2;
        let h = ((height.clamp(320, 3840)) / 2) * 2;
        let vf = format!("scale={w}:{h}:force_original_aspect_ratio=decrease,pad={w}:{h}:(ow-iw)/2:(oh-ih)/2,setsar=1");
        let mut c = ffmpeg()?;
        c.args(["-y", "-hide_banner", "-loglevel", "error", "-loop", "1", "-framerate", "30", "-i", &image, "-i", &audio, "-t", &duration.to_string(), "-vf", &vf, "-r", "30", "-map", "0:v:0", "-map", "1:a:0", "-c:v", "libx264", "-preset", "ultrafast", "-tune", "stillimage", "-crf", "28", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart"]).arg(&out);
        let output = c.output().map_err(|e| format!("FFmpeg could not create the background clip: {e}"))?;
        if !output.status.success() {
            let detail = String::from_utf8_lossy(&output.stderr).lines().rev().take(8).collect::<Vec<_>>().into_iter().rev().collect::<Vec<_>>().join("\n");
            return Err(format!("Could not create the timed background clip. {detail}"));
        }
        Ok(out)
    }).await.map_err(|e| e.to_string())?
}


// Loop a selected video until the external audio duration, producing a normal MP4 source
// so the preview, timeline and existing export pipeline all use the same exact duration.
#[tauri::command]
async fn make_looped_background_video(video: String, duration: f64, width: u32, height: u32, out: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if !Path::new(&video).is_file() { return Err(format!("Background video not found: {video}")); }
        if !duration.is_finite() || duration <= 0.0 || duration > 43_200.0 { return Err("Audio duration is missing or outside the supported range (0–12 hours).".into()); }
        let w = ((width.clamp(320, 2160)) / 2) * 2;
        let h = ((height.clamp(320, 3840)) / 2) * 2;
        let vf = format!("scale={w}:{h}:force_original_aspect_ratio=decrease,pad={w}:{h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30");
        let mut c = ffmpeg()?;
        c.args(["-y", "-hide_banner", "-loglevel", "error", "-stream_loop", "-1", "-i", &video, "-t", &duration.to_string(), "-an", "-vf", &vf, "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart"]).arg(&out);
        let output = c.output().map_err(|e| format!("FFmpeg could not loop the background video: {e}"))?;
        if !output.status.success() {
            let detail = String::from_utf8_lossy(&output.stderr).lines().rev().take(8).collect::<Vec<_>>().into_iter().rev().collect::<Vec<_>>().join("\n");
            return Err(format!("Could not loop the background video. {detail}"));
        }
        Ok(out)
    }).await.map_err(|e| e.to_string())?
}

// ---------------------------------------------------------------- ElevenLabs Scribe helpers
fn curl_with_api_key(args: &[String], api_key: &str) -> Result<(u16, String, String), String> {
    let safe_key: String = api_key.trim().chars().filter(|c| *c != '"' && *c != '\r' && *c != '\n').collect();
    if safe_key.is_empty() {
        return Err("ElevenLabs API key is empty.".into());
    }
    let mut c = Command::new("curl.exe");
    nowin(&mut c);
    c.args(["-s", "-S", "-L", "-K", "-"])
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = c.spawn().map_err(|e| format!("Could not start curl.exe: {e}"))?;
    if let Some(mut stdin) = child.stdin.take() {
        let cfg = format!("header = \"xi-api-key: {safe_key}\"\n");
        let _ = stdin.write_all(cfg.as_bytes());
    }
    let out = child.wait_with_output().map_err(|e| format!("curl.exe failed: {e}"))?;
    let stdout = String::from_utf8_lossy(&out.stdout).to_string();
    let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
    if !out.status.success() && stdout.trim().is_empty() {
        return Err(if stderr.is_empty() { format!("Network request failed ({})", out.status) } else { stderr });
    }
    let code = stdout.trim().parse::<u16>().unwrap_or(0);
    Ok((code, stdout, stderr))
}

fn elevenlabs_words_to_segments(words: &[Value], fallback_text: &str, total_duration: Option<f64>, tag_audio_events: bool, max_words: usize) -> Vec<Value> {
    let mut tokens: Vec<(f64, f64, String, String)> = Vec::new();
    for item in words {
        let kind = item.get("type").and_then(|v| v.as_str()).unwrap_or("word");
        if kind == "spacing" { continue; }
        if kind == "audio_event" && !tag_audio_events { continue; }
        let text = item.get("text").and_then(|v| v.as_str()).unwrap_or("").trim();
        if text.is_empty() { continue; }
        let s = item.get("start").and_then(|v| v.as_f64()).unwrap_or(0.0);
        let e = item.get("end").and_then(|v| v.as_f64()).unwrap_or(s + 0.2).max(s + 0.02);
        let spk = item.get("speaker_id").and_then(|v| v.as_str()).unwrap_or("").to_string();
        tokens.push((s, e, text.to_string(), spk));
    }
    if tokens.is_empty() {
        let txt = fallback_text.trim();
        if txt.is_empty() { return vec![]; }
        let end = total_duration.filter(|v| v.is_finite() && *v > 0.0).unwrap_or(5.0);
        return vec![json!({ "s": 0.0, "e": end, "t": txt })];
    }
    let sentence_end = ['.', '?', '!', '؟', '۔', '…', ';', '؛', '।'];
    let mut segs: Vec<Value> = Vec::new();
    let mut cur: Vec<(f64, f64, String, String)> = Vec::new();
    let flush = |buf: &mut Vec<(f64, f64, String, String)>, out: &mut Vec<Value>| {
        if buf.is_empty() { return; }
        let s = buf.first().map(|x| x.0).unwrap_or(0.0);
        let e = buf.last().map(|x| x.1).unwrap_or(s + 0.5);
        let t = buf.iter().map(|x| x.2.as_str()).collect::<Vec<_>>().join(" ");
        let w: Vec<Value> = buf.iter().map(|x| json!({ "w": x.2, "s": x.0, "e": x.1 })).collect();
        out.push(json!({ "s": s, "e": e, "t": t, "w": w }));
        buf.clear();
    };
    for tok in tokens {
        if let Some(prev) = cur.last() {
            let gap = (tok.0 - prev.1).max(0.0);
            let ends_sentence = prev.2.trim_end().chars().last().map(|c| sentence_end.contains(&c)).unwrap_or(false);
            let speaker_changed = !prev.3.is_empty() && !tok.3.is_empty() && prev.3 != tok.3;
            let cur_dur = tok.1 - cur[0].0;
            let cur_chars: usize = cur.iter().map(|x| x.2.chars().count() + 1).sum();
            let word_limit = (if max_words > 0 { max_words } else { 12 }).saturating_mul(2).max(24);
            if (ends_sentence && cur.len() >= 6) || speaker_changed || gap >= 1.6 || cur.len() >= word_limit || cur_chars >= 220 || cur_dur >= 14.0 {
                flush(&mut cur, &mut segs);
            }
        }
        cur.push(tok);
    }
    flush(&mut cur, &mut segs);
    segs
}

#[tauri::command]
async fn test_elevenlabs(key: Option<String>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let api_key = key.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).or_else(|| ovr("elevenlabs_key"))
            .ok_or("Add your ElevenLabs API key first.")?;
        let tmp = std::env::temp_dir();
        let nonce = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_micros()).unwrap_or_default();
        let out_file = tmp.join(format!("ics_el_test_{}_{}.json", std::process::id(), nonce));
        let args = vec![
            "-o".to_string(), out_file.display().to_string(),
            "-w".to_string(), "%{http_code}".to_string(),
            "https://api.elevenlabs.io/v1/user/subscription".to_string(),
        ];
        let res = curl_with_api_key(&args, &api_key);
        let body = std::fs::read_to_string(&out_file).unwrap_or_default();
        let _ = std::fs::remove_file(&out_file);
        let (code, _, stderr) = res?;
        let parsed: Value = serde_json::from_str(&body).unwrap_or(Value::Null);
        if code >= 200 && code < 300 {
            let tier = parsed.get("tier").and_then(|v| v.as_str()).unwrap_or("connected");
            let used = parsed.get("character_count").and_then(|v| v.as_u64());
            let limit = parsed.get("character_limit").and_then(|v| v.as_u64());
            if let (Some(u), Some(l)) = (used, limit) {
                return Ok(format!("Connected ({tier} · {u}/{l} chars)"));
            }
            return Ok(format!("Connected ({tier})"));
        }
        let msg = parsed.get("detail").and_then(|d| d.get("message").or(Some(d))).and_then(|v| v.as_str())
            .or_else(|| parsed.get("error").and_then(|v| v.as_str()))
            .unwrap_or(if stderr.is_empty() { body.trim() } else { &stderr });
        Err(format!("ElevenLabs HTTP {code}: {msg}"))
    }).await.map_err(|e| e.to_string())?
}

fn curl_with_bearer(args: &[String], api_key: &str) -> Result<(u16, String, String), String> {
    let safe_key: String = api_key.trim().chars().filter(|c| *c != '"' && *c != '\r' && *c != '\n').collect();
    if safe_key.is_empty() {
        return Err("API key is empty.".into());
    }
    let mut c = Command::new("curl.exe");
    nowin(&mut c);
    c.args(["-s", "-S", "-L", "-K", "-"])
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = c.spawn().map_err(|e| format!("Could not start curl.exe: {e}"))?;
    if let Some(mut stdin) = child.stdin.take() {
        let cfg = format!("header = \"Authorization: Bearer {safe_key}\"\n");
        let _ = stdin.write_all(cfg.as_bytes());
    }
    let out = child.wait_with_output().map_err(|e| format!("curl.exe failed: {e}"))?;
    let stdout = String::from_utf8_lossy(&out.stdout).to_string();
    let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
    if !out.status.success() && stdout.trim().is_empty() {
        return Err(if stderr.is_empty() { format!("Network request failed ({})", out.status) } else { stderr });
    }
    let code = stdout.trim().parse::<u16>().unwrap_or(0);
    Ok((code, stdout, stderr))
}

fn norm_word_tok(w: &str) -> String {
    w.chars().filter(|c| c.is_alphanumeric()).flat_map(|c| c.to_lowercase()).collect()
}

fn groq_words_to_segments(words: &[(f64, f64, String)], fallback_text: &str, max_words: usize) -> Vec<Value> {
    if words.is_empty() {
        let t = fallback_text.trim();
        return if t.is_empty() { vec![] } else { vec![json!({ "s": 0.0, "e": 4.0, "t": t, "w": [] })] };
    }
    let container_max = (max_words.max(3) * 2).max(24);
    let mut segs: Vec<Value> = Vec::new();
    let mut cur: Vec<(f64, f64, String)> = Vec::new();
    let flush = |cur: &mut Vec<(f64, f64, String)>, segs: &mut Vec<Value>| {
        if cur.is_empty() { return; }
        let s = cur[0].0;
        let e = cur[cur.len() - 1].1;
        let text = cur.iter().map(|x| x.2.as_str()).collect::<Vec<_>>().join(" ");
        let ws: Vec<Value> = cur.iter().map(|(ws, we, wt)| json!({ "w": wt, "s": ws, "e": we })).collect();
        segs.push(json!({ "s": s, "e": e, "t": text, "w": ws }));
        cur.clear();
    };
    for (s, e, text) in words {
        let prev_end = cur.last().map(|x| x.1).unwrap_or(*s);
        let gap = *s - prev_end;
        if !cur.is_empty() && (cur.len() >= container_max || gap >= 1.6) {
            flush(&mut cur, &mut segs);
        }
        cur.push((*s, *e, text.clone()));
        if cur.len() >= 6 && text.ends_with(['.', '!', '?', '؟', '۔', '…']) {
            flush(&mut cur, &mut segs);
        }
    }
    flush(&mut cur, &mut segs);
    segs
}

// ---------------------------------------------------------------- transcription (faster-whisper, Cohere Transcribe, ElevenLabs Scribe, Groq Whisper, or whisper.cpp)
#[tauri::command]
async fn transcribe(app: AppHandle, input: String, lang: String, maxlen: u32, max_words: Option<u32>, translate: bool, model: String, prompt: String, ctx: bool, det: bool, engine: String, duration_hint: Option<f64>, diarize: Option<bool>, tag_audio_events: Option<bool>, elevenlabs_key: Option<String>, groq_key: Option<String>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let tmp = std::env::temp_dir();
        let nonce = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_micros()).unwrap_or_default();
        let total = duration_hint.filter(|v| v.is_finite() && *v > 0.0).or_else(|| probe_media_duration(&input));
        let _ = app.emit("whisper-log", "extract-progress=0%");

        if engine == "groq" {
            let api_key = groq_key.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).or_else(|| ovr("groq_key"))
                .ok_or("Add your Groq API key in Subtitles or Settings first.")?;
            let model_id = if model.trim().is_empty() || model == "auto" { "whisper-large-v3".to_string() } else { model.trim().to_string() };
            let total_dur = total.unwrap_or(0.0);
            let chunk_sec: f64 = 540.0; // 9-min chunks (~4.3 MB at 64kbps MP3, well below Groq 25 MB limit)
            let overlap_sec: f64 = 4.0;
            let mut ranges: Vec<(f64, f64)> = Vec::new();
            if total_dur <= chunk_sec || total_dur <= 0.0 {
                ranges.push((0.0, total_dur));
            } else {
                let step = chunk_sec - overlap_sec;
                let mut t0 = 0.0;
                while t0 < total_dur {
                    let t1 = (t0 + chunk_sec).min(total_dur);
                    ranges.push((t0, t1));
                    if t1 >= total_dur { break; }
                    t0 += step;
                }
            }

            let mut all_words: Vec<(f64, f64, String)> = Vec::new();
            let mut fallback_texts: Vec<String> = Vec::new();
            let mut detected_lang = String::new();
            let mut failed_chunks: Vec<String> = Vec::new();
            let n_chunks = ranges.len();

            for (ci, (t0, t1)) in ranges.iter().enumerate() {
                let chunk_mp3 = tmp.join(format!("ics_groq_{}_{}_{}.mp3", std::process::id(), nonce, ci));
                let mut ext = ffmpeg()?;
                let mut ff_args: Vec<String> = vec!["-y".into(), "-hide_banner".into(), "-loglevel".into(), "error".into()];
                if *t0 > 0.0 {
                    ff_args.push("-ss".into());
                    ff_args.push(format!("{:.3}", t0));
                }
                if *t1 > *t0 {
                    ff_args.push("-t".into());
                    ff_args.push(format!("{:.3}", t1 - t0));
                }
                ff_args.extend(["-i".into(), input.clone(), "-vn".into(), "-ac".into(), "1".into(), "-ar".into(), "16000".into(), "-c:a".into(), "libmp3lame".into(), "-b:a".into(), "64k".into(), chunk_mp3.display().to_string()]);
                ext.args(&ff_args);
                let out_ext = ext.output().map_err(|e| format!("Audio chunking failed: {e}"))?;
                if !out_ext.status.success() || !chunk_mp3.is_file() {
                    let err_msg = String::from_utf8_lossy(&out_ext.stderr);
                    let _ = std::fs::remove_file(&chunk_mp3);
                    failed_chunks.push(format!("chunk {}: audio extraction failed ({})", ci + 1, err_msg.trim()));
                    continue;
                }

                let _ = app.emit("whisper-log", format!("phase=uploading-groq:{}/{}", ci + 1, n_chunks));
                let out_json = tmp.join(format!("ics_groq_resp_{}_{}_{}.json", std::process::id(), nonce, ci));
                let mut args: Vec<String> = vec![
                    "-X".into(), "POST".into(),
                    "-o".into(), out_json.display().to_string(),
                    "-w".into(), "%{http_code}".into(),
                    "-F".into(), format!("file=@{};type=audio/mpeg;filename=audio.mp3", chunk_mp3.display()),
                    "-F".into(), format!("model={model_id}"),
                    "-F".into(), "response_format=verbose_json".into(),
                    "-F".into(), "timestamp_granularities[]=word".into(),
                    "-F".into(), "timestamp_granularities[]=segment".into(),
                    "-F".into(), "temperature=0".into(),
                ];
                let lang_trim = lang.trim();
                if !lang_trim.is_empty() && lang_trim != "auto" {
                    args.push("-F".into());
                    args.push(format!("language={lang_trim}"));
                }
                if !prompt.trim().is_empty() {
                    let clipped: String = prompt.trim().chars().take(400).collect();
                    args.push("-F".into());
                    args.push(format!("prompt={clipped}"));
                }
                args.push("https://api.groq.com/openai/v1/audio/transcriptions".into());

                let mut parsed_ok: Option<Value> = None;
                let mut last_err = String::new();
                for attempt in 0..3 {
                    let curl_res = curl_with_bearer(&args, &api_key);
                    let body = std::fs::read_to_string(&out_json).unwrap_or_default();
                    match curl_res {
                        Ok((code, _, _stderr)) if code >= 200 && code < 300 => {
                            if let Ok(v) = serde_json::from_str::<Value>(&body) {
                                parsed_ok = Some(v);
                                break;
                            } else {
                                last_err = format!("Invalid JSON from Groq (HTTP {code})");
                            }
                        }
                        Ok((code, _, stderr)) => {
                            let parsed: Value = serde_json::from_str(&body).unwrap_or(Value::Null);
                            let msg = parsed.get("error").and_then(|e| e.get("message").or(Some(e))).and_then(|v| v.as_str())
                                .unwrap_or(if stderr.is_empty() { body.trim() } else { &stderr });
                            last_err = format!("Groq HTTP {code}: {msg}");
                            if code != 429 && code < 500 { break; }
                        }
                        Err(e) => {
                            last_err = e;
                        }
                    }
                    if attempt < 2 {
                        std::thread::sleep(std::time::Duration::from_millis(1200 * (1 << attempt)));
                    }
                }
                let _ = std::fs::remove_file(&chunk_mp3);
                let _ = std::fs::remove_file(&out_json);

                let Some(parsed) = parsed_ok else {
                    failed_chunks.push(format!("chunk {}: {}", ci + 1, last_err));
                    continue;
                };

                if detected_lang.is_empty() {
                    detected_lang = parsed.get("language").and_then(|v| v.as_str()).unwrap_or("").to_string();
                }
                let txt = parsed.get("text").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
                if !txt.is_empty() { fallback_texts.push(txt); }

                let prev_end = all_words.last().map(|w| w.1).unwrap_or(-1.0);
                let words_arr = parsed.get("words").and_then(|v| v.as_array()).map(|v| v.as_slice()).unwrap_or(&[]);
                for w in words_arr {
                    let wt = w.get("word").or_else(|| w.get("text")).and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
                    if wt.is_empty() { continue; }
                    let ws = w.get("start").and_then(|v| v.as_f64()).unwrap_or(0.0) + *t0;
                    let we = (w.get("end").and_then(|v| v.as_f64()).unwrap_or(ws + 0.15) + *t0).max(ws + 0.04);
                    if ci > 0 && prev_end > 0.0 && ws < prev_end + 0.35 {
                        let tail = all_words.iter().rev().take(8).any(|pw| (pw.0 - ws).abs() < 1.2 && !norm_word_tok(&pw.2).is_empty() && norm_word_tok(&pw.2) == norm_word_tok(&wt));
                        if tail || we <= prev_end - 0.1 { continue; }
                    }
                    all_words.push((ws, we, wt));
                }
            }

            if all_words.is_empty() && fallback_texts.is_empty() && !failed_chunks.is_empty() {
                return Err(failed_chunks.join("; "));
            }
            let mw = max_words.unwrap_or(12) as usize;
            let segs = groq_words_to_segments(&all_words, &fallback_texts.join(" "), mw);
            let _ = app.emit("whisper-log", "progress = 100%");
            return Ok(json!({ "segments": segs, "engine": "groq", "model": model_id, "language_code": detected_lang, "failed_chunks": failed_chunks }).to_string());
        }

        if engine == "elevenlabs" {
            let api_key = elevenlabs_key.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).or_else(|| ovr("elevenlabs_key"))
                .ok_or("Add your ElevenLabs API key in Auto Subtitles or Setup first.")?;
            let model_id = match model.as_str() {
                "scribe_v1" => "scribe_v1",
                _ => "scribe_v2",
            };
            let mp3 = tmp.join(format!("ics_el_{}_{}.mp3", std::process::id(), nonce));
            let wav = tmp.join(format!("ics_el_{}_{}.wav", std::process::id(), nonce));
            let mut extract_mp3 = ffmpeg()?;
            extract_mp3.args(["-y", "-hide_banner", "-loglevel", "error", "-i", &input, "-map", "0:a:0", "-vn", "-ac", "1", "-ar", "16000", "-c:a", "libmp3lame", "-b:a", "64k", "-progress", "pipe:1", "-nostats"]).arg(&mp3);
            let (st_mp3, err_mp3) = run_ffmpeg_progress(&app, extract_mp3, total)?;
            let upload_path = if st_mp3.success() && mp3.is_file() {
                mp3.clone()
            } else {
                let _ = std::fs::remove_file(&mp3);
                let mut extract_wav = ffmpeg()?;
                extract_wav.args(["-y", "-hide_banner", "-loglevel", "error", "-i", &input, "-map", "0:a:0", "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", "-progress", "pipe:1", "-nostats"]).arg(&wav);
                let (st_wav, err_wav) = run_ffmpeg_progress(&app, extract_wav, total)?;
                if !st_wav.success() {
                    let detail = if err_wav.trim().is_empty() { err_mp3 } else { err_wav };
                    return Err(format!("Audio extraction failed for '{}'. Check that the file contains an audio track.\n{}", input, detail));
                }
                wav.clone()
            };
            let _ = app.emit("whisper-log", format!("phase=uploading-elevenlabs:{model_id}"));
            let out_json = tmp.join(format!("ics_el_resp_{}_{}.json", std::process::id(), nonce));
            let el_mime = if upload_path.extension().and_then(|s| s.to_str()) == Some("mp3") { "audio/mpeg" } else { "audio/wav" };
            let el_fname = upload_path.file_name().and_then(|s| s.to_str()).unwrap_or("audio.mp3");
            let mut args: Vec<String> = vec![
                "-X".into(), "POST".into(),
                "-o".into(), out_json.display().to_string(),
                "-w".into(), "%{http_code}".into(),
                "-F".into(), format!("file=@{};type={};filename={}", upload_path.display(), el_mime, el_fname),
                "-F".into(), format!("model_id={model_id}"),
                "-F".into(), "timestamps_granularity=word".into(),
                "-F".into(), format!("tag_audio_events={}", if tag_audio_events.unwrap_or(false) { "true" } else { "false" }),
                "-F".into(), format!("diarize={}", if diarize.unwrap_or(false) { "true" } else { "false" }),
            ];
            let lang_trim = lang.trim();
            if !lang_trim.is_empty() && lang_trim != "auto" {
                args.push("-F".into());
                args.push(format!("language_code={lang_trim}"));
            }
            if model_id == "scribe_v2" && !prompt.trim().is_empty() {
                for term in prompt.split(|c| c == ',' || c == '\n' || c == ';').map(|s| s.trim().trim_start_matches(|c| c == '@' || c == '<')).filter(|s| !s.is_empty()).take(100) {
                    let clipped: String = term.chars().take(50).collect();
                    args.push("-F".into());
                    args.push(format!("keyterms={clipped}"));
                }
            }
            args.push("https://api.elevenlabs.io/v1/speech-to-text".into());
            let curl_res = curl_with_api_key(&args, &api_key);
            let _ = std::fs::remove_file(&mp3);
            let _ = std::fs::remove_file(&wav);
            let body = std::fs::read_to_string(&out_json).unwrap_or_default();
            let _ = std::fs::remove_file(&out_json);
            let (code, _, stderr) = curl_res?;
            let parsed: Value = serde_json::from_str(&body).map_err(|e| {
                let preview: String = body.chars().take(300).collect();
                format!("Invalid JSON from ElevenLabs (HTTP {code}): {e}\n{preview}")
            })?;
            if code < 200 || code >= 300 {
                let msg = parsed.get("detail").and_then(|d| d.get("message").or(Some(d))).and_then(|v| v.as_str())
                    .or_else(|| parsed.get("error").and_then(|v| v.as_str()))
                    .unwrap_or(if stderr.is_empty() { body.trim() } else { &stderr });
                return Err(format!("ElevenLabs Scribe failed (HTTP {code}): {msg}"));
            }
            let words = parsed.get("words").and_then(|v| v.as_array()).map(|v| v.as_slice()).unwrap_or(&[]);
            let fallback_text = parsed.get("text").and_then(|v| v.as_str()).unwrap_or("");
            let mw = max_words.unwrap_or(8) as usize;
            let segs = elevenlabs_words_to_segments(words, fallback_text, total, tag_audio_events.unwrap_or(false), mw);
            let detected = parsed.get("language_code").and_then(|v| v.as_str()).unwrap_or("");
            let _ = app.emit("whisper-log", "progress = 100%");
            return Ok(json!({ "segments": segs, "engine": "elevenlabs", "model": model_id, "language_code": detected }).to_string());
        }

        let wav = tmp.join(format!("ics_audio_{}_{}.wav", std::process::id(), nonce));
        let mut extract = ffmpeg()?;
        extract.args(["-y", "-hide_banner", "-loglevel", "error", "-i", &input, "-map", "0:a:0", "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", "-progress", "pipe:1", "-nostats"]).arg(&wav);
        let (extract_status, extract_detail) = run_ffmpeg_progress(&app, extract, total)?;
        if !extract_status.success() {
            let detail = if extract_detail.trim().is_empty() { "No FFmpeg diagnostic output was captured.".to_string() } else { extract_detail };
            return Err(format!("Audio extraction failed for '{}'. Check that the file contains an audio track and is readable.\n{}", input, detail));
        }
        let _ = app.emit("whisper-log", "phase=loading-model");
        if engine == "cohere" {
            let mid = match lang.as_str() {
                "ar" => "CohereLabs/cohere-transcribe-arabic-07-2026",
                "en" => "CohereLabs/cohere-transcribe-03-2026",
                _ => return Err("Cohere Transcribe supports English and Arabic only (it has no Urdu). Pick a Whisper engine for this language.".into()),
            };
            let vpy = cohere_python().ok_or("Cohere runtime is not installed - open Setup and install it")?;
            let tok = ovr("hf_token").ok_or("Add your Hugging Face token in Setup (the Cohere models are gated)")?;
            let script = tmp.join("ics_cohere.py");
            let argf = tmp.join("ics_cohere_args.json");
            let outj = tmp.join("ics_cohere.json");
            let _ = std::fs::remove_file(&outj);
            std::fs::write(&script, include_str!("../cohere_run.py")).map_err(|e| e.to_string())?;
            std::fs::write(&argf, json!({"audio": wav.display().to_string(), "out": outj.display().to_string(), "model_id": mid, "lang": lang}).to_string()).map_err(|e| e.to_string())?;
            let mut c = Command::new(vpy);
            nowin(&mut c);
            c.arg(&script).arg(&argf).env("HF_TOKEN", tok).env("PYTHONIOENCODING", "utf-8").env("PYTHONUTF8", "1").env("HF_HUB_DISABLE_SYMLINKS_WARNING", "1");
            let (st, lines) = run_stream_capture(&app, "whisper-log", c)?;
            let _ = std::fs::remove_file(&wav);
            if !st.success() {
                let detail = lines.iter().rev().take(24).rev().map(|line| {
                    let shortened = line.chars().take(900).collect::<String>();
                    if line.chars().count() > 900 { format!("{shortened}… [line shortened]") } else { shortened }
                }).collect::<Vec<_>>().join("\n");
                let lower = detail.to_lowercase();
                let likely_cause = if lower.contains("gated repo") || lower.contains("gated model") || lower.contains("401") || lower.contains("403") || lower.contains("access to model") {
                    "Hugging Face denied model access. Open the exact model page while logged in, accept its conditions, and use a Read token from that same account."
                } else if lower.contains("out of memory") || lower.contains("cuda error") || lower.contains("cuda out of memory") {
                    "This looks like a GPU-memory/runtime failure. Close GPU-heavy apps and retry; the updated runner uses smaller batches on low-VRAM GPUs."
                } else if lower.contains("no module named") || lower.contains("modulenotfounderror") || lower.contains("importerror") {
                    "A Python package is missing or incompatible. Open Setup and reinstall the Cohere Transcribe runtime."
                } else if lower.contains("connectionerror") || lower.contains("timeout") || lower.contains("could not connect") || lower.contains("network is unreachable") {
                    "This looks like a network/download failure. Check the connection and retry after the model files finish downloading."
                } else { "The diagnostic output below contains the underlying Python/Hugging Face error." };
                return Err(format!("Cohere Transcribe failed ({st}).\n{likely_cause}\n\nDiagnostic output (latest lines):\n{}", if detail.trim().is_empty() { "No Python output was captured. Reinstall the Cohere runtime and retry." } else { &detail }));
            }
            let segs: Value = serde_json::from_str(&std::fs::read_to_string(&outj).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
            return Ok(json!({ "segments": segs, "engine": "cohere" }).to_string());
        }
        let use_faster = match engine.as_str() { "faster" => true, "cpp" => false, _ => model != "large-v3-turbo-q5_0" && py_has("faster_whisper") };
        if use_faster {
            let script = tmp.join("ics_whisper.py");
            let argf = tmp.join("ics_whisper_args.json");
            let outj = tmp.join("ics_sub.json");
            let _ = std::fs::remove_file(&outj);
            std::fs::write(&script, include_str!("../whisper_run.py")).map_err(|e| e.to_string())?;
            std::fs::write(&argf, json!({"audio": wav.display().to_string(), "out": outj.display().to_string(), "model": model, "lang": lang, "maxlen": maxlen, "max_words": max_words.unwrap_or(8), "prompt": prompt, "ctx": ctx, "det": det, "translate": translate}).to_string()).map_err(|e| e.to_string())?;
            let mut c = pycmd().ok_or("Python not found — choose the whisper.cpp engine or install Python in Setup")?;
            c.arg(&script).arg(&argf).env("PYTHONIOENCODING", "utf-8").env("PYTHONUTF8", "1");
            let st = run_stream(&app, "whisper-log", c)?;
            let _ = std::fs::remove_file(&wav);
            if !st.success() { return Err(format!("faster-whisper failed ({st}) — see Setup")); }
            let segs: Value = serde_json::from_str(&std::fs::read_to_string(&outj).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
            return Ok(json!({ "segments": segs }).to_string());
        }
        // whisper.cpp
        let mp = ensure_cpp_model(&app, if model == "auto" { "small" } else { model.as_str() })?;
        let wexe = find_whisper_cli().ok_or("whisper.cpp not installed — open Setup and press Install missing")?;
        let prefix = tmp.join("ics_sub");
        let srt = tmp.join("ics_sub.srt");
        let _ = std::fs::remove_file(&srt);
        let mut c = Command::new(&wexe);
        nowin(&mut c);
        if let Some(d) = wexe.parent() { c.current_dir(d); }
        c.arg("-m").arg(&mp).arg("-f").arg(&wav).args(["-l", &lang, "-osrt", "-pp", "-of"]).arg(&prefix);
        if maxlen > 0 { c.args(["-ml", &maxlen.to_string(), "-sow"]); }
        if translate { c.arg("-tr"); }
        if !prompt.trim().is_empty() { c.arg("--prompt").arg(prompt.trim()); }
        if !ctx { c.args(["-mc", "0"]); }
        if det { c.args(["-tp", "0.0", "-nf"]); }
        let st = run_stream(&app, "whisper-log", c)?;
        let _ = std::fs::remove_file(&wav);
        if !st.success() { return Err(format!("whisper exited with {st}")); }
        let text = std::fs::read_to_string(&srt).map_err(|e| format!("no subtitle output: {e}"))?;
        Ok(json!({ "srt": text }).to_string())
    }).await.map_err(|e| e.to_string())?
}

// ---------------------------------------------------------------- final render: audio chain + MP4 encode
#[tauri::command]
async fn finalize_export(app: AppHandle, video: String, source: String, audio_source: String, start: f64, dur: f64, speed: f64, enhance: bool, pre: String, vocals: bool, demucs: String, crf: u32, out: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let log = |m: &str| { let _ = app.emit("export-log", m.to_string()); };
        let work = PathBuf::from(&out).parent().map(|p| p.to_path_buf()).unwrap_or_else(std::env::temp_dir);
        let wav = work.join("audio_work.wav");
        let speed = if speed.is_finite() && speed >= 0.5 && speed <= 2.0 { speed } else { 1.0 };
        let base_audio = if audio_source.trim().is_empty() { source.clone() } else { audio_source.clone() };
        let mut src = if pre.trim().is_empty() { base_audio.clone() } else { pre.clone() };
        let mut trimmed = false;
        if vocals && pre.trim().is_empty() {
            log("Extracting audio for vocal isolation…");
            let hq = work.join("audio_hq.wav");
            let o = ffmpeg()?.args(["-y", "-ss", &start.to_string(), "-t", &dur.to_string(), "-i", &base_audio, "-vn", "-ac", "2", "-ar", "44100"]).arg(&hq).output().map_err(|e| format!("ffmpeg: {e}"))?;
            if o.status.success() {
                let sep = work.join("demucs_separated");
                let mut got: Option<PathBuf> = None;
                for dev in ["cuda", "cpu"] {
                    log(&format!("Demucs ({demucs}) on {dev}… this can take a while"));
                    if let Some(mut c) = pycmd() {
                        let r = c.args(["-m", "demucs.separate", "--two-stems", "vocals", "-n", &demucs, "-d", dev, "--out"]).arg(&sep).arg(&hq).stdout(Stdio::null()).stderr(Stdio::null()).status();
                        let v = sep.join(&demucs).join("audio_hq").join("vocals.wav");
                        if matches!(r, Ok(s) if s.success()) && v.is_file() { got = Some(v); break; }
                    }
                }
                match got { Some(v) => { src = v.display().to_string(); trimmed = true; } None => log("Demucs unavailable — using the original audio") }
            }
        }
        log("Processing audio…");
        let mut chain: Vec<String> = Vec::new();
        if (speed - 1.0).abs() > 0.001 { chain.push(format!("atempo={speed}")); }
        if enhance {
            if pre.trim().is_empty() {
                chain.push("adeclip,highpass=f=80,afftdn=nr=12:nf=-35,equalizer=f=250:width_type=q:width=1:g=-2,equalizer=f=3500:width_type=q:width=1:g=2.5,highshelf=f=9000:g=2".into());
            }
            chain.push("acompressor=threshold=0.125:ratio=3:attack=10:release=150:makeup=2,loudnorm=I=-16:TP=-1.5:LRA=11".into());
        }
        let af = chain.join(",");
        let mut c = ffmpeg()?;
        c.arg("-y");
        if !trimmed { c.args(["-ss", &start.to_string(), "-t", &dur.to_string()]); }
        c.arg("-i").arg(&src).args(["-vn", "-ac", "2", "-ar", "44100"]);
        if !af.is_empty() { c.args(["-af", &af]); }
        let o = c.arg(&wav).output().map_err(|e| format!("ffmpeg: {e}"))?;
        if !o.status.success() { return Err(format!("audio step failed: {}", String::from_utf8_lossy(&o.stderr).lines().last().unwrap_or(""))); }
        for (enc, extra) in [("h264_nvenc", vec!["-preset", "p4", "-tune", "hq", "-rc", "vbr", "-cq", "19", "-b:v", "8500k"]), ("libx264", vec!["-preset", "medium"])] {
            log(&format!("Encoding video ({enc})…"));
            let q = crf.to_string();
            let mut c = ffmpeg()?;
            c.args(["-y", "-progress", "pipe:1", "-nostats", "-stats_period", "1", "-i", &video]).arg("-i").arg(&wav).args(["-map", "0:v:0", "-map", "1:a:0", "-vf", "fps=30", "-c:v", enc]);
            if enc == "libx264" { c.args(["-crf", &q]); }
            c.args(&extra).args(["-pix_fmt", "yuv420p", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-c:a", "aac", "-b:a", "192k", "-af", "alimiter=limit=0.97", "-shortest", "-movflags", "+faststart"]).arg(&out);
            let total_seconds = dur / speed;
            let (status, last_error) = run_encode_progress(&app, c, total_seconds, enc)?;
            if status.success() { let _ = std::fs::remove_file(&wav); let _ = std::fs::remove_file(&video); return Ok(out.clone()); }
            if enc == "libx264" { return Err(format!("encode failed: {last_error}")); }
        }
        Err("encode failed".into())
    }).await.map_err(|e| e.to_string())?
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![
            set_overrides, env_check, install_tool, read_file, write_file, append_file, copy_file, ensure_dir, reveal,
            ytdlp_version, ytdlp_update, ytdlp_download, test_elevenlabs, transcribe, media_duration, make_background_video, make_looped_background_video, finalize_export
        ])
        .run(tauri::generate_context!())
        .expect("error while running app");
}
