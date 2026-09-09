use std::path::{Path, PathBuf};
use std::process::Command;

fn detect_framework(pkg_path: &PathBuf) -> Option<String> {
    if let Ok(content) = std::fs::read_to_string(pkg_path) {
        if content.contains("\"next\":") {
            return Some("Next.js".to_string());
        }
        if content.contains("\"vue\":") {
            return Some("Vue".to_string());
        }
        if content.contains("\"svelte\":") || content.contains("\"@sveltejs/kit\":") {
            return Some("Svelte".to_string());
        }
        if content.contains("\"react\":") {
            return Some("React".to_string());
        }
    }
    None
}

fn detect_node_pm(dir: &Path) -> String {
    if dir.join("pnpm-lock.yaml").exists() {
        "pnpm".to_string()
    } else if dir.join("bun.lockb").exists() || dir.join("bun.lock").exists() {
        "bun".to_string()
    } else if dir.join("yarn.lock").exists() {
        "yarn".to_string()
    } else {
        "npm".to_string()
    }
}

fn check_uv_available() -> bool {
    Command::new("uv")
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

fn detect_foreign_project(proj: &Path) -> Option<String> {
    if proj.join("pubspec.yaml").exists() || proj.join(".dart_tool").exists() || proj.join("android").join("app").exists() {
        return Some("Flutter / Dart / Android".to_string());
    }
    if proj.join("build.gradle").exists() || proj.join("build.gradle.kts").exists() || proj.join("pom.xml").exists() {
        return Some("Android / Java / Gradle".to_string());
    }
    if proj.join("Cargo.toml").exists() && !proj.join("main.py").exists() {
        return Some("Rust".to_string());
    }
    if proj.join("go.mod").exists() {
        return Some("Go".to_string());
    }
    if proj.join("artisan").exists() || (proj.join("composer.json").exists() && !proj.join("main.py").exists()) {
        return Some("PHP / Laravel".to_string());
    }
    None
}

fn is_directory_empty(dir: &Path) -> bool {
    if let Ok(mut entries) = std::fs::read_dir(dir) {
        entries.next().is_none()
    } else {
        false
    }
}

fn has_any_python_files(dir: &Path) -> bool {
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                if let Some(ext) = path.extension() {
                    if ext == "py" {
                        return true;
                    }
                }
            }
        }
    }
    false
}

#[derive(serde::Serialize)]
pub struct ProjectStatus {
    pub is_valid_project: bool,
    pub validation_error: Option<String>,
    pub is_empty_dir: bool,
    pub has_venv: bool,
    pub has_main: bool,
    pub has_requirements: bool,
    pub has_frontend: bool,
    pub has_node_modules: bool,
    pub has_env: bool,
    pub is_fastapi: bool,
    pub frontend_dir: Option<String>,
    pub frontend_framework: Option<String>,
    pub detected_node_pm: String,
    pub has_uv: bool,
}

#[tauri::command]
pub fn check_project(project_path: String) -> Result<ProjectStatus, String> {
    let proj = Path::new(&project_path);
    
    if !proj.exists() || !proj.is_dir() {
        return Ok(ProjectStatus {
            is_valid_project: false,
            validation_error: Some("Direktori tidak ditemukan atau tidak valid.".to_string()),
            is_empty_dir: false,
            has_venv: false,
            has_main: false,
            has_requirements: false,
            has_frontend: false,
            has_node_modules: false,
            has_env: false,
            is_fastapi: false,
            frontend_dir: None,
            frontend_framework: None,
            detected_node_pm: "npm".to_string(),
            has_uv: false,
        });
    }

    // Check if foreign project (e.g. Flutter, Android, Rust, Go, Laravel)
    if let Some(foreign_type) = detect_foreign_project(proj) {
        return Ok(ProjectStatus {
            is_valid_project: false,
            validation_error: Some(format!(
                "Folder ini terdeteksi sebagai proyek {} (bukan proyek FastAPI / Python).",
                foreign_type
            )),
            is_empty_dir: false,
            has_venv: false,
            has_main: false,
            has_requirements: false,
            has_frontend: false,
            has_node_modules: false,
            has_env: false,
            is_fastapi: false,
            frontend_dir: None,
            frontend_framework: None,
            detected_node_pm: "npm".to_string(),
            has_uv: false,
        });
    }

    let is_empty = is_directory_empty(proj);

    let venv_dir = proj.join("venv");
    let dot_venv_dir = proj.join(".venv");
    let env_dir = proj.join("env");

    let check_venv = |dir: &PathBuf| -> bool {
        if dir.exists() && dir.is_dir() {
            dir.join("Scripts").join("python.exe").exists() 
                || dir.join("bin").join("python").exists()
                || dir.join("pyvenv.cfg").exists()
        } else {
            false
        }
    };

    let has_venv = check_venv(&venv_dir) || check_venv(&dot_venv_dir) || check_venv(&env_dir);

    let candidates = [
        proj.join("main.py"),
        proj.join("app.py"),
        proj.join("src").join("main.py"),
        proj.join("src").join("app.py"),
        proj.join("app").join("main.py"),
        proj.join("app").join("app.py"),
        proj.join("app").join("__init__.py"),
        proj.join("api").join("main.py"),
    ];

    let mut has_main = false;
    let mut active_main_path = None;

    for path in candidates {
        if path.exists() && path.is_file() {
            has_main = true;
            active_main_path = Some(path);
            break;
        }
    }

    let req_path = proj.join("requirements.txt");
    let has_requirements = req_path.exists() && req_path.is_file();
    let env_path = proj.join(".env");
    
    let root_pkg = proj.join("package.json");
    let sub_pkg = proj.join("frontend").join("package.json");
    
    let (has_frontend, frontend_dir, frontend_framework, has_node_modules, detected_node_pm) = if sub_pkg.exists() && sub_pkg.is_file() {
        let fe_folder = proj.join("frontend");
        let node_modules_exist = fe_folder.join("node_modules").exists();
        (true, Some("frontend".to_string()), detect_framework(&sub_pkg), node_modules_exist, detect_node_pm(&fe_folder))
    } else if root_pkg.exists() && root_pkg.is_file() {
        let node_modules_exist = proj.join("node_modules").exists();
        (true, Some("".to_string()), detect_framework(&root_pkg), node_modules_exist, detect_node_pm(proj))
    } else {
        (false, None, None, false, "npm".to_string())
    };
    
    let is_fastapi = if let Some(path) = active_main_path {
        if let Ok(content) = std::fs::read_to_string(&path) {
            content.to_lowercase().contains("fastapi")
        } else {
            false
        }
    } else if has_requirements {
        if let Ok(content) = std::fs::read_to_string(&req_path) {
            content.to_lowercase().contains("fastapi")
        } else {
            false
        }
    } else {
        false
    };

    let has_py = has_any_python_files(proj);

    // Validation logic:
    // 1. If empty -> Valid new workspace.
    // 2. If has_main && !is_fastapi -> Invalid non-fastapi python project.
    // 3. If !has_main && !has_requirements && !has_venv && !has_py && !is_empty -> Invalid non-python folder.
    let (is_valid_project, validation_error) = if is_empty {
        (true, None)
    } else if has_main && !is_fastapi {
        (false, Some("File main.py/app.py ditemukan, tetapi tidak ada indikasi penggunaan FastAPI.".to_string()))
    } else if !has_main && !has_requirements && !has_venv && !has_py {
        (false, Some("Folder ini bukan proyek FastAPI/Python dan tidak berisi file Python apapun.".to_string()))
    } else {
        (true, None)
    };
    
    Ok(ProjectStatus {
        is_valid_project,
        validation_error,
        is_empty_dir: is_empty,
        has_venv,
        has_main,
        has_requirements,
        has_frontend,
        has_node_modules,
        has_env: env_path.exists() && env_path.is_file(),
        is_fastapi,
        frontend_dir,
        frontend_framework,
        detected_node_pm,
        has_uv: check_uv_available(),
    })
}
