import { useState, useEffect, useRef, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import "./App.css";

interface ProjectStatus {
  is_valid_project: boolean;
  validation_error: string | null;
  is_empty_dir: boolean;
  has_venv: boolean;
  has_main: boolean;
  has_requirements: boolean;
  has_frontend: boolean;
  has_node_modules: boolean;
  has_env: boolean;
  is_fastapi: boolean;
  frontend_dir: string | null;
  frontend_framework: string | null;
  detected_node_pm: string;
  has_uv: boolean;
}

interface LogEntry {
  id: number;
  timestamp: string;
  raw: string;
  tag: string;
  type: "backend" | "frontend" | "system" | "error" | "info";
  message: string;
}

interface EnvEntry {
  id: string;
  key: string;
  value: string;
  isSecret: boolean;
}

function parseLogLine(raw: string, id: number): LogEntry {
  const time = new Date().toLocaleTimeString();
  let tag = "INFO";
  let type: LogEntry["type"] = "info";
  let message = raw;

  const tagMatch = raw.match(/^\[([^\]]+)\]\s*(.*)$/);
  if (tagMatch) {
    tag = tagMatch[1].toUpperCase();
    message = tagMatch[2];

    if (tag.includes("ERR") || tag.includes("ERROR")) {
      type = "error";
    } else if (tag.includes("BACKEND")) {
      type = "backend";
    } else if (tag.includes("FRONTEND")) {
      type = "frontend";
    } else if (
      tag.includes("SYSTEM") ||
      tag.includes("PIP") ||
      tag.includes("UV") ||
      tag.includes("NPM") ||
      tag.includes("PNPM") ||
      tag.includes("YARN") ||
      tag.includes("BUN")
    ) {
      type = "system";
    }
  } else if (raw.toLowerCase().includes("error") || raw.toLowerCase().includes("traceback")) {
    type = "error";
    tag = "ERROR";
  }

  return {
    id,
    timestamp: time,
    raw,
    tag,
    type,
    message,
  };
}

function parseEnvToEntries(raw: string): EnvEntry[] {
  const lines = raw.split("\n");
  const entries: EnvEntry[] = [];

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      return;
    }
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx !== -1) {
      const key = trimmed.slice(0, eqIdx).trim();
      let value = trimmed.slice(eqIdx + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      const isSecret = /secret|password|key|token|auth|pwd/i.test(key);
      entries.push({
        id: `env-${index}-${key}`,
        key,
        value,
        isSecret,
      });
    }
  });

  return entries;
}

function serializeEntriesToEnv(entries: EnvEntry[]): string {
  return entries
    .filter((e) => e.key.trim() !== "")
    .map((e) => {
      const key = e.key.trim().toUpperCase();
      const val = e.value;
      const needsQuotes = val.includes(" ") || val.includes(",") || val.includes(":");
      return `${key}=${needsQuotes ? `"${val}"` : val}`;
    })
    .join("\n");
}

function App() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const logCounterRef = useRef(0);
  const [isRunning, setIsRunning] = useState(false);
  const [projectPath, setProjectPath] = useState<string | null>(() => {
    return localStorage.getItem("heverpy_last_project") || null;
  });

  // Project & Status
  const [status, setStatus] = useState<ProjectStatus | null>(null);
  const [isSettingUp, setIsSettingUp] = useState(false);
  const [folderRejectionModal, setFolderRejectionModal] = useState<{ open: boolean; folderPath: string; reason: string }>({
    open: false,
    folderPath: "",
    reason: "",
  });

  // Modern Package Manager Choices
  const [selectedPythonPm, setSelectedPythonPm] = useState<"pip" | "uv">("pip");
  const [selectedNodePm, setSelectedNodePm] = useState<"npm" | "pnpm" | "yarn" | "bun">("npm");
  const [selectedFramework, setSelectedFramework] = useState("react");

  // Server URLs & Ports
  const [backendPort, setBackendPort] = useState<number>(8000);
  const [frontendUrl, setFrontendUrl] = useState<string>("http://localhost:5173");

  // Log Manager States
  const [activeLogTab, setActiveLogTab] = useState<"all" | "backend" | "frontend" | "system" | "error">("all");
  const [searchLogQuery, setSearchLogQuery] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  const [copySuccess, setCopySuccess] = useState(false);

  // Environment Variables Manager (.env) States
  const [isEnvModalOpen, setIsEnvModalOpen] = useState(false);
  const [envRawContent, setEnvRawContent] = useState("");
  const [envEntries, setEnvEntries] = useState<EnvEntry[]>([]);
  const [envMode, setEnvMode] = useState<"table" | "raw">("table");
  const [envSaveStatus, setEnvSaveStatus] = useState<string | null>(null);
  const [showSecretMap, setShowSecretMap] = useState<Record<string, boolean>>({});

  const logEndRef = useRef<HTMLDivElement>(null);
  const logContainerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll when logs change
  useEffect(() => {
    if (autoScroll && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, autoScroll, activeLogTab, searchLogQuery]);

  // Load project status on mount or projectPath change
  useEffect(() => {
    if (projectPath) {
      checkProjectStatus(projectPath);
      loadEnvFile(projectPath);
    }
  }, [projectPath]);

  // Tauri Event Listeners
  useEffect(() => {
    const stripAnsi = (str: string) =>
      str.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, "");

    const unlistenLog = listen<string>("server-log", (event) => {
      const cleanMsg = stripAnsi(event.payload);
      logCounterRef.current += 1;
      const entry = parseLogLine(cleanMsg, logCounterRef.current);
      setLogs((prev) => [...prev, entry]);

      // Auto-detect frontend URL from logs
      if (cleanMsg.includes("http://localhost:") || cleanMsg.includes("http://127.0.0.1:")) {
        const match = cleanMsg.match(/http:\/\/(localhost|127\.0\.0\.1):\d+/);
        if (match && !cleanMsg.includes(`:${backendPort}`)) {
          setFrontendUrl(match[0]);
        }
      }
    });

    const unlistenSetup = listen<void>("setup-complete", () => {
      setIsSettingUp(false);
      if (projectPath) {
        checkProjectStatus(projectPath);
        loadEnvFile(projectPath);
      }
    });

    return () => {
      unlistenLog.then((f) => f());
      unlistenSetup.then((f) => f());
    };
  }, [projectPath, backendPort]);

  async function checkProjectStatus(path: string) {
    try {
      const res = await invoke<ProjectStatus>("check_project", { projectPath: path });
      if (!res.is_valid_project) {
        setStatus(null);
        setProjectPath(null);
        localStorage.removeItem("heverpy_last_project");
        setFolderRejectionModal({
          open: true,
          folderPath: path,
          reason: res.validation_error || "Bukan proyek FastAPI yang valid.",
        });
        addLogEntry(`[ERROR] Folder '${path}' ditolak: ${res.validation_error}`);
        return;
      }

      setStatus(res);
      if (res.detected_node_pm) {
        setSelectedNodePm(res.detected_node_pm as "npm" | "pnpm" | "yarn" | "bun");
      }
      if (res.has_uv) {
        setSelectedPythonPm("uv");
      }
    } catch (error) {
      console.error(error);
      addLogEntry(`[ERROR] Gagal memeriksa status proyek: ${error}`);
    }
  }

  function addLogEntry(raw: string) {
    logCounterRef.current += 1;
    const entry = parseLogLine(raw, logCounterRef.current);
    setLogs((prev) => [...prev, entry]);
  }

  async function selectProject() {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Select FastAPI Project Directory",
      });
      if (selected !== null) {
        const pathStr = selected as string;
        
        // Validate directory first!
        const res = await invoke<ProjectStatus>("check_project", { projectPath: pathStr });
        if (!res.is_valid_project) {
          setFolderRejectionModal({
            open: true,
            folderPath: pathStr,
            reason: res.validation_error || "Folder yang Anda pilih bukan proyek FastAPI yang valid.",
          });
          addLogEntry(`[ERROR] Folder ditolak: ${pathStr}`);
          addLogEntry(`[ERROR] Alasan: ${res.validation_error}`);
          return; // DO NOT IMPORT
        }

        // Valid -> Set project
        setProjectPath(pathStr);
        setStatus(res);
        localStorage.setItem("heverpy_last_project", pathStr);
        addLogEntry(`[SYSTEM] Folder dibuka: ${pathStr}`);
        if (res.is_empty_dir) {
          addLogEntry(`[SYSTEM] Folder kosong terdeteksi. Silakan setup lingkungan di panel samping.`);
        }
        await loadEnvFile(pathStr);
      }
    } catch (error) {
      addLogEntry(`[ERROR] Gagal memilih direktori: ${error}`);
    }
  }

  async function loadEnvFile(path: string) {
    try {
      const content = await invoke<string>("read_env", { projectPath: path });
      setEnvRawContent(content);
      setEnvEntries(parseEnvToEntries(content));
    } catch (error) {
      console.error(error);
    }
  }

  async function handleSaveEnv() {
    if (!projectPath) return;
    setEnvSaveStatus("Saving...");
    try {
      const contentToSave = envMode === "table" ? serializeEntriesToEnv(envEntries) : envRawContent;
      await invoke("save_env", { projectPath, content: contentToSave });
      setEnvRawContent(contentToSave);
      setEnvEntries(parseEnvToEntries(contentToSave));
      setEnvSaveStatus("Tersimpan.");
      addLogEntry("[SYSTEM] File .env berhasil disimpan.");
      await checkProjectStatus(projectPath);
      setTimeout(() => setEnvSaveStatus(null), 2500);
    } catch (error) {
      setEnvSaveStatus(`Error: ${error}`);
      addLogEntry(`[ERROR] Gagal menyimpan .env: ${error}`);
    }
  }

  async function handleGenerateDefaultEnv() {
    if (!projectPath) return;
    try {
      const template = await invoke<string>("generate_default_env", { projectPath });
      setEnvRawContent(template);
      setEnvEntries(parseEnvToEntries(template));
      setEnvSaveStatus("Template dibuat.");
      addLogEntry("[SYSTEM] Template .env default dibuat.");
      await checkProjectStatus(projectPath);
      setTimeout(() => setEnvSaveStatus(null), 2500);
    } catch (error) {
      setEnvSaveStatus(`Error: ${error}`);
      addLogEntry(`[ERROR] Gagal membuat template: ${error}`);
    }
  }

  function addEnvRow() {
    const newEntry: EnvEntry = {
      id: `env-${Date.now()}`,
      key: "NEW_KEY",
      value: "",
      isSecret: false,
    };
    setEnvEntries((prev) => [...prev, newEntry]);
  }

  function updateEnvRow(id: string, field: "key" | "value", val: string) {
    setEnvEntries((prev) =>
      prev.map((item) => {
        if (item.id === id) {
          const updated = { ...item, [field]: val };
          if (field === "key") {
            updated.isSecret = /secret|password|key|token|auth|pwd/i.test(val);
          }
          return updated;
        }
        return item;
      })
    );
  }

  function deleteEnvRow(id: string) {
    setEnvEntries((prev) => prev.filter((item) => item.id !== id));
  }

  async function startServer() {
    if (!projectPath) return;
    try {
      await invoke("start_server", { projectPath, port: backendPort });
      setIsRunning(true);
      addLogEntry(`[SYSTEM] Menjalankan FastAPI pada port ${backendPort}...`);

      // Auto open browser
      setTimeout(() => {
        if (status?.has_frontend) {
          openUrl(frontendUrl);
        } else {
          openUrl(`http://localhost:${backendPort}`);
        }
      }, 2200);
    } catch (error) {
      addLogEntry(`[ERROR] ${error}`);
    }
  }

  async function stopServer() {
    try {
      const response = await invoke<string>("stop_server");
      addLogEntry(`[SYSTEM] ${response}`);
      setIsRunning(false);
    } catch (error) {
      addLogEntry(`[ERROR] ${error}`);
    }
  }

  async function handleSetupEnvironment() {
    if (!projectPath) return;
    setIsSettingUp(true);
    try {
      await invoke("setup_environment", { projectPath, pythonPm: selectedPythonPm });
    } catch (error) {
      addLogEntry(`[ERROR] ${error}`);
      setIsSettingUp(false);
    }
  }

  async function handleGenerateBoilerplate() {
    if (!projectPath) return;
    try {
      await invoke("generate_boilerplate", { projectPath });
      addLogEntry("[SYSTEM] main.py boilerplate dibuat.");
      checkProjectStatus(projectPath);
    } catch (error) {
      addLogEntry(`[ERROR] ${error}`);
    }
  }

  async function handleInstallRequirements() {
    if (!projectPath) return;
    setIsSettingUp(true);
    try {
      await invoke("install_requirements", { projectPath, pythonPm: selectedPythonPm });
    } catch (error) {
      addLogEntry(`[ERROR] ${error}`);
      setIsSettingUp(false);
    }
  }

  async function handleInstallFrontend() {
    if (!projectPath) return;
    setIsSettingUp(true);
    try {
      await invoke("install_frontend", {
        projectPath,
        framework: selectedFramework,
        nodePm: selectedNodePm,
      });
    } catch (error) {
      addLogEntry(`[ERROR] ${error}`);
      setIsSettingUp(false);
    }
  }

  // Filtered Logs
  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      // Tab category filter
      if (activeLogTab === "backend" && log.type !== "backend") return false;
      if (activeLogTab === "frontend" && log.type !== "frontend") return false;
      if (activeLogTab === "system" && log.type !== "system") return false;
      if (activeLogTab === "error" && log.type !== "error") return false;

      // Search query filter
      if (searchLogQuery.trim()) {
        const q = searchLogQuery.toLowerCase();
        return (
          log.raw.toLowerCase().includes(q) ||
          log.tag.toLowerCase().includes(q) ||
          log.message.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [logs, activeLogTab, searchLogQuery]);

  function handleCopyLogs() {
    const text = filteredLogs.map((l) => `[${l.timestamp}] ${l.raw}`).join("\n");
    navigator.clipboard.writeText(text);
    setCopySuccess(true);
    setTimeout(() => setCopySuccess(false), 2000);
  }

  function handleExportLogs() {
    const text = filteredLogs.map((l) => `[${l.timestamp}] ${l.raw}`).join("\n");
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `heverpy-logs-${Date.now()}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const isVenvReady = status?.has_venv ?? false;
  const isMainReady = status?.has_main ?? false;
  const isFastapi = status?.is_fastapi ?? false;
  const hasFrontend = status?.has_frontend ?? false;
  const hasRequirements = status?.has_requirements ?? false;
  const isProjectReady = isMainReady && isFastapi;

  return (
    <main className="app-container">
      {/* ============================================================
          LEFT SIDEBAR: CONTROLS, SERVICES & ENVIRONMENT CONFIG
          ============================================================ */}
      <aside className="sidebar">
        {/* BRAND HEADER */}
        <div className="sidebar-header">
          <div className="brand-group">
            <div className="brand-badge">HP</div>
            <div>
              <div className="brand-title">HeverPy</div>
              <div className="brand-subtitle">FastAPI Tool</div>
            </div>
          </div>


        </div>

        {/* DIRECTORY SELECTOR */}
        <div className="section-box">
          <div className="directory-picker-row">
            <button
              onClick={selectProject}
              className="btn-choose-dir"
              disabled={isRunning || isSettingUp}
            >
              Browse Folder
            </button>
            <div className="path-display-box" title={projectPath || "Tidak ada folder yang dipilih"}>
              {projectPath ? projectPath : "Pilih folder proyek FastAPI..."}
            </div>
          </div>
        </div>

        {/* SERVER ACTION CARD */}
        <div className="server-control-card">
          <div className="server-actions-row">
            <button
              onClick={startServer}
              className="btn-server-start"
              disabled={isRunning || !projectPath || !isProjectReady || isSettingUp}
            >
              Start Servers
            </button>
            <button
              onClick={stopServer}
              className="btn-server-stop"
              disabled={!isRunning}
            >
              Stop
            </button>
          </div>

          <div className="port-config-row">
            <span className="port-config-label">FastAPI Port:</span>
            <input
              type="number"
              className="port-input-field"
              value={backendPort}
              onChange={(e) => setBackendPort(Number(e.target.value) || 8000)}
              disabled={isRunning}
            />
          </div>
        </div>

        {/* ACTIVE SERVICES & QUICK LINKS */}
        <div className="status-grid">
          {/* Backend Pill */}
          <div className={`service-pill ${isRunning && isMainReady ? "active-pill" : ""}`}>
            <div className="service-info-left">
              <span className={`status-dot ${isRunning && isMainReady ? "dot-running" : isMainReady ? "dot-ready" : "dot-offline"}`} />
              <span className="service-title">FastAPI Backend</span>
            </div>
            {isRunning && isMainReady ? (
              <div style={{ display: "flex", gap: "0.3rem" }}>
                <a href={`http://localhost:${backendPort}`} target="_blank" rel="noreferrer" className="service-link">
                  :{backendPort} →
                </a>
                <a href={`http://localhost:${backendPort}/docs`} target="_blank" rel="noreferrer" className="service-link docs-btn" title="Buka Swagger OpenAPI Documentation">
                  Docs →
                </a>
              </div>
            ) : (
              <span style={{ fontSize: "0.75rem", color: "#64748b" }}>
                {isMainReady ? "Ready" : "Not Ready"}
              </span>
            )}
          </div>

          {/* Frontend Pill */}
          <div className={`service-pill ${isRunning && hasFrontend ? "active-pill" : ""}`}>
            <div className="service-info-left">
              <span className={`status-dot ${isRunning && hasFrontend ? "dot-running" : hasFrontend ? "dot-ready" : "dot-offline"}`} />
              <span className="service-title">
                Frontend {status?.frontend_framework ? `(${status.frontend_framework})` : ""}
              </span>
            </div>
            {isRunning && hasFrontend ? (
              <a href={frontendUrl} target="_blank" rel="noreferrer" className="service-link">
                Open UI →
              </a>
            ) : (
              <span style={{ fontSize: "0.75rem", color: "#64748b" }}>
                {hasFrontend ? "Ready" : "None"}
              </span>
            )}
          </div>
        </div>

        {/* ONBOARDING CARD (when no project selected) */}
        {!projectPath && (
          <div className="onboarding-card">
            <div className="onboarding-title">🚀 Mulai Menggunakan HeverPy</div>
            <div className="onboarding-steps">
              <div className="onboarding-step">
                <span className="onboarding-num">1</span>
                <span>Klik <strong>Browse Folder</strong> di atas</span>
              </div>
              <div className="onboarding-step">
                <span className="onboarding-num">2</span>
                <span>Pilih folder proyek <strong>FastAPI</strong> atau folder kosong baru</span>
              </div>
              <div className="onboarding-step">
                <span className="onboarding-num">3</span>
                <span>HeverPy otomatis mendeteksi dan menyiapkan environment</span>
              </div>
            </div>
          </div>
        )}


      </aside>

      {/* ============================================================
          RIGHT MAIN STUDIO: FULL HEIGHT TERMINAL LOGS & CONTROLS
          ============================================================ */}
      <section className="main-studio">
        {/* STUDIO TOPBAR */}
        <div className="studio-topbar">
          {/* TABS */}
          <div className="studio-tabs">
            <button
              className={`tab-btn ${activeLogTab === "all" ? "active" : ""}`}
              onClick={() => setActiveLogTab("all")}
            >
              All ({logs.length})
            </button>
            <button
              className={`tab-btn ${activeLogTab === "backend" ? "active" : ""}`}
              onClick={() => setActiveLogTab("backend")}
            >
              Backend ({logs.filter((l) => l.type === "backend").length})
            </button>
            <button
              className={`tab-btn ${activeLogTab === "frontend" ? "active" : ""}`}
              onClick={() => setActiveLogTab("frontend")}
            >
              Frontend ({logs.filter((l) => l.type === "frontend").length})
            </button>
            <button
              className={`tab-btn ${activeLogTab === "system" ? "active" : ""}`}
              onClick={() => setActiveLogTab("system")}
            >
              System ({logs.filter((l) => l.type === "system").length})
            </button>
            <button
              className={`tab-btn tab-err ${activeLogTab === "error" ? "active" : ""}`}
              onClick={() => setActiveLogTab("error")}
            >
              Errors ({logs.filter((l) => l.type === "error").length})
            </button>
          </div>

          {/* TOOLS */}
          <div className="studio-tools">
            <div className="search-field-wrap">
              <input
                type="text"
                placeholder="Search logs..."
                className="search-input"
                value={searchLogQuery}
                onChange={(e) => setSearchLogQuery(e.target.value)}
              />
              {searchLogQuery && (
                <button className="search-clear-btn" onClick={() => setSearchLogQuery("")}>
                  ×
                </button>
              )}
            </div>

            <label className="scroll-checkbox-label" title="Auto-scroll log">
              <input
                type="checkbox"
                checked={autoScroll}
                onChange={(e) => setAutoScroll(e.target.checked)}
              />
              <span>Auto-scroll</span>
            </label>

            <button className="studio-tool-btn" onClick={handleCopyLogs} title="Salin log">
              {copySuccess ? "Copied" : "Copy"}
            </button>
            <button className="studio-tool-btn" onClick={handleExportLogs} title="Ekspor log ke file .txt">
              Export
            </button>
            <button className="studio-tool-btn btn-clear-logs" onClick={() => setLogs([])} title="Bersihkan log">
              Clear
            </button>
          </div>
        </div>

        {/* TERMINAL OUTPUT SCREEN */}
        <div className="terminal-screen" ref={logContainerRef}>
          {filteredLogs.length === 0 ? (
            <div className="terminal-empty">
              {logs.length === 0 ? (
                <div className="terminal-empty-hero">
                  <div className="empty-icon">⚡</div>
                  <div className="empty-title">HeverPy Terminal</div>
                  <div className="empty-desc">
                    {projectPath
                      ? 'Klik "Start Servers" untuk menjalankan FastAPI backend dan frontend dev server.'
                      : "Pilih folder proyek FastAPI di sidebar untuk memulai."}
                  </div>
                </div>
              ) : (
                <div className="terminal-empty-filter">
                  {`Tidak ada log cocok dengan filter "${activeLogTab}"${searchLogQuery ? ` / query "${searchLogQuery}"` : ""}`}
                </div>
              )}
            </div>
          ) : (
            filteredLogs.map((entry) => (
              <div key={entry.id} className={`log-row ${entry.type === "error" ? "row-error" : ""}`}>
                <span className="log-ts">[{entry.timestamp}]</span>
                <span className={`log-pill-tag pill-${entry.type}`}>{entry.tag}</span>
                <span className="log-msg">{entry.message}</span>
              </div>
            ))
          )}
          <div ref={logEndRef} />
        </div>
      </section>

      {/* ============================================================
          FOLDER REJECTION DIALOG (MODAL)
          ============================================================ */}
      {folderRejectionModal.open && (
        <div className="modal-overlay" onClick={() => setFolderRejectionModal({ open: false, folderPath: "", reason: "" })}>
          <div className="modal-dialog" style={{ maxWidth: "480px" }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-title-bar" style={{ borderBottomColor: "var(--red-border)", background: "var(--red-light)" }}>
              <h2 style={{ color: "var(--red)", margin: 0, fontSize: "1.1rem" }}>
                Folder Ditolak
              </h2>
              <button className="modal-close-x" onClick={() => setFolderRejectionModal({ open: false, folderPath: "", reason: "" })}>
                ×
              </button>
            </div>

            <div className="modal-dialog-body" style={{ padding: "1.25rem", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              <p style={{ fontSize: "0.85rem", color: "#1e293b", margin: 0 }}>
                Folder yang Anda pilih tidak dapat dibuka atau diimport:
              </p>
              <div style={{ background: "#f8fafc", border: "1px solid #cbd5e1", borderRadius: "6px", padding: "0.5rem 0.75rem", fontFamily: "monospace", fontSize: "0.8rem", color: "#475569", wordBreak: "break-all" }}>
                {folderRejectionModal.folderPath}
              </div>
              <div className="alert-box-red">
                <strong>Alasan:</strong> {folderRejectionModal.reason}
              </div>
              <p style={{ fontSize: "0.75rem", color: "#64748b", margin: 0 }}>
                HeverPy hanya mendukung proyek FastAPI / Python atau folder kosong baru untuk inisialisasi.
              </p>
            </div>

            <div className="modal-bottom-bar" style={{ justifyContent: "flex-end" }}>
              <button className="btn-modal-save" style={{ background: "var(--red)" }} onClick={() => setFolderRejectionModal({ open: false, folderPath: "", reason: "" })}>
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================
          ENVIRONMENT VARIABLES (.env) MODAL
          ============================================================ */}
      {isEnvModalOpen && (
        <div className="modal-overlay" onClick={() => setIsEnvModalOpen(false)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title-bar">
              <h2>Environment Variables (.env)</h2>
              <button className="modal-close-x" onClick={() => setIsEnvModalOpen(false)}>
                ×
              </button>
            </div>

            <div className="modal-nav-bar">
              <div className="modal-mode-tabs">
                <button
                  className={`modal-mode-btn ${envMode === "table" ? "active" : ""}`}
                  onClick={() => {
                    setEnvEntries(parseEnvToEntries(envRawContent));
                    setEnvMode("table");
                  }}
                >
                  Key-Value Table
                </button>
                <button
                  className={`modal-mode-btn ${envMode === "raw" ? "active" : ""}`}
                  onClick={() => {
                    setEnvRawContent(serializeEntriesToEnv(envEntries));
                    setEnvMode("raw");
                  }}
                >
                  Raw Text Editor
                </button>
              </div>

              <div style={{ display: "flex", gap: "0.4rem" }}>
                <button className="studio-tool-btn" onClick={handleGenerateDefaultEnv}>
                  Generate Template
                </button>
                {envMode === "table" && (
                  <button className="studio-tool-btn" onClick={addEnvRow} style={{ color: "var(--blue)", borderColor: "var(--blue)" }}>
                    + Add Variable
                  </button>
                )}
              </div>
            </div>

            <div className="modal-dialog-body">
              {envMode === "table" ? (
                <table className="env-data-table">
                  <thead>
                    <tr>
                      <th style={{ width: "35%" }}>KEY</th>
                      <th style={{ width: "50%" }}>VALUE</th>
                      <th style={{ width: "15%", textAlign: "center" }}>ACTION</th>
                    </tr>
                  </thead>
                  <tbody>
                    {envEntries.length === 0 ? (
                      <tr>
                        <td colSpan={3} style={{ textAlign: "center", padding: "2rem", color: "#64748b" }}>
                          Belum ada variabel di .env. Klik "Generate Template" atau "+ Add Variable".
                        </td>
                      </tr>
                    ) : (
                      envEntries.map((row) => {
                        const isHidden = row.isSecret && !showSecretMap[row.id];
                        return (
                          <tr key={row.id}>
                            <td>
                              <input
                                type="text"
                                className="table-input key-field"
                                value={row.key}
                                placeholder="VARIABLE_NAME"
                                onChange={(e) => updateEnvRow(row.id, "key", e.target.value)}
                              />
                            </td>
                            <td>
                              <div className="val-field-wrapper">
                                <input
                                  type={isHidden ? "password" : "text"}
                                  className="table-input"
                                  value={row.value}
                                  placeholder="value"
                                  onChange={(e) => updateEnvRow(row.id, "value", e.target.value)}
                                />
                                {row.isSecret && (
                                  <button
                                    type="button"
                                    className="btn-show-hide"
                                    onClick={() =>
                                      setShowSecretMap((prev) => ({ ...prev, [row.id]: !prev[row.id] }))
                                    }
                                  >
                                    {isHidden ? "Show" : "Hide"}
                                  </button>
                                )}
                              </div>
                            </td>
                            <td style={{ textAlign: "center" }}>
                              <button
                                type="button"
                                className="btn-del-row"
                                onClick={() => deleteEnvRow(row.id)}
                                title="Hapus variabel"
                              >
                                Delete
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              ) : (
                <textarea
                  className="raw-env-textarea"
                  value={envRawContent}
                  onChange={(e) => setEnvRawContent(e.target.value)}
                  placeholder="# KEY=VALUE"
                  rows={12}
                />
              )}
            </div>

            <div className="modal-bottom-bar">
              {envSaveStatus && <span className="save-status-indicator">{envSaveStatus}</span>}
              <div className="modal-bottom-actions">
                <button className="btn-modal-cancel" onClick={() => setIsEnvModalOpen(false)}>
                  Cancel
                </button>
                <button className="btn-modal-save" onClick={handleSaveEnv}>
                  Save .env
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

export default App;
