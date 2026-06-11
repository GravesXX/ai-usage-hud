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
