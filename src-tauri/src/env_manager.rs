use std::fs;
use std::path::Path;

#[tauri::command]
pub fn read_env(project_path: String) -> Result<String, String> {
    let env_path = Path::new(&project_path).join(".env");
    if env_path.exists() && env_path.is_file() {
        fs::read_to_string(&env_path).map_err(|e| format!("Failed to read .env file: {}", e))
    } else {
        Ok(String::new())
    }
}

#[tauri::command]
pub fn save_env(project_path: String, content: String) -> Result<String, String> {
    let env_path = Path::new(&project_path).join(".env");
    fs::write(&env_path, content).map_err(|e| format!("Failed to save .env file: {}", e))?;
    Ok("File .env successfully saved.".to_string())
}

#[tauri::command]
pub fn generate_default_env(project_path: String) -> Result<String, String> {
    let env_path = Path::new(&project_path).join(".env");
    let default_content = r#"# FastAPI Environment Configuration
PROJECT_NAME="FastAPI Herd Application"
DEBUG=True
HOST="127.0.0.1"
PORT=8000
SECRET_KEY="change_this_to_a_secure_random_secret_key"
CORS_ORIGINS="http://localhost:5173,http://localhost:3000,http://localhost:8000"

# Database Configuration (Optional)
# DATABASE_URL="sqlite:///./test.db"
# DATABASE_URL="postgresql://user:password@localhost:5432/dbname"
"#;
    fs::write(&env_path, default_content).map_err(|e| format!("Failed to generate default .env: {}", e))?;
    Ok(default_content.to_string())
}
