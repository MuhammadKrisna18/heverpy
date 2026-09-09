use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use tauri::{AppHandle, Emitter};

pub fn get_python_exe(project_path: &str) -> PathBuf {
    let proj = Path::new(project_path);
    let dot_venv = proj.join(".venv");
    let venv = proj.join("venv");
    let env = proj.join("env");

    let base = if dot_venv.exists() {
        Some(dot_venv)
    } else if venv.exists() {
        Some(venv)
    } else if env.exists() {
        Some(env)
    } else {
        None
    };

    if let Some(b) = base {
        if cfg!(target_os = "windows") {
            b.join("Scripts").join("python.exe")
        } else {
            b.join("bin").join("python")
        }
    } else {
        PathBuf::from("python")
    }
}

pub fn get_pip_exe(project_path: &str) -> PathBuf {
    let proj = Path::new(project_path);
    let dot_venv = proj.join(".venv");
    let venv = proj.join("venv");
    let env = proj.join("env");

    let base = if dot_venv.exists() {
        Some(dot_venv)
    } else if venv.exists() {
        Some(venv)
    } else if env.exists() {
        Some(env)
    } else {
        None
    };

    if let Some(b) = base {
        if cfg!(target_os = "windows") {
            b.join("Scripts").join("pip.exe")
        } else {
            b.join("bin").join("pip")
        }
    } else {
        PathBuf::from("pip")
    }
}

fn execute_command_with_logs(
    app: &AppHandle,
    cmd_name: &str,
    mut cmd: Command,
    tag: &str,
) -> Result<bool, String> {
    let app_clone = app.clone();
    let mut child = cmd
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start {}: {}", cmd_name, e))?;

    if let Some(stdout) = child.stdout.take() {
        let app_c = app_clone.clone();
        let tag_c = tag.to_string();
        thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines().flatten() {
                let _ = app_c.emit("server-log", format!("[{}] {}", tag_c, line));
            }
        });
    }

    if let Some(stderr) = child.stderr.take() {
        let app_c = app_clone.clone();
        let tag_c = tag.to_string();
        thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines().flatten() {
                let _ = app_c.emit("server-log", format!("[{} ERR] {}", tag_c, line));
            }
        });
    }

    match child.wait() {
        Ok(status) => Ok(status.success()),
        Err(e) => Err(format!("Command {} execution failed: {}", cmd_name, e)),
    }
}

#[tauri::command]
pub fn setup_environment(
    app: AppHandle,
    project_path: String,
    python_pm: Option<String>,
) -> Result<String, String> {
    let pm = python_pm.unwrap_or_else(|| "pip".to_string());
    
    thread::spawn(move || {
        let _ = app.emit("server-log", format!("[SYSTEM] Creating virtual environment using {}...", pm));
        
        let venv_created = if pm == "uv" {
            let mut cmd = Command::new("uv");
            cmd.args(["venv", "venv"]).current_dir(&project_path);
            execute_command_with_logs(&app, "uv venv", cmd, "UV").unwrap_or(false)
        } else {
            let mut cmd = Command::new("python");
            cmd.args(["-m", "venv", "venv"]).current_dir(&project_path);
            execute_command_with_logs(&app, "python -m venv", cmd, "VENV").unwrap_or(false)
        };

        if !venv_created {
            let _ = app.emit("server-log", "[ERROR] Failed to create virtual environment. Ensure Python is installed and added to PATH.");
            return;
        }

        let _ = app.emit("server-log", format!("[SYSTEM] Installing FastAPI & Uvicorn using {}...", pm));
        let python_exe = get_python_exe(&project_path);
        let pip_exe = get_pip_exe(&project_path);

        let install_success = if pm == "uv" {
            let mut cmd = Command::new("uv");
            cmd.args(["pip", "install", "--python", python_exe.to_str().unwrap_or(""), "fastapi", "uvicorn"])
                .current_dir(&project_path);
            execute_command_with_logs(&app, "uv pip install", cmd, "UV").unwrap_or(false)
        } else {
            let mut cmd = Command::new(pip_exe.to_str().unwrap_or("pip"));
            cmd.args(["install", "fastapi", "uvicorn"])
                .current_dir(&project_path);
            execute_command_with_logs(&app, "pip install", cmd, "PIP").unwrap_or(false)
        };

        if install_success {
            let _ = app.emit("server-log", "[SYSTEM] Setup complete! FastAPI & Uvicorn are ready.");
            let _ = app.emit("setup-complete", ());
        } else {
            let _ = app.emit("server-log", "[ERROR] Failed to install FastAPI dependencies.");
        }
    });

    Ok("Setup started".to_string())
}

#[tauri::command]
pub fn generate_boilerplate(project_path: String) -> Result<String, String> {
    let main_path = Path::new(&project_path).join("main.py");
    let boilerplate = r#"from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="FastAPI Herd App")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def read_root():
    return {
        "status": "success",
        "message": "Hello World from FastAPI Backend!",
        "docs_url": "/docs"
    }

@app.get("/api/health")
def health_check():
    return {"status": "ok", "service": "fastapi"}
"#;
    std::fs::write(&main_path, boilerplate).map_err(|e| format!("Failed to generate boilerplate: {}", e))?;
    Ok("Boilerplate main.py generated".to_string())
}

#[tauri::command]
pub fn install_requirements(
    app: AppHandle,
    project_path: String,
    python_pm: Option<String>,
) -> Result<String, String> {
    let pm = python_pm.unwrap_or_else(|| "pip".to_string());

    thread::spawn(move || {
        let _ = app.emit("server-log", format!("[SYSTEM] Installing requirements.txt using {}...", pm));
        let python_exe = get_python_exe(&project_path);
        let pip_exe = get_pip_exe(&project_path);

        let success = if pm == "uv" {
            let mut cmd = Command::new("uv");
            cmd.args(["pip", "install", "--python", python_exe.to_str().unwrap_or(""), "-r", "requirements.txt"])
                .current_dir(&project_path);
            execute_command_with_logs(&app, "uv pip install requirements", cmd, "UV").unwrap_or(false)
        } else {
            let mut cmd = Command::new(pip_exe.to_str().unwrap_or("pip"));
            cmd.args(["install", "-r", "requirements.txt"])
                .current_dir(&project_path);
            execute_command_with_logs(&app, "pip install requirements", cmd, "PIP").unwrap_or(false)
        };

        if success {
            let _ = app.emit("server-log", "[SYSTEM] Requirements installed successfully!");
            let _ = app.emit("setup-complete", ());
        } else {
            let _ = app.emit("server-log", "[ERROR] Failed to install requirements from requirements.txt.");
        }
    });

    Ok("Installing requirements".to_string())
}

#[tauri::command]
pub fn install_frontend(
    app: AppHandle,
    project_path: String,
    framework: String,
    node_pm: Option<String>,
) -> Result<String, String> {
    let pm = node_pm.unwrap_or_else(|| "npm".to_string());

    thread::spawn(move || {
        let _ = app.emit("server-log", format!("[SYSTEM] Scaffolding {} frontend with {}...", framework, pm));

        let scaffold_cmd = match (framework.as_str(), pm.as_str()) {
            ("react", "pnpm") => "pnpm create vite frontend --template react-ts",
            ("react", "yarn") => "yarn create vite frontend --template react-ts",
            ("react", "bun") => "bun create vite frontend --template react-ts",
            ("react", _) => "npm create vite@latest frontend -- --template react-ts",

            ("vue", "pnpm") => "pnpm create vite frontend --template vue-ts",
            ("vue", "yarn") => "yarn create vite frontend --template vue-ts",
            ("vue", "bun") => "bun create vite frontend --template vue-ts",
            ("vue", _) => "npm create vite@latest frontend -- --template vue-ts",

            ("svelte", "pnpm") => "pnpm create vite frontend --template svelte-ts",
            ("svelte", "yarn") => "yarn create vite frontend --template svelte-ts",
            ("svelte", "bun") => "bun create vite frontend --template svelte-ts",
            ("svelte", _) => "npm create vite@latest frontend -- --template svelte-ts",

            ("nextjs", "pnpm") => "pnpm dlx create-next-app@latest frontend --ts --tailwind --eslint --app --src-dir --import-alias @/* --use-pnpm --yes",
            ("nextjs", "yarn") => "yarn create next-app frontend --ts --tailwind --eslint --app --src-dir --import-alias @/* --use-yarn --yes",
            ("nextjs", "bun") => "bunx create-next-app@latest frontend --ts --tailwind --eslint --app --src-dir --import-alias @/* --use-bun --yes",
            ("nextjs", _) => "npx -y create-next-app@latest frontend --ts --tailwind --eslint --app --src-dir --import-alias @/* --use-npm",
            _ => "npm create vite@latest frontend -- --template react-ts",
        };

        let shell = if cfg!(target_os = "windows") { "cmd" } else { "sh" };
        let shell_flag = if cfg!(target_os = "windows") { "/C" } else { "-c" };

        let mut cmd = Command::new(shell);
        cmd.args([shell_flag, scaffold_cmd]).current_dir(&project_path);

        let scaffold_ok = execute_command_with_logs(&app, "frontend scaffold", cmd, &pm.to_uppercase()).unwrap_or(false);

        if !scaffold_ok {
            let _ = app.emit("server-log", "[ERROR] Frontend scaffolding failed.");
            return;
        }

        let _ = app.emit("server-log", format!("[SYSTEM] Scaffold complete. Running `{} install`...", pm));
        let fe_dir = Path::new(&project_path).join("frontend");

        let mut install_cmd = Command::new(shell);
        let install_arg = format!("{} install", pm);
        install_cmd.args([shell_flag, &install_arg]).current_dir(&fe_dir);

        let install_ok = execute_command_with_logs(&app, &install_arg, install_cmd, &pm.to_uppercase()).unwrap_or(false);

        if install_ok {
            let _ = app.emit("server-log", format!("[SYSTEM] Frontend dependencies installed successfully with {}!", pm));
            let _ = app.emit("setup-complete", ());
        } else {
            let _ = app.emit("server-log", format!("[ERROR] `{}` install failed.", pm));
        }
    });

    Ok("Scaffolding frontend started".to_string())
}
