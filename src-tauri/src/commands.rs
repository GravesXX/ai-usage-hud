use std::process::Command;

fn run_security(service: &str, account: &str) -> Result<String, String> {
    let out = Command::new("/usr/bin/security")
        .args(["find-generic-password", "-s", service, "-a", account, "-w"])
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err("keychain-not-found".into());
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

fn current_user() -> String {
    std::env::var("USER").unwrap_or_else(|_| {
        Command::new("/usr/bin/id")
            .arg("-un")
            .output()
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
            .unwrap_or_default()
    })
}

/// Exact service, then prefix-scan via `security dump-keychain` (names only, no secrets)
/// to find hashed variants like "Claude Code-credentials-<HASH>" (Claude Code v2.1.52+).
#[tauri::command]
pub fn read_keychain(service: String) -> Result<String, String> {
    // Defense-in-depth: only ever read the credential services this app needs.
    // (Claude Code stores under "Claude Code-credentials" and v2.1.52+ hashed
    // variants "Claude Code-credentials-<HASH>". Codex auth is NOT in Keychain —
    // it lives in ~/.codex/auth.json — so only the Claude prefix is needed.)
    const ALLOWED_PREFIXES: &[&str] = &["Claude Code-credentials"];
    if service.len() < 8 || !ALLOWED_PREFIXES.iter().any(|p| service == *p) {
        return Err("service-not-allowed".into());
    }
    let account = current_user();
    if let Ok(v) = run_security(&service, &account) {
        return Ok(v);
    }
    let dump = Command::new("/usr/bin/security")
        .arg("dump-keychain")
        .output()
        .map_err(|e| e.to_string())?;
    let text = String::from_utf8_lossy(&dump.stdout);
    for line in text.lines() {
        if line.contains("\"svce\"") {
            if let Some(name) = line.split('"').nth(3) {
                // `service` is allowlisted above, and `name` must start with `service`,
                // so `name` is also guaranteed to start with an allowed prefix — no
                // extra check needed here.
                if name.starts_with(&service) && name != service {
                    if let Ok(v) = run_security(name, &account) {
                        return Ok(v);
                    }
                }
            }
        }
    }
    Err("keychain-not-found".into())
}

#[derive(serde::Deserialize)]
pub struct ProcQuery { pub pattern: String, pub exact: bool }

#[tauri::command]
pub fn check_processes(queries: Vec<ProcQuery>) -> Vec<bool> {
    queries.iter().take(16).map(|q| {
        // Reject overlong or metacharacter-laden patterns (pgrep -f treats pattern as a regex).
        let safe = q.pattern.len() <= 64
            && q.pattern.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | '/'));
        if !safe { return false; }
        let flag = if q.exact { "-x" } else { "-f" };
        Command::new("/usr/bin/pgrep")
            .args([flag, &q.pattern])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }).collect()
}

/// GUI apps don't inherit shell PATH, so probe common install locations.
#[tauri::command]
pub fn get_cli_version(command: String) -> Option<String> {
    if command != "claude" && command != "codex" { return None; }
    let home = std::env::var("HOME").unwrap_or_default();
    let candidates = [
        command.clone(),
        format!("{home}/.local/bin/{command}"),
        format!("/opt/homebrew/bin/{command}"),
        format!("/usr/local/bin/{command}"),
        format!("{home}/.npm-global/bin/{command}"),
    ];
    for c in candidates {
        if let Ok(out) = Command::new(&c).arg("--version").output() {
            if out.status.success() {
                let text = String::from_utf8_lossy(&out.stdout);
                if let Some(v) = text.split_whitespace().find(|t| {
                    t.split('.').count() >= 2 && t.chars().next().is_some_and(|ch| ch.is_ascii_digit())
                }) {
                    return Some(v.trim().to_string());
                }
            }
        }
    }
    None
}

/// Writes the widget snapshot into the shared App Group container.
/// Group id is fixed and must match the Swift widget's entitlement.
#[tauri::command]
pub fn write_group_snapshot(json: String) -> Result<(), String> {
    const GROUP_ID: &str = "group.com.moomoo.aiusagehud";
    let home = std::env::var("HOME").map_err(|e| e.to_string())?;
    let dir = format!("{home}/Library/Group Containers/{GROUP_ID}");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    std::fs::write(format!("{dir}/usage-snapshot.json"), json).map_err(|e| e.to_string())
}

use std::collections::HashMap;

#[derive(serde::Serialize)]
pub struct HttpResponse {
    status: u16,
    headers: HashMap<String, String>,
    #[serde(rename = "bodyText")]
    body_text: String,
}

/// Make an HTTPS request from Rust (reqwest), bypassing the webview http plugin.
/// Egress is allowlisted to the two provider hosts (defense in depth). Only the
/// status is logged — never tokens or bodies.
#[tauri::command]
pub async fn http_request(
    url: String,
    method: String,
    headers: HashMap<String, String>,
) -> Result<HttpResponse, String> {
    const ALLOWED: &[&str] = &["https://api.anthropic.com/", "https://chatgpt.com/"];
    if !ALLOWED.iter().any(|a| url.starts_with(a)) {
        return Err("host-not-allowed".into());
    }
    let client = tauri_plugin_http::reqwest::Client::new();
    let m = tauri_plugin_http::reqwest::Method::from_bytes(method.as_bytes())
        .map_err(|e| e.to_string())?;
    let mut req = client.request(m, &url);
    for (k, v) in &headers {
        req = req.header(k.as_str(), v.as_str());
    }
    let resp = req.send().await.map_err(|e| e.to_string())?;
    let status = resp.status().as_u16();
    eprintln!("[http] {} -> {}", url, status); // status only; no secrets
    let mut hmap = HashMap::new();
    for (k, v) in resp.headers().iter() {
        hmap.insert(k.as_str().to_lowercase(), v.to_str().unwrap_or("").to_string());
    }
    let body_text = resp.text().await.map_err(|e| e.to_string())?;
    Ok(HttpResponse { status, headers: hmap, body_text })
}
