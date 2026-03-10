use std::env;
use std::path::PathBuf;

pub fn resolve_web_dist() -> Option<PathBuf> {
    let mut candidates = Vec::new();

    if let Ok(explicit) = env::var("CC_GW_UI_ROOT") {
        candidates.push(PathBuf::from(explicit));
    }

    if let Ok(exe_path) = env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            candidates.push(exe_dir.join("../web"));
            candidates.push(exe_dir.join("../web/public"));
            candidates.push(exe_dir.join("../web/dist"));
            candidates.push(exe_dir.join("../../web/dist"));
            candidates.push(exe_dir.join("../../../src/web/dist"));
        }
    }

    if let Ok(cwd) = env::current_dir() {
        candidates.push(cwd.join("src/web/dist"));
    }

    for candidate in candidates {
        let normalized = if candidate.is_absolute() {
            candidate
        } else {
            match env::current_dir() {
                Ok(cwd) => cwd.join(candidate),
                Err(_) => continue,
            }
        };

        if normalized.join("index.html").exists() {
            return Some(normalized);
        }
    }

    None
}
