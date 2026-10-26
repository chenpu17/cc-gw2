use super::*;
use cc_gw_core::billing::{PricingEngine, attach_log_costs};
use semver::Version;
use std::collections::BTreeMap;
use std::time::Duration;

/// 查询期定价引擎：每次请求从当前 config 快照构建（纯内存、无 IO），
/// config 热加载后下一请求即生效。
fn pricing_engine(state: &AppState) -> PricingEngine {
    PricingEngine::from_config(&config_snapshot(state).billing)
}

#[derive(Debug, Deserialize)]
struct NpmRegistryPackageResponse {
    #[serde(rename = "dist-tags")]
    dist_tags: HashMap<String, String>,
    time: Option<HashMap<String, String>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct VersionCheckResponse {
    current_version: String,
    latest_version: String,
    channel: String,
    update_available: bool,
    package_name: String,
    release_url: String,
    published_at: Option<String>,
    /// `auto` = the UI can run the upgrade; `manual` = show the command;
    /// `unsupported` = this process was not launched by the CLI.
    upgrade_mode: String,
    upgrade_reason: Option<String>,
    install_method: Option<String>,
    manual_command: String,
}

#[derive(Debug, Clone)]
struct RegistryVersionInfo {
    current_version: String,
    latest_version: String,
    channel: String,
    package_name: String,
    published_at: Option<String>,
    update_available: bool,
}

/// Progress file shared with the CLI upgrade helper. The helper writes it; the
/// server reads it for the status endpoint and for the drain trigger.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct UpgradeStateFile {
    id: String,
    phase: String,
    from_version: String,
    to_version: String,
    started_at: i64,
    updated_at: i64,
    finished_at: Option<i64>,
    error: Option<String>,
    rolled_back: bool,
    platform: Option<String>,
    install_method: Option<String>,
    log_path: Option<String>,
    /// PID of the gateway instance that started this run. Informational; the
    /// watcher's primary address is `instance_token`.
    server_pid: Option<u32>,
    /// Random per-process token of the gateway instance that started this run.
    /// The drain watcher only honors a `draining` state addressed to itself, so
    /// a concurrently running gateway sharing `CC_GW_HOME`, a reused PID, or a
    /// backward clock step cannot stop the wrong process.
    instance_token: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct VersionUpgradeStartResponse {
    id: String,
    phase: String,
    from_version: String,
    to_version: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct VersionUpgradeStatusResponse {
    phase: String,
    stale: bool,
    state: Option<UpgradeStateFile>,
    upgrade_mode: String,
    upgrade_reason: Option<String>,
    install_method: Option<String>,
    manual_command: String,
    current_version: String,
    platform: String,
    active_requests: u64,
}

fn count_active_entries(entries: &Mutex<HashMap<String, u64>>) -> u64 {
    entries.lock().map(|items| items.len() as u64).unwrap_or(0)
}

fn count_active_entries_for_endpoint(
    entries: &Mutex<HashMap<String, HashMap<String, u64>>>,
    endpoint: &str,
) -> u64 {
    entries
        .lock()
        .ok()
        .and_then(|items| items.get(endpoint).map(|bucket| bucket.len() as u64))
        .unwrap_or(0)
}

fn count_active_requests_for_endpoint(
    entries: &Mutex<HashMap<String, u64>>,
    endpoint: &str,
) -> u64 {
    entries
        .lock()
        .ok()
        .and_then(|items| items.get(endpoint).copied())
        .unwrap_or(0)
}

fn count_network_bytes_for_endpoint(entries: &Mutex<HashMap<String, u64>>, endpoint: &str) -> u64 {
    entries
        .lock()
        .ok()
        .and_then(|items| items.get(endpoint).copied())
        .unwrap_or(0)
}

pub(super) fn update_channel_for_version(version: &str) -> String {
    let normalized = version.trim().trim_start_matches('v');
    let Ok(version) = Version::parse(normalized) else {
        return "latest".to_string();
    };

    let Some(identifier) = version.pre.as_str().split('.').next() else {
        return "latest".to_string();
    };

    match identifier {
        "alpha" | "beta" | "rc" => identifier.to_string(),
        _ => "latest".to_string(),
    }
}

fn encode_package_name(package_name: &str) -> String {
    package_name.replace('@', "%40").replace('/', "%2F")
}

async fn fetch_registry_version(
    state: &AppState,
) -> Result<RegistryVersionInfo, (StatusCode, String)> {
    let current_version = env!("CARGO_PKG_VERSION").to_string();
    let channel = update_channel_for_version(&current_version);
    let package_name = state.version_check_package_name.clone();
    let registry_url = format!(
        "{}/{}",
        state.version_check_registry_base_url.trim_end_matches('/'),
        encode_package_name(&package_name)
    );

    let registry_response = state
        .http_client
        .get(&registry_url)
        .timeout(Duration::from_secs(5))
        .header(header::ACCEPT, "application/json")
        .send()
        .await
        .map_err(|error| {
            (
                StatusCode::BAD_GATEWAY,
                format!("failed to query npm registry: {error}"),
            )
        })?;

    if !registry_response.status().is_success() {
        return Err((
            StatusCode::BAD_GATEWAY,
            format!(
                "npm registry returned status {}",
                registry_response.status()
            ),
        ));
    }

    let registry_payload = registry_response
        .json::<NpmRegistryPackageResponse>()
        .await
        .map_err(|error| {
            (
                StatusCode::BAD_GATEWAY,
                format!("invalid npm registry response: {error}"),
            )
        })?;

    let latest_version = registry_payload
        .dist_tags
        .get(&channel)
        .or_else(|| registry_payload.dist_tags.get("latest"))
        .cloned()
        .ok_or_else(|| {
            (
                StatusCode::BAD_GATEWAY,
                format!("npm dist-tag not found for channel {channel}"),
            )
        })?;

    // This value is displayed (and copied) as `npm install -g pkg@<version>`,
    // and a custom registry base URL is honored. Refuse anything that is not a
    // plain semantic version instead of rendering registry-controlled text.
    let latest = Version::parse(latest_version.trim_start_matches('v')).map_err(|_| {
        (
            StatusCode::BAD_GATEWAY,
            format!("npm dist-tag {channel} is not a valid version: {latest_version}"),
        )
    })?;
    let current = Version::parse(current_version.trim_start_matches('v'))
        .unwrap_or_else(|_| Version::new(0, 0, 0));
    let update_available = latest > current;

    let published_at = registry_payload
        .time
        .as_ref()
        .and_then(|entries| entries.get(&latest_version).cloned());

    Ok(RegistryVersionInfo {
        current_version,
        latest_version,
        channel,
        package_name,
        published_at,
        update_available,
    })
}

/// Decide whether the Web UI may trigger a self-upgrade. `auto` requires the
/// CLI to have spawned this process in daemon mode with a writable global npm
/// install; everything else falls back to a copyable manual command.
pub(super) fn upgrade_mode(state: &AppState) -> (&'static str, Option<&'static str>) {
    let cli_ready = state
        .upgrade
        .cli_path
        .as_ref()
        .map(|path| path.exists())
        .unwrap_or(false)
        && state
            .upgrade
            .node_bin
            .as_ref()
            .map(|path| path.exists())
            .unwrap_or(false);
    if !cli_ready {
        return ("unsupported", Some("not-launched-by-cli"));
    }
    if state.upgrade.service_mode != "daemon" {
        return ("manual", Some("foreground"));
    }
    match state.upgrade.install_method.as_deref() {
        Some("npm-global" | "pnpm-global" | "yarn-global" | "bun-global") => {
            // Node cannot spawn .cmd/.bat package-manager shims directly on
            // Windows; only npm has a JS entry the helper can resolve.
            if cfg!(windows) && state.upgrade.install_method.as_deref() != Some("npm-global") {
                return ("manual", Some("package-manager"));
            }
            if state.upgrade.install_writable {
                ("auto", None)
            } else {
                ("manual", Some("not-writable"))
            }
        }
        Some("npx") => ("manual", Some("npx")),
        _ => ("manual", Some("local-build")),
    }
}

pub(super) fn manual_upgrade_command(state: &AppState, target_version: &str) -> String {
    let package_name = &state.version_check_package_name;
    let (manager, args) = match state.upgrade.install_method.as_deref() {
        Some("pnpm-global") => ("pnpm", format!("add -g {package_name}@{target_version}")),
        Some("yarn-global") => (
            "yarn",
            format!("global add {package_name}@{target_version}"),
        ),
        Some("bun-global") => ("bun", format!("add -g {package_name}@{target_version}")),
        _ => ("npm", format!("install -g {package_name}@{target_version}")),
    };
    let sudo = if state.upgrade.install_writable {
        ""
    } else {
        "sudo "
    };
    format!("{sudo}{manager} {args} && cc-gw restart")
}

fn read_upgrade_state(state: &AppState) -> Option<UpgradeStateFile> {
    let raw = std::fs::read_to_string(&state.upgrade.state_path).ok()?;
    serde_json::from_str(&raw).ok()
}

fn write_upgrade_state_at(state_path: &Path, payload: &UpgradeStateFile) -> Result<(), String> {
    static WRITE_SEQ: AtomicU64 = AtomicU64::new(0);
    let bytes = serde_json::to_vec_pretty(payload).map_err(|error| error.to_string())?;
    // A fixed `.tmp` name lets two writers interleave and leave non-JSON in the
    // state file (which silently disables the drain watcher). Serialize the
    // suffix with a per-process counter as well as the PID.
    let seq = WRITE_SEQ.fetch_add(1, Ordering::Relaxed);
    let tmp = state_path.with_extension(format!("json.{}.{seq}.tmp", std::process::id()));
    std::fs::write(&tmp, bytes).map_err(|error| error.to_string())?;
    std::fs::rename(&tmp, state_path).map_err(|error| error.to_string())
}

fn write_upgrade_state(state: &AppState, payload: &UpgradeStateFile) -> Result<(), String> {
    write_upgrade_state_at(&state.upgrade.state_path, payload)
}

fn is_terminal_phase(phase: &str) -> bool {
    matches!(phase, "" | "idle" | "succeeded" | "failed")
}

fn upgrade_state_is_active(state: Option<&UpgradeStateFile>) -> bool {
    let Some(state) = state else {
        return false;
    };
    if is_terminal_phase(&state.phase) {
        return false;
    }
    let now = chrono::Utc::now().timestamp_millis();
    now.saturating_sub(state.updated_at) < 10 * 60 * 1000
}

pub(super) async fn api_version_check(State(state): State<AppState>) -> Response {
    let registry = match fetch_registry_version(&state).await {
        Ok(registry) => registry,
        Err((status, error)) => {
            return (status, Json(json!({ "error": error }))).into_response();
        }
    };
    let (upgrade_mode, upgrade_reason) = upgrade_mode(&state);

    Json(VersionCheckResponse {
        manual_command: manual_upgrade_command(&state, &registry.latest_version),
        upgrade_mode: upgrade_mode.to_string(),
        upgrade_reason: upgrade_reason.map(ToString::to_string),
        install_method: state.upgrade.install_method.clone(),
        current_version: registry.current_version,
        latest_version: registry.latest_version.clone(),
        channel: registry.channel,
        update_available: registry.update_available,
        package_name: registry.package_name.clone(),
        release_url: format!("https://www.npmjs.com/package/{}", registry.package_name),
        published_at: registry.published_at,
    })
    .into_response()
}

/// Browsers attach `Sec-Fetch-Site` (and `Origin`) to cross-site POSTs. When web
/// auth is disabled — the default — this endpoint would otherwise be a CSRF
/// primitive: any visited page could install code and restart the gateway with a
/// bodyless form POST. Same-origin calls from the console are unaffected.
fn is_cross_site_request(headers: &HeaderMap) -> bool {
    if let Some(site) = headers
        .get("sec-fetch-site")
        .and_then(|value| value.to_str().ok())
    {
        let site = site.trim().to_ascii_lowercase();
        if site == "cross-site" || site == "same-site" {
            return true;
        }
    }
    let Some(origin) = headers
        .get(header::ORIGIN)
        .and_then(|value| value.to_str().ok())
    else {
        return false;
    };
    let origin_authority = origin
        .split_once("://")
        .map(|(_, rest)| rest)
        .unwrap_or(origin)
        .split('/')
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();
    let authority_matches = |candidate: Option<&str>| {
        candidate
            .map(|value| value.trim().to_ascii_lowercase() == origin_authority)
            .unwrap_or(false)
    };
    let host = headers
        .get(header::HOST)
        .and_then(|value| value.to_str().ok());
    let forwarded_host = headers
        .get("x-forwarded-host")
        .and_then(|value| value.to_str().ok());
    !(authority_matches(host) || authority_matches(forwarded_host))
}

/// Make paths independent of the helper's working directory. A relative
/// `CC_GW_HOME` otherwise resolves twice (the server spawns the helper with
/// `cwd` set to the same relative dir), so the helper would write its state to
/// `<home>/<home>/upgrade-state.json` and never trigger the drain.
fn absolute_path(path: &Path) -> PathBuf {
    if path.is_absolute() {
        return path.to_path_buf();
    }
    std::env::current_dir()
        .map(|cwd| cwd.join(path))
        .unwrap_or_else(|_| path.to_path_buf())
}

/// Listening endpoint used by the upgrade helper's health probe and restart.
fn upgrade_probe_port(config: &GatewayConfig) -> Option<(u16, &'static str)> {
    let http = config.http.as_ref();
    if http.map(|value| value.enabled).unwrap_or(true) {
        if let Some(http) = http.filter(|value| value.port > 0) {
            return Some((http.port, "http"));
        }
    }
    config
        .https
        .as_ref()
        .filter(|value| value.enabled && value.port > 0)
        .map(|value| (value.port, "https"))
}

pub(super) async fn api_version_upgrade(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Response {
    if is_cross_site_request(&headers) {
        return (
            StatusCode::FORBIDDEN,
            Json(json!({ "error": "cross-site upgrade requests are not allowed" })),
        )
            .into_response();
    }
    let (mode, reason) = upgrade_mode(&state);
    if mode != "auto" {
        return (
            StatusCode::CONFLICT,
            Json(json!({
                "error": "self-upgrade is not available for this installation",
                "upgradeMode": mode,
                "upgradeReason": reason,
            })),
        )
            .into_response();
    }

    if upgrade_state_is_active(read_upgrade_state(&state).as_ref()) {
        return (
            StatusCode::CONFLICT,
            Json(json!({ "error": "another upgrade is already in progress" })),
        )
            .into_response();
    }

    // Hold across the registry fetch, state write, and spawn: without this two
    // concurrent POSTs both pass the file check and start competing helpers.
    let _start_guard = state.upgrade_start_lock.lock().await;
    if upgrade_state_is_active(read_upgrade_state(&state).as_ref()) {
        return (
            StatusCode::CONFLICT,
            Json(json!({ "error": "another upgrade is already in progress" })),
        )
            .into_response();
    }

    let registry = match fetch_registry_version(&state).await {
        Ok(registry) => registry,
        Err((status, error)) => {
            return (status, Json(json!({ "error": error }))).into_response();
        }
    };
    // A terminal `cc-gw upgrade` (or a previous server instance) may have
    // written an active state while the registry call was in flight.
    if upgrade_state_is_active(read_upgrade_state(&state).as_ref()) {
        return (
            StatusCode::CONFLICT,
            Json(json!({ "error": "another upgrade is already in progress" })),
        )
            .into_response();
    }
    if !registry.update_available {
        return (
            StatusCode::CONFLICT,
            Json(json!({ "error": "already up to date", "currentVersion": registry.current_version })),
        )
            .into_response();
    }

    let Some(node_bin) = state.upgrade.node_bin.as_deref() else {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "upgrade helper node binary is not configured" })),
        )
            .into_response();
    };
    let Some(cli_path) = state.upgrade.cli_path.as_deref() else {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "upgrade helper cli path is not configured" })),
        )
            .into_response();
    };

    let home_dir = absolute_path(&state.paths.home_dir);
    let log_dir = absolute_path(&state.upgrade.log_dir);
    let state_path = absolute_path(&state.upgrade.state_path);
    if let Err(error) = std::fs::create_dir_all(&log_dir) {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("failed to create log directory: {error}") })),
        )
            .into_response();
    }

    let now = chrono::Utc::now();
    // Sub-millisecond entropy: two requests served in the same millisecond (or
    // concurrent runs on one machine) must not share an id, or the losing
    // helper could mark the winner's run failed.
    let id = format!(
        "{}-{}-{}",
        now.timestamp_millis(),
        std::process::id(),
        now.timestamp_subsec_nanos()
    );
    let log_path = log_dir.join(format!("upgrade-{id}.log"));
    let now = now.timestamp_millis();
    let initial_state = UpgradeStateFile {
        id: id.clone(),
        phase: "preparing".to_string(),
        from_version: registry.current_version.clone(),
        to_version: registry.latest_version.clone(),
        started_at: now,
        updated_at: now,
        finished_at: None,
        error: None,
        rolled_back: false,
        platform: Some(format!(
            "{}-{}",
            std::env::consts::OS,
            std::env::consts::ARCH
        )),
        install_method: state.upgrade.install_method.clone(),
        log_path: Some(log_path.display().to_string()),
        server_pid: Some(std::process::id()),
        instance_token: Some(state.upgrade_instance_token.clone()),
    };
    if let Err(error) = write_upgrade_state_at(&state_path, &initial_state) {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("failed to write upgrade state: {error}") })),
        )
            .into_response();
    }

    let log = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path);
    let mut command = std::process::Command::new(node_bin);
    command
        .arg(cli_path)
        .arg("upgrade")
        .arg("--from-server")
        .arg("--target")
        .arg(&registry.latest_version)
        .arg("--from-version")
        .arg(&registry.current_version)
        .arg("--id")
        .arg(&id)
        .arg("--state-file")
        .arg(&state_path)
        .arg("--log-file")
        .arg(&log_path)
        .arg("--home")
        .arg(&home_dir)
        // Trust the gateway's own PID instead of `cc-gw.pid`: when that file is
        // missing or stale the helper used to install the package, report
        // success, and leave the old process serving the old binary.
        .arg("--server-pid")
        .arg(std::process::id().to_string())
        .env("CC_GW_HOME", &home_dir)
        .env(
            "CC_GW_VERSION_CHECK_PACKAGE_NAME",
            &state.version_check_package_name,
        )
        .env(
            "CC_GW_VERSION_CHECK_REGISTRY_BASE_URL",
            &state.version_check_registry_base_url,
        );
    if let Some((port, protocol)) = upgrade_probe_port(&config_snapshot(&state)) {
        command
            .arg("--port")
            .arg(port.to_string())
            .arg("--protocol")
            .arg(protocol);
    }
    command
        .current_dir(&home_dir)
        .stdin(std::process::Stdio::null());
    match &log {
        Ok(file) => {
            if let Ok(stdout) = file.try_clone() {
                command.stdout(std::process::Stdio::from(stdout));
            }
            if let Ok(stderr) = file.try_clone() {
                command.stderr(std::process::Stdio::from(stderr));
            }
        }
        Err(_) => {
            command.stdout(std::process::Stdio::null());
            command.stderr(std::process::Stdio::null());
        }
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const DETACHED_PROCESS: u32 = 0x0000_0008;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        command.creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP);
    }

    match command.spawn() {
        Ok(mut child) => {
            // Reap the helper so it never lingers as a zombie if the upgrade
            // fails before the server is restarted. The helper runs detached,
            // so killing this process does not kill it. A helper that dies
            // before writing anything would otherwise leave `preparing` behind,
            // which blocks retries for ten minutes and spins the UI.
            let reaper_state = state.clone();
            let reaper_id = id.clone();
            std::thread::spawn(move || {
                let status = child.wait();
                let failed = match &status {
                    Ok(status) => !status.success(),
                    Err(_) => true,
                };
                if !failed {
                    return;
                }
                let Some(mut current) = read_upgrade_state(&reaper_state) else {
                    return;
                };
                if current.id != reaper_id || is_terminal_phase(&current.phase) {
                    return;
                }
                let now = chrono::Utc::now().timestamp_millis();
                current.phase = "failed".to_string();
                current.error = Some(match status {
                    Ok(status) => format!("upgrade helper exited with {status}"),
                    Err(error) => format!("failed to wait for upgrade helper: {error}"),
                });
                current.finished_at = Some(now);
                current.updated_at = now;
                let _ = write_upgrade_state(&reaper_state, &current);
            });
            record_and_broadcast_event(
                &state,
                RecordEventInput {
                    event_type: "upgrade_started".to_string(),
                    level: Some("info".to_string()),
                    source: Some("upgrade".to_string()),
                    title: Some(format!("Upgrading to v{}", registry.latest_version)),
                    message: Some(format!(
                        "{} -> {}",
                        registry.current_version, registry.latest_version
                    )),
                    details: Some(json!({
                        "fromVersion": registry.current_version,
                        "toVersion": registry.latest_version,
                        "installMethod": state.upgrade.install_method,
                        "logPath": log_path.display().to_string(),
                    })),
                    ..Default::default()
                },
            );
            (
                StatusCode::ACCEPTED,
                Json(VersionUpgradeStartResponse {
                    id,
                    phase: initial_state.phase,
                    from_version: initial_state.from_version,
                    to_version: initial_state.to_version,
                }),
            )
                .into_response()
        }
        Err(error) => {
            let mut failed = initial_state;
            failed.phase = "failed".to_string();
            failed.error = Some(format!("failed to start upgrade helper: {error}"));
            failed.finished_at = Some(chrono::Utc::now().timestamp_millis());
            failed.updated_at = failed.finished_at.unwrap_or_default();
            let _ = write_upgrade_state_at(&state_path, &failed);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": format!("failed to start upgrade helper: {error}") })),
            )
                .into_response()
        }
    }
}

pub(super) async fn api_version_upgrade_status(
    State(state): State<AppState>,
) -> Json<VersionUpgradeStatusResponse> {
    let state_file = read_upgrade_state(&state);
    let phase = state_file
        .as_ref()
        .map(|value| value.phase.clone())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "idle".to_string());
    let stale = state_file
        .as_ref()
        .map(|value| {
            !is_terminal_phase(&value.phase)
                && chrono::Utc::now()
                    .timestamp_millis()
                    .saturating_sub(value.updated_at)
                    >= 10 * 60 * 1000
        })
        .unwrap_or(false);
    let (upgrade_mode, upgrade_reason) = upgrade_mode(&state);
    let current_version = env!("CARGO_PKG_VERSION").to_string();
    let target_version = state_file
        .as_ref()
        .map(|value| value.to_version.clone())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| current_version.clone());

    Json(VersionUpgradeStatusResponse {
        phase,
        stale,
        state: state_file,
        upgrade_mode: upgrade_mode.to_string(),
        upgrade_reason: upgrade_reason.map(ToString::to_string),
        install_method: state.upgrade.install_method.clone(),
        manual_command: manual_upgrade_command(&state, &target_version),
        current_version,
        platform: format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH),
        active_requests: state.active_requests.load(Ordering::Relaxed),
    })
}

pub(super) async fn api_status(
    State(state): State<AppState>,
    Query(query): Query<StatusQuery>,
) -> Json<StatusResponse> {
    let endpoint = query
        .endpoint
        .as_deref()
        .filter(|value| !value.trim().is_empty());
    Json(build_status_response(&state, endpoint))
}

pub(super) fn build_status_response(state: &AppState, endpoint: Option<&str>) -> StatusResponse {
    let config = config_snapshot(state);
    let now = chrono::Utc::now().timestamp_millis();
    let last_hour = now - 60 * 60 * 1000;
    let last_minute = now - 60 * 1000;
    let recent_activity =
        get_recent_client_activity(&state.paths.db_path, last_hour, endpoint).unwrap_or_default();
    let recent_throughput =
        get_recent_throughput_metrics(&state.paths.db_path, last_minute, endpoint)
            .unwrap_or_default();
    let active_requests = if let Some(endpoint) = endpoint {
        count_active_requests_for_endpoint(&state.active_requests_by_endpoint, endpoint)
    } else {
        state.active_requests.load(Ordering::Relaxed)
    };
    let active_client_addresses = if let Some(endpoint) = endpoint {
        count_active_entries_for_endpoint(&state.active_client_addresses_by_endpoint, endpoint)
    } else {
        count_active_entries(&state.active_client_addresses)
    };
    let active_client_sessions = if let Some(endpoint) = endpoint {
        count_active_entries_for_endpoint(&state.active_client_sessions_by_endpoint, endpoint)
    } else {
        count_active_entries(&state.active_client_sessions)
    };
    // Per-client-kind active counts honor the endpoint filter, like every
    // other active-* metric above — otherwise a dashboard scoped to one
    // endpoint would mix in other endpoints' in-flight traffic.
    let active_by_client_kind = if let Some(endpoint) = endpoint {
        state
            .active_requests_by_client_kind_by_endpoint
            .lock()
            .ok()
            .and_then(|entries| entries.get(endpoint).cloned())
            .unwrap_or_default()
            .into_iter()
            .collect::<BTreeMap<String, u64>>()
    } else {
        state
            .active_requests_by_client_kind
            .lock()
            .map(|entries| entries.clone())
            .unwrap_or_default()
    };
    let cpu_usage_percent = state.runtime_metrics.lock().ok().map(|mut metrics| {
        let key = endpoint.unwrap_or("__all__");
        let ingress_total = if let Some(endpoint) = endpoint {
            count_network_bytes_for_endpoint(&state.network_ingress_bytes_by_endpoint, endpoint)
        } else {
            state.network_ingress_bytes.load(Ordering::Relaxed)
        };
        let egress_total = if let Some(endpoint) = endpoint {
            count_network_bytes_for_endpoint(&state.network_egress_bytes_by_endpoint, endpoint)
        } else {
            state.network_egress_bytes.load(Ordering::Relaxed)
        };
        (
            metrics.current_process_cpu_usage_percent(),
            metrics.current_bandwidth_metrics(key, ingress_total, egress_total),
        )
    });
    let (cpu_usage_percent, bandwidth_metrics) = match cpu_usage_percent {
        Some((cpu_usage_percent, bandwidth_metrics)) => (cpu_usage_percent, bandwidth_metrics),
        None => (
            None,
            cc_gw_core::observability::RuntimeBandwidthMetrics::default(),
        ),
    };
    StatusResponse {
        port: config.port,
        host: config.host.clone(),
        providers: config.providers.len(),
        active_requests,
        active_client_addresses,
        active_client_sessions,
        active_by_client_kind,
        unique_client_addresses_last_hour: recent_activity.unique_source_ips.max(0) as u64,
        unique_client_sessions_last_hour: recent_activity.unique_session_ids.max(0) as u64,
        requests_per_minute: recent_throughput.requests_per_minute.max(0) as u64,
        output_tokens_per_minute: recent_throughput.output_tokens_per_minute.max(0) as u64,
        runtime: "rust",
        backend_version: env!("CARGO_PKG_VERSION"),
        platform: format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH),
        cpu_usage_percent,
        network_ingress_bytes_per_second: Some(bandwidth_metrics.ingress_bytes_per_second),
        network_egress_bytes_per_second: Some(bandwidth_metrics.egress_bytes_per_second),
        pid: std::process::id(),
    }
}

pub(super) async fn api_config(State(state): State<AppState>) -> Json<GatewayConfig> {
    Json(config_snapshot(&state).sanitize_for_web())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct RoutingSimulateBody {
    /// `"anthropic"` | `"openai"` | a custom-endpoint id
    endpoint: String,
    model: Option<String>,
    thinking: Option<bool>,
    /// Protocol family to simulate: `"anthropic"` | `"openai"` (additive).
    /// Custom endpoints that serve both families are otherwise simulated with
    /// their first configured path's protocol, which can only exercise one
    /// branch of the routing table.
    protocol: Option<String>,
    /// optional request body, used only for the long-context token estimate
    body: Option<serde_json::Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RouteCandidateInfo {
    provider_id: String,
    provider_label: String,
    model_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct RoutingSimulateResponse {
    provider_id: String,
    provider_label: String,
    model_id: String,
    reason: cc_gw_core::routing::RouteMatchReason,
    /// Full failover candidate chain (aggregated models expand to their
    /// member backends in priority order; single-candidate routes report one
    /// entry). Additive — older consoles ignore it.
    candidates: Vec<RouteCandidateInfo>,
}

/// Routing "hit simulation": given an endpoint + requested model, resolve the
/// target the gateway WOULD pick and report which rule fired. Read-only — does
/// not send any upstream request. Powers the console's 命中模拟 panel.
pub(super) async fn api_routing_simulate(
    State(state): State<AppState>,
    Json(payload): Json<RoutingSimulateBody>,
) -> Response {
    let config = config_snapshot(&state);
    let endpoint_id = payload.endpoint.trim();
    let endpoint = match endpoint_id {
        "anthropic" => cc_gw_core::routing::GatewayEndpoint::Anthropic,
        "openai" => cc_gw_core::routing::GatewayEndpoint::OpenAi,
        other => cc_gw_core::routing::GatewayEndpoint::Custom(other),
    };
    let requested_protocol = payload
        .protocol
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let protocol = match endpoint {
        cc_gw_core::routing::GatewayEndpoint::Anthropic => {
            cc_gw_core::provider::ProviderProtocol::AnthropicMessages
        }
        cc_gw_core::routing::GatewayEndpoint::OpenAi => {
            cc_gw_core::provider::ProviderProtocol::OpenAiChatCompletions
        }
        cc_gw_core::routing::GatewayEndpoint::Custom(id) => {
            // An explicitly requested family wins: a unified endpoint serves
            // both and the simulator must be able to exercise either branch.
            // Otherwise mirror the real proxy path (main.rs
            // `match_custom_route`): the protocol is driven by the endpoint's
            // configured paths[].protocol (or the legacy path/protocol pair),
            // falling back to OpenAI chat when nothing is configured.
            match requested_protocol {
                Some("anthropic") => cc_gw_core::provider::ProviderProtocol::AnthropicMessages,
                Some("openai-responses") => cc_gw_core::provider::ProviderProtocol::OpenAiResponses,
                Some("openai" | "openai-chat") => {
                    cc_gw_core::provider::ProviderProtocol::OpenAiChatCompletions
                }
                _ => cc_gw_core::routing::find_custom_endpoint(&config, id)
                    .and_then(|ep| {
                        if !ep.paths.is_empty() {
                            Some(ep.paths[0].protocol.as_str())
                        } else {
                            ep.protocol.as_deref()
                        }
                    })
                    .map_or(
                        cc_gw_core::provider::ProviderProtocol::OpenAiChatCompletions,
                        |proto| match proto {
                            "anthropic" => {
                                cc_gw_core::provider::ProviderProtocol::AnthropicMessages
                            }
                            "openai-responses" => {
                                cc_gw_core::provider::ProviderProtocol::OpenAiResponses
                            }
                            _ => cc_gw_core::provider::ProviderProtocol::OpenAiChatCompletions,
                        },
                    ),
            }
        }
    };
    let request_body = payload.body.unwrap_or_else(|| json!({}));
    let requested_model = payload
        .model
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let thinking = payload.thinking.unwrap_or(false);

    match cc_gw_core::routing::resolve_route_plan_with_reason(
        &config,
        endpoint,
        protocol,
        &request_body,
        requested_model,
        thinking,
    ) {
        Ok((plan, reason)) => {
            let primary = plan.primary();
            Json(RoutingSimulateResponse {
                provider_id: primary.provider_id.clone(),
                provider_label: primary.provider.label.clone(),
                model_id: primary.model_id.clone(),
                reason,
                candidates: plan
                    .candidates
                    .iter()
                    .map(|candidate| RouteCandidateInfo {
                        provider_id: candidate.provider_id.clone(),
                        provider_label: candidate.provider.label.clone(),
                        model_id: candidate.model_id.clone(),
                    })
                    .collect(),
            })
            .into_response()
        }
        Err(err) => (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": err.to_string() })),
        )
            .into_response(),
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct BackendHealthEntry {
    #[serde(flatten)]
    snapshot: cc_gw_core::health::BackendHealthSnapshot,
    state: &'static str,
    cooldown_remaining_seconds: Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct BackendsHealthResponse {
    backends: Vec<BackendHealthEntry>,
}

/// Read-only snapshot of backend health for the console's aggregate-model
/// cards and tests: which backends are degraded or cooling, and when the
/// cooldown lifts. Backends absent from the list have never failed.
pub(super) async fn api_backends_health(
    State(state): State<AppState>,
) -> Json<BackendsHealthResponse> {
    let now_ms = chrono::Utc::now().timestamp_millis();
    let backends = state
        .backend_health
        .snapshot()
        .into_iter()
        .map(|snapshot| BackendHealthEntry {
            state: snapshot.state(now_ms),
            cooldown_remaining_seconds: snapshot.cooldown_remaining_seconds(now_ms),
            snapshot,
        })
        .collect();
    Json(BackendsHealthResponse { backends })
}

pub(super) async fn api_config_info(State(state): State<AppState>) -> Json<ConfigInfoResponse> {
    let config = config_snapshot(&state).sanitize_for_web();
    Json(ConfigInfoResponse {
        config,
        path: state.paths.config_path.display().to_string(),
    })
}

pub(super) async fn api_providers(State(state): State<AppState>) -> Response {
    // Only id/label are needed (logs filter dropdown); never ship the upstream
    // api_key or other provider secrets to the browser from this endpoint.
    // (Config editors that need the full provider record use /api/config.)
    let summaries: Vec<Value> = config_snapshot(&state)
        .providers
        .into_iter()
        .map(|provider| json!({ "id": provider.id, "label": provider.label }))
        .collect();
    Json(summaries).into_response()
}

pub(super) async fn api_provider_test(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    body: Option<Json<ProviderTestBody>>,
) -> Response {
    let body = body.map(|Json(payload)| payload);
    // An inline draft (create-mode console form) wins over the saved lookup.
    let provider = match body.as_ref().and_then(|payload| payload.provider.clone()) {
        Some(draft) => draft,
        None => {
            let config = config_snapshot(&state);
            let Some(provider) = config.providers.iter().find(|item| item.id == id).cloned() else {
                return (
                    StatusCode::NOT_FOUND,
                    Json(json!({ "error": "Provider not found" })),
                )
                    .into_response();
            };
            provider
        }
    };
    // Aggregate providers are virtual (no base URL to probe or test); their
    // health is the health of their member backends.
    if provider.is_aggregate() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "ok": false,
                "status": 0,
                "statusText": "聚合 Provider 不支持连通性测试，请对其成员 Provider 分别测试"
            })),
        )
            .into_response();
    }
    let target_model = provider
        .default_model
        .clone()
        .or_else(|| provider.models.first().map(|model| model.id.clone()));
    let Some(target_model) = target_model else {
        return Json(json!({
            "ok": false,
            "status": 0,
            "statusText": "No model configured for provider"
        }))
        .into_response();
    };

    let mut incoming_headers = HeaderMap::new();
    if let Some(headers) = body.as_ref().and_then(|payload| payload.headers.as_ref()) {
        for (key, value) in headers {
            let normalized_key = key.trim().to_ascii_lowercase();
            if normalized_key.is_empty() {
                continue;
            }
            if let (Ok(name), Ok(value)) = (
                axum::http::header::HeaderName::from_bytes(normalized_key.as_bytes()),
                HeaderValue::from_str(value),
            ) {
                incoming_headers.insert(name, value);
            }
        }
    }
    let request_query = body
        .as_ref()
        .and_then(|payload| payload.query.as_deref())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string);
    if let Some(query) = request_query.as_deref() {
        if query.contains("beta=true") {
            incoming_headers.insert(
                axum::http::header::HeaderName::from_static("anthropic-beta"),
                HeaderValue::from_static(
                    "claude-code-20250219,interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14",
                ),
            );
        }
    }

    let prefers_anthropic_protocol = provider_prefers_anthropic_protocol(&provider);
    let prefers_openai_responses_protocol = provider_prefers_openai_responses_protocol(&provider);
    let (protocol, request_body) = if prefers_anthropic_protocol {
        (
            ProviderProtocol::AnthropicMessages,
            json!({
                "model": target_model,
                "stream": false,
                "max_tokens": 256,
                "temperature": 0,
                "messages": [{
                    "role": "user",
                    "content": [
                        { "type": "text", "text": "You are a connection diagnostic assistant." },
                        { "type": "text", "text": "你好，这是一次连接测试。请简短回应以确认服务可用。" }
                    ]
                }]
            }),
        )
    } else if prefers_openai_responses_protocol {
        (
            ProviderProtocol::OpenAiResponses,
            json!({
                "model": target_model,
                "stream": false,
                "temperature": 0,
                "input": [{
                    "role": "user",
                    "content": [{ "type": "input_text", "text": "你好，这是一次连接测试。请简短回应以确认服务可用。" }]
                }]
            }),
        )
    } else {
        (
            ProviderProtocol::OpenAiChatCompletions,
            json!({
                "model": target_model,
                "stream": false,
                "temperature": 0,
                "messages": [{
                    "role": "user",
                    "content": "你好，这是一次连接测试。请简短回应以确认服务可用。"
                }]
            }),
        )
    };

    let started_at = chrono::Utc::now().timestamp_millis();
    // Exercise the same effective surface (active named key + protocol-matching
    // endpoint) that proxied traffic would use for this protocol — a keys-only
    // provider must not fail the console test while real requests succeed.
    let provider = provider.effective_for_protocol(protocol);
    match forward_request(
        &state.http_client,
        &provider,
        protocol,
        ProxyRequest {
            model: target_model.clone(),
            body: request_body,
            stream: false,
            incoming_headers: incoming_headers.clone(),
            passthrough_headers: incoming_headers,
            query: request_query.clone(),
        },
        None,
    )
    .await
    {
        Ok(response) => {
            let duration_ms = chrono::Utc::now().timestamp_millis() - started_at;
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            if !status.is_success() {
                let status_text = if text.contains("only authorized for use with Claude Code") {
                    "测试请求被拒绝：该凭证仅授权在 Claude Code 内使用。请直接在 IDE 中发起一次对话确认真实连通性。"
                        .to_string()
                } else if text.trim().is_empty() {
                    "Upstream error".to_string()
                } else {
                    text.clone()
                };
                return Json(json!({
                    "ok": false,
                    "status": status.as_u16(),
                    "statusText": status_text,
                    "durationMs": duration_ms
                }))
                .into_response();
            }
            let parsed_json = serde_json::from_str::<Value>(&text).ok();
            let sample = if let Some(payload) = parsed_json.as_ref() {
                extract_provider_test_sample(protocol, payload)
            } else if !prefers_anthropic_protocol {
                let fallback = text.trim();
                if fallback.is_empty() {
                    None
                } else {
                    Some(fallback.to_string())
                }
            } else {
                return Json(json!({
                    "ok": false,
                    "status": status.as_u16(),
                    "statusText": "Invalid JSON response",
                    "durationMs": duration_ms
                }))
                .into_response();
            };
            Json(json!({
                "ok": sample.is_some(),
                "status": status.as_u16(),
                "statusText": if sample.is_some() {
                    if parsed_json.is_none() { "OK (text response)" } else { "OK" }
                } else {
                    "Empty response"
                },
                "durationMs": duration_ms,
                "sample": sample
                    .map(|value| Value::String(value.chars().take(200).collect()))
                    .unwrap_or(Value::Null)
            }))
            .into_response()
        }
        Err(error) => (
            StatusCode::BAD_GATEWAY,
            Json(json!({
                "ok": false,
                "status": 0,
                "statusText": error.to_string(),
                "durationMs": chrono::Utc::now().timestamp_millis() - started_at
            })),
        )
            .into_response(),
    }
}

/// Manual balance refresh: fetch now via the provider's balance adapter and
/// keep the latest snapshot in runtime state. Failures surface as 502 with
/// the human-readable reason and land in the gateway event log.
pub(super) async fn api_provider_balance_refresh(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Response {
    let provider = {
        let config = config_snapshot(&state);
        match config.providers.iter().find(|item| item.id == id).cloned() {
            Some(provider) => provider,
            None => {
                return (
                    StatusCode::NOT_FOUND,
                    Json(json!({ "error": "Provider not found" })),
                )
                    .into_response();
            }
        }
    };
    match fetch_balance(&state.http_client, &provider).await {
        Ok(snapshot) => {
            if let Ok(mut entries) = state.provider_balances.lock() {
                entries.insert(id.clone(), snapshot.clone());
            }
            Json(snapshot).into_response()
        }
        Err(message) => {
            record_and_broadcast_event(
                &state,
                RecordEventInput {
                    event_type: "provider_balance_refresh_failed".to_string(),
                    level: Some("warn".to_string()),
                    source: Some("provider".to_string()),
                    title: Some(format!("Provider {id} 余额刷新失败")),
                    message: Some(message.clone()),
                    ..RecordEventInput::default()
                },
            );
            (
                StatusCode::BAD_GATEWAY,
                Json(json!({ "providerId": id, "error": message })),
            )
                .into_response()
        }
    }
}

/// All latest balance snapshots (providers never refreshed are absent).
pub(super) async fn api_provider_balances(State(state): State<AppState>) -> Response {
    let snapshots: Vec<BalanceSnapshot> = state
        .provider_balances
        .lock()
        .map(|entries| entries.values().cloned().collect())
        .unwrap_or_default();
    // Stable order for the console rail/detail view.
    let mut snapshots = snapshots;
    snapshots.sort_by(|a, b| a.provider_id.cmp(&b.provider_id));
    Json(json!({ "balances": snapshots })).into_response()
}

/// Built-in provider preset catalog — single source of truth, static data.
pub(super) async fn api_provider_presets() -> Response {
    Json(json!({ "presets": cc_gw_core::provider_presets::provider_presets() })).into_response()
}

pub(super) async fn api_provider_models_probe(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    body: Option<Json<ProviderModelsProbeBody>>,
) -> Response {
    let body = body.map(|Json(payload)| payload);
    // An inline draft (create-mode console form) wins over the saved lookup.
    let provider = match body.and_then(|payload| payload.provider) {
        Some(draft) => draft,
        None => {
            let config = config_snapshot(&state);
            let Some(provider) = config.providers.iter().find(|item| item.id == id).cloned() else {
                return (
                    StatusCode::NOT_FOUND,
                    Json(json!({ "error": "Provider not found" })),
                )
                    .into_response();
            };
            provider
        }
    };
    // Aggregate providers have no upstream to probe for a model list.
    if provider.is_aggregate() {
        return Json(json!({
            "ok": false,
            "status": 0,
            "statusText": "聚合 Provider 没有上游模型列表，请从成员 Provider 探测后选择"
        }))
        .into_response();
    }

    match fetch_provider_models(&state.http_client, &provider).await {
        Ok(models) => Json(json!({
            "ok": true,
            "status": 200,
            "models": models
        }))
        .into_response(),
        Err(ProviderModelsError::UnsupportedEndpoint) => Json(json!({
            "ok": false,
            "status": 0,
            "statusText": "该供应商的地址无法推导模型列表端点，请手动添加模型"
        }))
        .into_response(),
        Err(ProviderModelsError::Upstream { status, body }) => Json(json!({
            "ok": false,
            "status": status.as_u16(),
            "statusText": if body.trim().is_empty() {
                format!("Upstream error ({})", status.as_u16())
            } else {
                body
            }
        }))
        .into_response(),
        Err(error) => (
            StatusCode::BAD_GATEWAY,
            Json(json!({
                "ok": false,
                "status": 0,
                "statusText": error.to_string()
            })),
        )
            .into_response(),
    }
}

pub(super) async fn api_config_update(
    State(state): State<AppState>,
    Json(body): Json<Value>,
) -> Response {
    let current = config_snapshot(&state);
    let mut next: GatewayConfig = match serde_json::from_value(body.clone()) {
        Ok(value) => value,
        Err(error) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": format!("Invalid config payload: {error}") })),
            )
                .into_response();
        }
    };

    if !body
        .as_object()
        .is_some_and(|object| object.contains_key("webAuth"))
    {
        next.web_auth = current.web_auth.clone();
    } else if next.web_auth.is_some() && current.web_auth.is_some() {
        let mut merged = current.web_auth.clone().unwrap_or_default();
        let incoming = next.web_auth.clone().unwrap_or_default();
        merged.enabled = incoming.enabled;
        merged.username = incoming.username.or(merged.username);
        if incoming.password_hash.is_some() {
            merged.password_hash = incoming.password_hash;
        }
        if incoming.password_salt.is_some() {
            merged.password_salt = incoming.password_salt;
        }
        next.web_auth = Some(merged);
    }

    match replace_config(&state, next) {
        Ok(()) => Json(json!({ "success": true })).into_response(),
        Err(error) => (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": error.to_string() })),
        )
            .into_response(),
    }
}

#[derive(serde::Serialize)]
pub(crate) struct CustomEndpointsResponse {
    endpoints: Vec<cc_gw_core::config::CustomEndpointConfig>,
}

pub(super) async fn api_custom_endpoints(
    State(state): State<AppState>,
) -> Json<CustomEndpointsResponse> {
    let config = config_snapshot(&state);
    // Serialize the typed struct directly (not via serde_json::Value / json!): the
    // latter round-trips IndexMap through serde_json::Map (BTreeMap, sorted), which
    // would scramble modelRoutes key order. Direct serialization preserves it.
    Json(CustomEndpointsResponse {
        endpoints: config.custom_endpoints,
    })
}

pub(super) async fn api_custom_endpoints_create(
    State(state): State<AppState>,
    Json(body): Json<CustomEndpointBody>,
) -> Response {
    let Some(id) = body
        .id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Invalid endpoint id" })),
        )
            .into_response();
    };
    let Some(label) = body
        .label
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Invalid endpoint label" })),
        )
            .into_response();
    };

    let mut paths = if let Some(paths) = body.paths {
        paths
    } else if let (Some(path), Some(protocol)) = (body.path.as_deref(), body.protocol.as_deref()) {
        vec![EndpointPathConfig {
            path: path.to_string(),
            protocol: protocol.to_string(),
        }]
    } else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Must provide either \"paths\" array or \"path\" and \"protocol\"" })),
        )
            .into_response();
    };

    if paths.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "paths must be a non-empty array" })),
        )
            .into_response();
    }
    for path in &mut paths {
        if path.path.trim().is_empty() {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "Invalid path in paths array" })),
            )
                .into_response();
        }
        if !validate_endpoint_protocol(&path.protocol) {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": format!("Invalid protocol \"{}\"", path.protocol) })),
            )
                .into_response();
        }
        path.path = normalize_path(&path.path);
    }

    let mut config = config_snapshot(&state);
    if config
        .custom_endpoints
        .iter()
        .any(|endpoint| endpoint.id == id)
    {
        return (
            StatusCode::CONFLICT,
            Json(json!({ "error": "Endpoint with this id already exists" })),
        )
            .into_response();
    }
    let existing_paths = config
        .custom_endpoints
        .iter()
        .flat_map(custom_endpoint_effective_paths)
        .map(|item| item.path)
        .collect::<Vec<_>>();
    for path in &paths {
        if existing_paths.iter().any(|existing| existing == &path.path) {
            return (
                StatusCode::CONFLICT,
                Json(json!({ "error": format!("Path \"{}\" already exists", path.path) })),
            )
                .into_response();
        }
    }

    let endpoint = CustomEndpointConfig {
        id: id.to_string(),
        label: label.to_string(),
        deletable: Some(body.deletable.unwrap_or(true)),
        enabled: Some(body.enabled.unwrap_or(true)),
        // Always persist a routing block: an endpoint without one is rejected
        // before direct model matching runs, so a freshly created endpoint
        // could not serve requests until the routing page was saved once.
        // An empty block keeps the "no global inheritance" contract while
        // letting direct model matches (and any defaults added later) work
        // immediately.
        routing: Some(body.routing.unwrap_or_default()),
        paths,
        ..CustomEndpointConfig::default()
    };
    config.custom_endpoints.push(endpoint.clone());
    match replace_config(&state, config) {
        Ok(()) => Json(json!({ "success": true, "endpoint": endpoint })).into_response(),
        Err(error) => (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": error.to_string() })),
        )
            .into_response(),
    }
}

pub(super) async fn api_custom_endpoints_update(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    Json(body): Json<CustomEndpointBody>,
) -> Response {
    let mut config = config_snapshot(&state);
    let Some(index) = config
        .custom_endpoints
        .iter()
        .position(|endpoint| endpoint.id == id)
    else {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "Endpoint not found" })),
        )
            .into_response();
    };
    let existing = config.custom_endpoints[index].clone();
    let mut updated = existing.clone();

    if let Some(label) = body.label.as_deref() {
        let label = label.trim();
        if label.is_empty() {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "Invalid endpoint label" })),
            )
                .into_response();
        }
        updated.label = label.to_string();
    }
    if let Some(deletable) = body.deletable {
        updated.deletable = Some(deletable);
    }
    if let Some(enabled) = body.enabled {
        updated.enabled = Some(enabled);
    }
    if let Some(routing) = body.routing {
        updated.routing = Some(routing);
    }

    if body.paths.is_some() || body.path.is_some() || body.protocol.is_some() {
        let mut paths = if let Some(paths) = body.paths {
            paths
        } else if let (Some(path), Some(protocol)) =
            (body.path.as_deref(), body.protocol.as_deref())
        {
            vec![EndpointPathConfig {
                path: path.to_string(),
                protocol: protocol.to_string(),
            }]
        } else {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "Invalid path/protocol update" })),
            )
                .into_response();
        };
        if paths.is_empty() {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "paths must be a non-empty array" })),
            )
                .into_response();
        }
        for path in &mut paths {
            if path.path.trim().is_empty() || !validate_endpoint_protocol(&path.protocol) {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(json!({ "error": "Invalid path or protocol" })),
                )
                    .into_response();
            }
            path.path = normalize_path(&path.path);
        }
        let other_paths = config
            .custom_endpoints
            .iter()
            .enumerate()
            .filter(|(current_index, _)| *current_index != index)
            .flat_map(|(_, endpoint)| custom_endpoint_effective_paths(endpoint))
            .map(|item| item.path)
            .collect::<Vec<_>>();
        for path in &paths {
            if other_paths.iter().any(|existing| existing == &path.path) {
                return (
                    StatusCode::CONFLICT,
                    Json(json!({ "error": format!("Path \"{}\" already in use by another endpoint", path.path) })),
                )
                    .into_response();
            }
        }
        updated.paths = paths;
        updated.path = None;
        updated.protocol = None;
    }

    config.custom_endpoints[index] = updated.clone();
    match replace_config(&state, config) {
        Ok(()) => Json(json!({ "success": true, "endpoint": updated })).into_response(),
        Err(error) => (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": error.to_string() })),
        )
            .into_response(),
    }
}

pub(super) async fn api_custom_endpoints_delete(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Response {
    let mut config = config_snapshot(&state);
    let Some(existing) = config
        .custom_endpoints
        .iter()
        .find(|endpoint| endpoint.id == id)
        .cloned()
    else {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "Endpoint not found" })),
        )
            .into_response();
    };
    if existing.deletable == Some(false) {
        return (
            StatusCode::FORBIDDEN,
            Json(json!({ "error": "This endpoint cannot be deleted" })),
        )
            .into_response();
    }
    config.custom_endpoints.retain(|endpoint| endpoint.id != id);
    match replace_config(&state, config) {
        Ok(()) => Json(json!({ "success": true })).into_response(),
        Err(error) => (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": error.to_string() })),
        )
            .into_response(),
    }
}

pub(super) async fn api_routing_presets_create(
    State(state): State<AppState>,
    AxumPath(endpoint): AxumPath<String>,
    Json(body): Json<PresetNameBody>,
) -> Response {
    let Some(name) = body
        .name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Preset name is required" })),
        )
            .into_response();
    };
    let mut config = config_snapshot(&state);
    let Some(endpoint) = parse_preset_endpoint(&config, &endpoint) else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Unsupported endpoint" })),
        )
            .into_response();
    };

    if endpoint == "anthropic" || endpoint == "openai" {
        let current_presets = config.routing_presets.entry(endpoint.clone()).or_default();
        if current_presets
            .iter()
            .any(|preset| preset.name.eq_ignore_ascii_case(name))
        {
            return (
                StatusCode::CONFLICT,
                Json(json!({ "error": "Preset name already exists" })),
            )
                .into_response();
        }
        let (base_routes, base_routes_by_protocol) = config
            .endpoint_routing
            .get(&endpoint)
            .map(|routing| {
                (
                    routing.model_routes.clone(),
                    routing.model_routes_by_protocol.clone(),
                )
            })
            .unwrap_or_else(|| {
                let routes = if endpoint == "anthropic" {
                    config.model_routes.clone()
                } else {
                    Default::default()
                };
                (routes, Default::default())
            });
        current_presets.push(RoutingPreset {
            name: name.to_string(),
            model_routes: base_routes,
            model_routes_by_protocol: base_routes_by_protocol,
            created_at: chrono::Utc::now().timestamp_millis(),
        });
        current_presets
            .sort_by(|left, right| left.name.to_lowercase().cmp(&right.name.to_lowercase()));
        let presets = current_presets.clone();
        match replace_config(&state, config) {
            Ok(()) => Json(json!({ "success": true, "presets": presets })).into_response(),
            Err(error) => (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": error.to_string() })),
            )
                .into_response(),
        }
    } else {
        let Some(custom_endpoint) = config
            .custom_endpoints
            .iter_mut()
            .find(|item| item.id == endpoint)
        else {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "Unsupported endpoint" })),
            )
                .into_response();
        };
        if custom_endpoint
            .routing_presets
            .iter()
            .any(|preset| preset.name.eq_ignore_ascii_case(name))
        {
            return (
                StatusCode::CONFLICT,
                Json(json!({ "error": "Preset name already exists" })),
            )
                .into_response();
        }
        let (routes, routes_by_protocol) = custom_endpoint
            .routing
            .as_ref()
            .map(|routing| {
                (
                    routing.model_routes.clone(),
                    routing.model_routes_by_protocol.clone(),
                )
            })
            .unwrap_or_default();
        custom_endpoint.routing_presets.push(RoutingPreset {
            name: name.to_string(),
            model_routes: routes,
            model_routes_by_protocol: routes_by_protocol,
            created_at: chrono::Utc::now().timestamp_millis(),
        });
        custom_endpoint
            .routing_presets
            .sort_by(|left, right| left.name.to_lowercase().cmp(&right.name.to_lowercase()));
        let presets = custom_endpoint.routing_presets.clone();
        match replace_config(&state, config) {
            Ok(()) => Json(json!({ "success": true, "presets": presets })).into_response(),
            Err(error) => (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": error.to_string() })),
            )
                .into_response(),
        }
    }
}

pub(super) async fn api_routing_presets_apply(
    State(state): State<AppState>,
    AxumPath(endpoint): AxumPath<String>,
    Json(body): Json<PresetNameBody>,
) -> Response {
    let Some(name) = body
        .name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Preset name is required" })),
        )
            .into_response();
    };
    let mut config = config_snapshot(&state);
    let Some(endpoint) = parse_preset_endpoint(&config, &endpoint) else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Unsupported endpoint" })),
        )
            .into_response();
    };

    if endpoint == "anthropic" || endpoint == "openai" {
        let preset = config
            .routing_presets
            .get(&endpoint)
            .and_then(|presets| presets.iter().find(|preset| preset.name == name))
            .cloned();
        let Some(preset) = preset else {
            return (
                StatusCode::NOT_FOUND,
                Json(json!({ "error": "Preset not found" })),
            )
                .into_response();
        };
        let routing = config
            .endpoint_routing
            .entry(endpoint.clone())
            .or_insert_with(|| EndpointRoutingConfig {
                defaults: config.defaults.clone(),
                model_routes: Default::default(),
                model_routes_by_protocol: Default::default(),
                compatibility: None,
            });
        routing.model_routes = preset.model_routes.clone();
        routing.model_routes_by_protocol = preset.model_routes_by_protocol.clone();
        if endpoint == "anthropic" {
            config.model_routes = preset.model_routes;
        }
        match replace_config(&state, config.clone()) {
            Ok(()) => Json(ApplyPresetResponse {
                success: true,
                config: config.sanitize_for_web(),
            })
            .into_response(),
            Err(error) => (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": error.to_string() })),
            )
                .into_response(),
        }
    } else {
        let preset = config
            .custom_endpoints
            .iter()
            .find(|item| item.id == endpoint)
            .and_then(|item| {
                item.routing_presets
                    .iter()
                    .find(|preset| preset.name.eq_ignore_ascii_case(name))
                    .cloned()
            });
        let Some(preset) = preset else {
            return (
                StatusCode::NOT_FOUND,
                Json(json!({ "error": "Preset not found" })),
            )
                .into_response();
        };
        let defaults = config.defaults.clone();
        let Some(custom_endpoint) = config
            .custom_endpoints
            .iter_mut()
            .find(|item| item.id == endpoint)
        else {
            return (
                StatusCode::NOT_FOUND,
                Json(json!({ "error": "Endpoint not found" })),
            )
                .into_response();
        };
        let mut routing = custom_endpoint
            .routing
            .clone()
            .unwrap_or(EndpointRoutingConfig {
                defaults,
                model_routes: Default::default(),
                model_routes_by_protocol: Default::default(),
                compatibility: None,
            });
        routing.model_routes = preset.model_routes;
        routing.model_routes_by_protocol = preset.model_routes_by_protocol;
        custom_endpoint.routing = Some(routing.clone());
        let updated = config.sanitize_for_web();
        match replace_config(&state, config) {
            Ok(()) => Json(ApplyPresetResponse {
                success: true,
                config: updated,
            })
            .into_response(),
            Err(error) => (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": error.to_string() })),
            )
                .into_response(),
        }
    }
}

pub(super) async fn api_routing_presets_delete(
    State(state): State<AppState>,
    AxumPath((endpoint, name)): AxumPath<(String, String)>,
) -> Response {
    let mut config = config_snapshot(&state);
    let Some(endpoint) = parse_preset_endpoint(&config, &endpoint) else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Unsupported endpoint" })),
        )
            .into_response();
    };
    if endpoint == "anthropic" || endpoint == "openai" {
        let Some(presets) = config.routing_presets.get_mut(&endpoint) else {
            return (
                StatusCode::NOT_FOUND,
                Json(json!({ "error": "Preset not found" })),
            )
                .into_response();
        };
        let before = presets.len();
        presets.retain(|preset| preset.name != name);
        if presets.len() == before {
            return (
                StatusCode::NOT_FOUND,
                Json(json!({ "error": "Preset not found" })),
            )
                .into_response();
        }
        let next = presets.clone();
        match replace_config(&state, config) {
            Ok(()) => Json(json!({ "success": true, "presets": next })).into_response(),
            Err(error) => (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": error.to_string() })),
            )
                .into_response(),
        }
    } else {
        let Some(custom_endpoint) = config
            .custom_endpoints
            .iter_mut()
            .find(|item| item.id == endpoint)
        else {
            return (
                StatusCode::NOT_FOUND,
                Json(json!({ "error": "Endpoint not found" })),
            )
                .into_response();
        };
        let before = custom_endpoint.routing_presets.len();
        custom_endpoint
            .routing_presets
            .retain(|preset| preset.name != name);
        if custom_endpoint.routing_presets.len() == before {
            return (
                StatusCode::NOT_FOUND,
                Json(json!({ "error": "Preset not found" })),
            )
                .into_response();
        }
        let next = custom_endpoint.routing_presets.clone();
        match replace_config(&state, config) {
            Ok(()) => Json(json!({ "success": true, "presets": next })).into_response(),
            Err(error) => (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": error.to_string() })),
            )
                .into_response(),
        }
    }
}

pub(super) async fn api_events(
    State(state): State<AppState>,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    let limit = query
        .get("limit")
        .and_then(|value| value.parse::<i64>().ok())
        .unwrap_or(50);
    let cursor = query
        .get("cursor")
        .and_then(|value| value.parse::<i64>().ok())
        .filter(|value| *value > 0);
    let level = query
        .get("level")
        .map(String::as_str)
        .filter(|value| !value.is_empty());
    let event_type = query
        .get("type")
        .map(String::as_str)
        .filter(|value| !value.is_empty());

    match list_events(&state.paths.db_path, limit, cursor, level, event_type, None) {
        Ok(result) => Json(json!(result)).into_response(),
        Err(error) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": error.to_string() })),
        )
            .into_response(),
    }
}

pub(super) async fn api_events_stats(
    State(state): State<AppState>,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    let since = query
        .get("days")
        .and_then(|value| value.parse::<i64>().ok())
        .filter(|value| *value > 0)
        .map(|days| {
            let now = chrono::Utc::now().timestamp_millis();
            now - days.saturating_mul(24 * 60 * 60 * 1000)
        });

    match get_event_stats(&state.paths.db_path, since) {
        Ok(result) => Json(json!(result)).into_response(),
        Err(error) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": error.to_string() })),
        )
            .into_response(),
    }
}

pub(super) async fn api_keys_list(State(state): State<AppState>) -> Response {
    match list_api_keys(&state.paths.db_path) {
        Ok(result) => Json(json!(result)).into_response(),
        Err(error) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": error.to_string() })),
        )
            .into_response(),
    }
}

pub(super) async fn api_keys_create(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<CreateApiKeyBody>,
) -> Response {
    let Some(name) = body.name.as_deref() else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Name is required" })),
        )
            .into_response();
    };

    let allowed_endpoints = match normalize_allowed_endpoints(body.allowed_endpoints) {
        Ok(value) => value,
        Err(error) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": error.to_string() })),
            )
                .into_response();
        }
    };

    if let Some(max) = body.max_concurrency {
        if max < 0 {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "maxConcurrency must be a non-negative integer" })),
            )
                .into_response();
        }
    }

    match create_api_key(
        &state.paths.db_path,
        &state.paths.home_dir,
        name,
        body.description.as_deref(),
        allowed_endpoints,
        body.max_concurrency,
        header_value(&headers, "x-forwarded-for").as_deref(),
    ) {
        Ok(result) => Json(json!(result)).into_response(),
        Err(error) => (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": error.to_string() })),
        )
            .into_response(),
    }
}

pub(super) async fn api_keys_patch(
    State(state): State<AppState>,
    headers: HeaderMap,
    AxumPath(id): AxumPath<i64>,
    Json(body): Json<Value>,
) -> Response {
    let object = match body.as_object() {
        Some(value) => value,
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "Invalid request body" })),
            )
                .into_response();
        }
    };

    let enabled = if object.contains_key("enabled") {
        match object.get("enabled").and_then(Value::as_bool) {
            Some(value) => Some(value),
            None => {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(json!({ "error": "enabled must be a boolean" })),
                )
                    .into_response();
            }
        }
    } else {
        None
    };

    let allowed_endpoints = if object.contains_key("allowedEndpoints") {
        match object.get("allowedEndpoints") {
            Some(Value::Null) => Some(None),
            Some(Value::Array(items)) => {
                let mut values = Vec::new();
                for item in items {
                    let Some(value) = item.as_str() else {
                        return (
                            StatusCode::BAD_REQUEST,
                            Json(json!({ "error": "allowedEndpoints must be an array of strings or null" })),
                        )
                            .into_response();
                    };
                    values.push(value.to_string());
                }
                Some(Some(values))
            }
            _ => {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(
                        json!({ "error": "allowedEndpoints must be an array of strings or null" }),
                    ),
                )
                    .into_response();
            }
        }
    } else {
        None
    };

    let max_concurrency = if object.contains_key("maxConcurrency") {
        match object.get("maxConcurrency") {
            Some(Value::Null) => Some(None),
            Some(Value::Number(n)) => {
                // Reject fractional floats (e.g. 1.5, NaN) — only true integers are accepted.
                if n.is_f64() {
                    let float_val = n.as_f64().unwrap();
                    if float_val != float_val.trunc() || !float_val.is_finite() {
                        return (
                            StatusCode::BAD_REQUEST,
                            Json(json!({ "error": "maxConcurrency must be an integer" })),
                        )
                            .into_response();
                    }
                }
                // as_i64 returns None for values outside i64 range — treat as invalid, not 0.
                let value = match n.as_i64() {
                    Some(v) => v,
                    None => {
                        return (
                            StatusCode::BAD_REQUEST,
                            Json(json!({ "error": "maxConcurrency is out of the accepted range" })),
                        )
                            .into_response();
                    }
                };
                if value < 0 {
                    return (
                        StatusCode::BAD_REQUEST,
                        Json(json!({ "error": "maxConcurrency must be a non-negative integer" })),
                    )
                        .into_response();
                }
                Some(Some(value))
            }
            _ => {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(json!({ "error": "maxConcurrency must be a number or null" })),
                )
                    .into_response();
            }
        }
    } else {
        None
    };

    match update_api_key_settings(
        &state.paths.db_path,
        id,
        enabled,
        allowed_endpoints,
        max_concurrency,
        header_value(&headers, "x-forwarded-for").as_deref(),
    ) {
        Ok(()) => Json(json!({ "success": true })).into_response(),
        Err(error) => {
            let status = match error.to_string().as_str() {
                "API key not found" => StatusCode::NOT_FOUND,
                "Cannot set endpoint restrictions on wildcard key" => StatusCode::FORBIDDEN,
                _ => StatusCode::BAD_REQUEST,
            };
            (status, Json(json!({ "error": error.to_string() }))).into_response()
        }
    }
}

pub(super) async fn api_keys_delete(
    State(state): State<AppState>,
    headers: HeaderMap,
    AxumPath(id): AxumPath<i64>,
) -> Response {
    match delete_api_key(
        &state.paths.db_path,
        id,
        header_value(&headers, "x-forwarded-for").as_deref(),
    ) {
        Ok(()) => Json(json!({ "success": true })).into_response(),
        Err(error) => {
            let status = match error.to_string().as_str() {
                "API key not found" => StatusCode::NOT_FOUND,
                "Cannot delete wildcard key" => StatusCode::FORBIDDEN,
                _ => StatusCode::BAD_REQUEST,
            };
            (status, Json(json!({ "error": error.to_string() }))).into_response()
        }
    }
}

pub(super) async fn api_keys_reveal(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<i64>,
) -> Response {
    match reveal_api_key(&state.paths.db_path, &state.paths.home_dir, id) {
        Ok(Some(key)) => Json(json!({ "key": key })).into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "API key not found or cannot be revealed" })),
        )
            .into_response(),
        Err(error) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": error.to_string() })),
        )
            .into_response(),
    }
}

pub(super) async fn api_logs(
    State(state): State<AppState>,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    let log_query = LogQuery {
        limit: query
            .get("limit")
            .and_then(|v| v.parse().ok())
            .unwrap_or(50),
        offset: query
            .get("offset")
            .and_then(|v| v.parse().ok())
            .unwrap_or(0),
        provider: query.get("provider").cloned().filter(|v| !v.is_empty()),
        model: query.get("model").cloned().filter(|v| !v.is_empty()),
        endpoint: query.get("endpoint").cloned().filter(|v| !v.is_empty()),
        status: query.get("status").cloned().filter(|v| !v.is_empty()),
        from: query.get("from").and_then(|v| v.parse().ok()),
        to: query.get("to").and_then(|v| v.parse().ok()),
        api_key_ids: parse_api_key_ids(
            query
                .get("apiKeys")
                .or_else(|| query.get("apiKeyIds"))
                .or_else(|| query.get("apiKey"))
                .map(String::as_str),
        ),
        client_kind: query
            .get("clientKind")
            .cloned()
            .filter(|value| !value.is_empty()),
        session: query
            .get("session")
            .cloned()
            .filter(|value| !value.is_empty()),
    };

    match query_logs(&state.paths.db_path, &log_query) {
        Ok(result) => {
            let pricing = pricing_engine(&state);
            let mut value = serde_json::to_value(result).unwrap_or_else(|_| json!({}));
            if let Some(items) = value.get_mut("items").and_then(Value::as_array_mut) {
                for item in items {
                    mask_log_record_api_key(item, &state.paths.home_dir);
                }
            }
            attach_log_costs(&mut value, &pricing);
            Json(value).into_response()
        }
        Err(error) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": error.to_string() })),
        )
            .into_response(),
    }
}

pub(super) async fn api_logs_export(
    State(state): State<AppState>,
    Json(body): Json<Value>,
) -> Response {
    let Some(raw) = body.as_object() else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Invalid request body" })),
        )
            .into_response();
    };
    let limit = raw
        .get("limit")
        .and_then(Value::as_i64)
        .unwrap_or(1000)
        .clamp(1, 5000);
    let log_query = LogQuery {
        limit,
        offset: 0,
        provider: raw
            .get("provider")
            .and_then(Value::as_str)
            .map(ToString::to_string)
            .filter(|v| !v.is_empty()),
        model: raw
            .get("model")
            .and_then(Value::as_str)
            .map(ToString::to_string)
            .filter(|v| !v.is_empty()),
        endpoint: raw
            .get("endpoint")
            .and_then(Value::as_str)
            .map(ToString::to_string)
            .filter(|v| !v.is_empty()),
        status: raw
            .get("status")
            .and_then(Value::as_str)
            .map(ToString::to_string)
            .filter(|v| !v.is_empty()),
        from: raw.get("from").and_then(Value::as_i64),
        to: raw.get("to").and_then(Value::as_i64),
        api_key_ids: raw
            .get("apiKeys")
            .and_then(value_to_api_key_ids)
            .or_else(|| raw.get("apiKeyIds").and_then(value_to_api_key_ids))
            .or_else(|| raw.get("apiKey").and_then(value_to_api_key_ids)),
        client_kind: raw
            .get("clientKind")
            .and_then(Value::as_str)
            .map(ToString::to_string)
            .filter(|value| !value.is_empty()),
        session: raw
            .get("session")
            .and_then(Value::as_str)
            .map(ToString::to_string)
            .filter(|value| !value.is_empty()),
    };

    let result = match export_logs(&state.paths.db_path, &log_query) {
        Ok(result) => result,
        Err(error) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": format!("导出日志失败：{error}") })),
            )
                .into_response();
        }
    };

    let pricing = pricing_engine(&state);
    let records = result
        .into_iter()
        .map(|item| {
            let mut value = serde_json::to_value(item).unwrap_or_else(|_| json!({}));
            if let Some(object) = value.as_object_mut() {
                let decrypted = object
                    .get("api_key_value")
                    .and_then(Value::as_str)
                    .and_then(|value| {
                        decrypt_log_api_key_value(&state.paths.home_dir, Some(value))
                    });
                object.insert(
                    "api_key_value_available".to_string(),
                    Value::Bool(decrypted.is_some()),
                );
                object.insert(
                    "api_key_value_masked".to_string(),
                    decrypted
                        .map(|value| Value::String(mask_revealed_key(&value)))
                        .unwrap_or(Value::Null),
                );
                object.insert("api_key_value".to_string(), Value::Null);
            }
            attach_log_costs(&mut value, &pricing);
            value
        })
        .collect::<Vec<_>>();
    let payload = json!({
        "exportedAt": chrono::Utc::now().to_rfc3339(),
        "count": records.len(),
        "limit": limit,
        "records": records,
        "cost_currency": pricing.display_currency().code(),
    });

    let cursor = Cursor::new(Vec::<u8>::new());
    let mut zip = zip::ZipWriter::new(cursor);
    if let Err(error) = zip.start_file("logs.json", SimpleFileOptions::default()) {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("导出日志失败：{error}") })),
        )
            .into_response();
    }
    if let Err(error) = zip.write_all(payload.to_string().as_bytes()) {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("导出日志失败：{error}") })),
        )
            .into_response();
    }
    let buffer = match zip.finish() {
        Ok(cursor) => cursor.into_inner(),
        Err(error) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": format!("导出日志失败：{error}") })),
            )
                .into_response();
        }
    };

    let filename = format!(
        "cc-gw-logs-{}.zip",
        chrono::Utc::now().to_rfc3339().replace([':', '.'], "-")
    );
    match Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "application/zip")
        .header(
            header::CONTENT_DISPOSITION,
            format!("attachment; filename=\"{filename}\""),
        )
        .body(Body::from(buffer))
    {
        Ok(response) => response,
        Err(error) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("导出日志失败：{error}") })),
        )
            .into_response(),
    }
}

pub(super) async fn api_logs_cleanup(State(state): State<AppState>) -> Response {
    let config = config_snapshot(&state);
    let retention_days = config.log_retention_days.unwrap_or(30).max(1) as i64;
    let cutoff = chrono::Utc::now().timestamp_millis() - retention_days * 24 * 60 * 60 * 1000;
    match cleanup_logs_before(&state.paths.db_path, cutoff) {
        Ok(deleted) => Json(json!({ "success": true, "deleted": deleted })).into_response(),
        Err(error) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": error.to_string() })),
        )
            .into_response(),
    }
}

pub(super) async fn api_logs_clear(State(state): State<AppState>) -> Response {
    match clear_all_logs(&state.paths.db_path) {
        Ok((deleted, metrics_cleared)) => Json(json!({
            "success": true,
            "deleted": deleted,
            "metricsCleared": metrics_cleared
        }))
        .into_response(),
        Err(error) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": error.to_string() })),
        )
            .into_response(),
    }
}

pub(super) async fn api_log_detail(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<i64>,
) -> Response {
    match get_log_detail(&state.paths.db_path, id) {
        Ok(Some(result)) => {
            let pricing = pricing_engine(&state);
            let mut value = serde_json::to_value(result).unwrap_or_else(|_| json!({}));
            mask_log_record_api_key(&mut value, &state.paths.home_dir);
            attach_log_costs(&mut value, &pricing);
            Json(value).into_response()
        }
        Ok(None) => (StatusCode::NOT_FOUND, Json(json!({ "error": "Not found" }))).into_response(),
        Err(error) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": error.to_string() })),
        )
            .into_response(),
    }
}

pub(super) async fn api_stats_api_keys_overview(
    State(state): State<AppState>,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    let endpoint = query
        .get("endpoint")
        .map(String::as_str)
        .filter(|value| !value.is_empty());
    let days = query
        .get("days")
        .and_then(|value| value.parse::<i64>().ok())
        .unwrap_or(7)
        .clamp(1, 90);
    match get_api_key_overview_metrics(&state.paths.db_path, days, endpoint) {
        Ok(result) => Json(json!(result)).into_response(),
        Err(error) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": error.to_string() })),
        )
            .into_response(),
    }
}

pub(super) async fn api_stats_api_keys_usage(
    State(state): State<AppState>,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    let endpoint = query
        .get("endpoint")
        .map(String::as_str)
        .filter(|value| !value.is_empty());
    let days = query
        .get("days")
        .and_then(|value| value.parse::<i64>().ok())
        .unwrap_or(7)
        .clamp(1, 90);
    let limit = query
        .get("limit")
        .and_then(|value| value.parse::<i64>().ok())
        .unwrap_or(10)
        .clamp(1, 50);
    let pricing = pricing_engine(&state);
    match get_api_key_usage_metrics(&state.paths.db_path, days, limit, endpoint, &pricing) {
        Ok(result) => Json(json!(result)).into_response(),
        Err(error) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": error.to_string() })),
        )
            .into_response(),
    }
}

pub(super) async fn api_db_info(State(state): State<AppState>) -> Response {
    match get_database_info(&state.paths.db_path) {
        Ok(result) => Json(json!(result)).into_response(),
        Err(error) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": error.to_string() })),
        )
            .into_response(),
    }
}

pub(super) async fn api_db_compact(State(state): State<AppState>) -> Response {
    match compact_database(&state.paths.db_path)
        .and_then(|_| get_database_info(&state.paths.db_path))
    {
        Ok(result) => {
            let mut value = serde_json::to_value(result).unwrap_or_else(|_| json!({}));
            if let Some(object) = value.as_object_mut() {
                object.insert("success".to_string(), Value::Bool(true));
            }
            Json(value).into_response()
        }
        Err(error) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": error.to_string() })),
        )
            .into_response(),
    }
}

pub(super) async fn api_stats_overview(
    State(state): State<AppState>,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    let endpoint = query
        .get("endpoint")
        .map(|value| value.as_str())
        .filter(|v| !v.is_empty());
    let pricing = pricing_engine(&state);
    match get_metrics_overview(&state.paths.db_path, endpoint, &pricing) {
        Ok(result) => Json(json!(result)).into_response(),
        Err(error) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": error.to_string() })),
        )
            .into_response(),
    }
}

pub(super) async fn api_stats_daily(
    State(state): State<AppState>,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    let endpoint = query
        .get("endpoint")
        .map(|value| value.as_str())
        .filter(|v| !v.is_empty());
    let days = query
        .get("days")
        .and_then(|value| value.parse::<i64>().ok())
        .unwrap_or(7)
        .clamp(1, 30);
    let pricing = pricing_engine(&state);
    match get_daily_metrics(&state.paths.db_path, days, endpoint, &pricing) {
        Ok(result) => Json(json!(result)).into_response(),
        Err(error) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": error.to_string() })),
        )
            .into_response(),
    }
}

pub(super) async fn api_stats_model(
    State(state): State<AppState>,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    let endpoint = query
        .get("endpoint")
        .map(|value| value.as_str())
        .filter(|v| !v.is_empty());
    let days = query
        .get("days")
        .and_then(|value| value.parse::<i64>().ok())
        .unwrap_or(7)
        .clamp(1, 90);
    let limit = query
        .get("limit")
        .and_then(|value| value.parse::<i64>().ok())
        .unwrap_or(10)
        .clamp(1, 50);
    let pricing = pricing_engine(&state);
    match get_model_usage_metrics(&state.paths.db_path, days, limit, endpoint, &pricing) {
        Ok(result) => Json(json!(result)).into_response(),
        Err(error) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": error.to_string() })),
        )
            .into_response(),
    }
}

/// Shared query-param parsing for the three dimension stats routes.
fn dimension_stats_params(query: &HashMap<String, String>) -> (i64, i64, Option<&str>) {
    let endpoint = query
        .get("endpoint")
        .map(String::as_str)
        .filter(|value| !value.is_empty());
    let days = query
        .get("days")
        .and_then(|value| value.parse::<i64>().ok())
        .unwrap_or(7)
        .clamp(1, 90);
    let limit = query
        .get("limit")
        .and_then(|value| value.parse::<i64>().ok())
        .unwrap_or(10)
        .clamp(1, 50);
    (days, limit, endpoint)
}

fn dimension_stats_response(
    state: &AppState,
    dimension: UsageDimension,
    days: i64,
    limit: i64,
    endpoint: Option<&str>,
) -> Response {
    let pricing = pricing_engine(state);
    match get_dimension_usage_metrics(
        &state.paths.db_path,
        dimension,
        days,
        limit,
        endpoint,
        &pricing,
    ) {
        Ok(result) => Json(json!(result)).into_response(),
        Err(error) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": error.to_string() })),
        )
            .into_response(),
    }
}

pub(super) async fn api_stats_providers(
    State(state): State<AppState>,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    let (days, limit, endpoint) = dimension_stats_params(&query);
    dimension_stats_response(&state, UsageDimension::Provider, days, limit, endpoint)
}

pub(super) async fn api_stats_endpoints(
    State(state): State<AppState>,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    let (days, limit, endpoint) = dimension_stats_params(&query);
    dimension_stats_response(&state, UsageDimension::Endpoint, days, limit, endpoint)
}

pub(super) async fn api_stats_clients(
    State(state): State<AppState>,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    let (days, limit, endpoint) = dimension_stats_params(&query);
    dimension_stats_response(&state, UsageDimension::ClientKind, days, limit, endpoint)
}

/// `GET /api/billing/prices` — 内置价格表 + 用户覆盖的合并只读视图，
/// 设置页「计费」分区数据源。
pub(super) async fn api_billing_prices(State(state): State<AppState>) -> Response {
    let engine = pricing_engine(&state);
    Json(json!({
        "displayCurrency": engine.display_currency().code(),
        "entries": engine.merged_table(),
    }))
    .into_response()
}
