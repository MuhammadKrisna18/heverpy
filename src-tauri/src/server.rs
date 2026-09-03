use std::io::{BufRead, BufReader};
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use tauri::{AppHandle, Emitter, State};

use crate::setup::get_python_exe;

pub struct ServerState {
    pub backend: Mutex<Option<Child>>,
    pub frontend: Mutex<Option<Child>>,
}

#[cfg(target_os = "windows")]
pub fn kill_process_tree(pid: u32, app: &AppHandle) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;

    let output = Command::new("taskkill")
        .args(["/F", "/T", "/PID", &pid.to_string()])
        .creation_flags(CREATE_NO_WINDOW)
        .output();

    match output {
        Ok(out) => {
            let msg = String::from_utf8_lossy(&out.stdout);
            let _ = app.emit("server-log", format!("[SYSTEM] taskkill: {}", msg.trim()));
        }
        Err(e) => {
            let _ = app.emit("server-log", format!("[SYSTEM] taskkill error: {}", e));
        }
    }
}

#[cfg(not(target_os = "windows"))]
pub fn kill_process_tree(pid: u32, app: &AppHandle) {
    let _ = Command::new("kill")
        .args(["-9", &pid.to_string()])
        .output();
    let _ = app.emit("server-log", format!("[SYSTEM] killed pid {}", pid));
}

fn detect_node_dev_command(dir: &Path) -> (&'static str, Vec<&'static str>) {
    if dir.join("pnpm-lock.yaml").exists() {
        ("pnpm", vec!["dev"])
    } else if dir.join("bun.lockb").exists() || dir.join("bun.lock").exists() {
        ("bun", vec!["run", "dev"])
    } else if dir.join("yarn.lock").exists() {
        ("yarn", vec!["dev"])
    } else {
        ("npm", vec!["run", "dev"])
    }
}

#[tauri::command]
pub fn start_server(
    app: AppHandle,
    state: State<'_, ServerState>,
    project_path: String,
    port: Option<u16>,
) -> Result<String, String> {
    let mut backend_guard = state.backend.lock().map_err(|e| e.to_string())?;
    let mut frontend_guard = state.frontend.lock().map_err(|e| e.to_string())?;

    if backend_guard.is_some() || frontend_guard.is_some() {
        return Err("A server is already running!".to_string());
    }

    let proj = Path::new(&project_path);
    let python_exe = get_python_exe(&project_path);
    let main_py = proj.join("main.py");
    let app_py = proj.join("app.py");

    let (has_backend, module_target) = if python_exe.exists() && main_py.exists() {
        (true, "main:app")
    } else if python_exe.exists() && app_py.exists() {
        (true, "app:app")
    } else {
        (false, "main:app")
    };

    let root_pkg = proj.join("package.json");
    let sub_pkg = proj.join("frontend").join("package.json");
    let frontend_dir = if sub_pkg.exists() {
        Some("frontend".to_string())
    } else if root_pkg.exists() {
        Some("".to_string())
    } else {
        None
    };

    if !has_backend && frontend_dir.is_none() {
        return Err("No Backend (FastAPI + venv) or Frontend found to run!".to_string());
    }

    let backend_port = port.unwrap_or(8000).to_string();

    // --- Start Backend ---
    if has_backend {
        let _ = app.emit("server-log", format!("[SYSTEM] Starting FastAPI Backend on port {}...", backend_port));
        
        let mut b_child = Command::new(python_exe)
            .args(["-m", "uvicorn", module_target, "--reload", "--port", &backend_port])
            .current_dir(&project_path)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to start backend: {}", e))?;

        if let Some(b_out) = b_child.stdout.take() {
            let app_clone = app.clone();
            thread::spawn(move || {
                let reader = BufReader::new(b_out);
                for line in reader.lines().flatten() {
                    let _ = app_clone.emit("server-log", format!("[BACKEND] {}", line));
                }
            });
        }

        if let Some(b_err) = b_child.stderr.take() {
            let app_clone2 = app.clone();
            thread::spawn(move || {
                let reader = BufReader::new(b_err);
                for line in reader.lines().flatten() {
                    let _ = app_clone2.emit("server-log", format!("[BACKEND ERR] {}", line));
                }
            });
        }

        *backend_guard = Some(b_child);
    }

    // --- Start Frontend ---
    if let Some(dir) = frontend_dir {
        let fe_path = if dir.is_empty() {
            proj.to_path_buf()
        } else {
            proj.join(dir)
        };

        let (pm_bin, pm_args) = detect_node_dev_command(&fe_path);
        let _ = app.emit("server-log", format!("[SYSTEM] Starting Frontend Server using `{} {}`...", pm_bin, pm_args.join(" ")));

        let shell = if cfg!(target_os = "windows") { "cmd" } else { "sh" };
        let shell_flag = if cfg!(target_os = "windows") { "/C" } else { "-c" };
        let full_dev_cmd = format!("{} {}", pm_bin, pm_args.join(" "));

        let mut f_child = Command::new(shell)
            .args([shell_flag, &full_dev_cmd])
            .current_dir(&fe_path)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to start frontend: {}", e))?;

        if let Some(f_out) = f_child.stdout.take() {
            let app_clone3 = app.clone();
            thread::spawn(move || {
                let reader = BufReader::new(f_out);
                for line in reader.lines().flatten() {
                    let _ = app_clone3.emit("server-log", format!("[FRONTEND] {}", line));
                }
            });
        }

        if let Some(f_err) = f_child.stderr.take() {
            let app_clone4 = app.clone();
            thread::spawn(move || {
                let reader = BufReader::new(f_err);
                for line in reader.lines().flatten() {
                    let _ = app_clone4.emit("server-log", format!("[FRONTEND ERR] {}", line));
                }
            });
        }

        *frontend_guard = Some(f_child);
    }

    let _ = app.emit("server-log", "[SYSTEM] Server processes started successfully!");
    Ok("Servers started".to_string())
}

#[tauri::command]
pub fn stop_server(app: AppHandle, state: State<'_, ServerState>) -> Result<String, String> {
    let mut backend_guard = state.backend.lock().map_err(|e| e.to_string())?;
    let mut frontend_guard = state.frontend.lock().map_err(|e| e.to_string())?;

    let mut stopped_any = false;

    if let Some(mut child) = backend_guard.take() {
        let pid = child.id();
        kill_process_tree(pid, &app);
        let _ = child.kill();
        let _ = child.wait();
        let _ = app.emit("server-log", "[SYSTEM] Backend server stopped.");
        stopped_any = true;
    }

    if let Some(mut child) = frontend_guard.take() {
        let pid = child.id();
        kill_process_tree(pid, &app);
        let _ = child.kill();
        let _ = child.wait();
        let _ = app.emit("server-log", "[SYSTEM] Frontend server stopped.");
        stopped_any = true;
    }

    if stopped_any {
        Ok("Servers stopped".to_string())
    } else {
        Err("No servers are currently running".to_string())
    }
}
