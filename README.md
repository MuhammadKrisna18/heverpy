# ⚡ HeverPy

**HeverPy** adalah aplikasi desktop *Process Manager & Dev-Tool* modern yang dirancang khusus untuk mengelola, menjalankan, dan mengorkestrasi ekosistem **Python (FastAPI)** bersama berbagai **Frontend Framework modern (React, Next.js, Vue, Svelte)** dalam satu antarmuka studio yang intuitif dan ringan.

Dibangun dengan fondasi **Tauri v2 + Rust + React 19 + TypeScript + Vite**.

---

## ✨ Fitur Utama

### 1. 🚀 One-Click Multi-Process Orchestration
- Menjalankan server backend **FastAPI (Uvicorn)** dan frontend dev server secara bersamaan hanya dengan 1 tombol.
- Konfigurasi port backend kustom (default: `8000`).
- **Clean Process Lifecycle**: Pembersihan proses anak (*process tree termination*) otomatis saat server dihentikan atau jendela aplikasi ditutup, mencegah port terkunci (*zombie processes*).

### 2. 📦 Dukungan Modern Package Manager
- **Python Manager**: Pilihan antara **`pip`** (standar) atau **`uv`** (ultra cepat).
- **Node Manager**: Pilihan antara **`npm`**, **`pnpm`**, **`yarn`**, atau **`bun`**.
- **Auto-Detection & Lock Guard**: Mendeteksi lockfile otomatis (`pnpm-lock.yaml`, `bun.lockb`, `yarn.lock`, `package-lock.json`). Tombol instalasi otomatis terkunci (*disabled*) jika dependensi atau framework sudah terpasang agar tidak menimpa proyek yang ada.

### 3. ⚙️ Environment Variables Manager (`.env`)
- **Key-Value Table Mode**: Menambah, mengedit, dan menghapus variabel lingkungan dengan fitur sensor nilai rahasia (API key, database password, SECRET_KEY) via toggle mata 👁/🙈.
- **Raw Text Editor Mode**: Mode editor teks langsung untuk menyalin atau mengedit konfigurasi `.env` secara manual.
- **⚡ 1-Click FastAPI Template**: Membuat file `.env` standar FastAPI (`PORT`, `HOST`, `DEBUG`, `SECRET_KEY`, `CORS_ORIGINS`, `DATABASE_URL`).

### 4. 🖥️ Studio Log Terminal Interaktif
- **Tab Kategori**: Filter log per sumber secara instan: **All**, **🐍 Backend**, **🌐 Frontend**, **⚙️ System/Pip**, dan **🔴 Errors**.
- **Instant Search**: Pencarian baris log secara *real-time*.
- **Auto-Scroll Toggle**: Opsi menyalakan/mematikan scroll otomatis agar leluasa memeriksa log di bagian atas.
- **Copy & Export**: Salin log ke clipboard dalam 1 klik atau unduh sebagai file `.txt` (`heverpy-logs-<timestamp>.txt`).
- **Visual Log Tagging**: Badge warna untuk setiap tipe pesan (`[BACKEND]`, `[FRONTEND]`, `[SYSTEM]`, `[ERROR]`).

### 5. 🛠️ Otomatisasi Setup & Scaffolding
- Pembuatan Virtual Environment (`venv`) otomatis.
- Generator boilerplate `main.py` dengan middleware **CORS** siap pakai.
- Scaffolding frontend langsung ke folder `frontend/` untuk **React (Vite + TS)**, **Next.js (App Router + Tailwind)**, **Vue 3**, atau **Svelte**.
- Tautan cepat membuka **OpenAPI Swagger UI (`/docs`)** dan **Frontend Web UI**.

### 6. 🎨 Desain UI/UX Studio 2-Kolom
- **Skema Warna Solid**: Desain *flat* bersih dengan palet **Putih**, **Biru Solid**, dan **Kuning Solid** tanpa gradien untuk keterbacaan tinggi.
- **Layout 2-Kolom**: Sidebar kiri untuk kontrol proyek & konfigurasi, serta area kanan untuk terminal log ukuran penuh (*full-height*).
- **Project Persistence**: Proyek terakhir otomatis tersimpan di `localStorage` dan dimuat kembali saat aplikasi dibuka.

---

## 🛠️ Tech Stack

- **Desktop Core**: [Tauri v2](https://v2.tauri.app/) & [Rust](https://www.rust-lang.org/)
- **Frontend UI**: [React 19](https://react.dev/), [TypeScript](https://www.typescriptlang.org/), [Vite](https://vitejs.dev/)
- **Target Backend**: [Python](https://www.python.org/) & [FastAPI](https://fastapi.tiangolo.com/) (Uvicorn)
- **Target Frontend**: React, Next.js, Vue, Svelte

---

## 🚀 Memulai (Getting Started)

### Prasyarat (Prerequisites)
Pastikan alat-alat berikut sudah terpasang di komputer Anda:
1. **Node.js** (v18 atau lebih baru) & **npm / pnpm / yarn / bun**
2. **Rust & Cargo** (instal melalui [rustup.rs](https://rustup.rs/))
3. **Python** (v3.10 atau lebih baru) ditambahkan ke sistem PATH
4. *(Opsional)* **uv** (`pip install uv` atau `cargo install uv`) untuk dependensi berkecepatan tinggi

---

### Instalasi & Menjalankan Mode Development

1. **Clone repository:**
   ```bash
   git clone https://github.com/username/HeverPy.git
   cd HeverPy
   ```

2. **Install dependensi frontend:**
   ```bash
   npm install
   ```

3. **Jalankan dalam mode development (Tauri):**
   ```bash
   npm run tauri dev
   ```

---

### Membangun File Installer / Produksi (Build)

Untuk mengompilasi aplikasi menjadi executable (`.exe` di Windows, `.app`/`.dmg` di macOS, atau `.deb`/AppImage di Linux):

```bash
npm run tauri build
```
File executable hasil kompilasi akan berada di folder `src-tauri/target/release/bundle/`.

---

## 📂 Struktur Direktori

```text
HeverPy/
├── public/                 # Aset statis frontend
├── src/                    # UI Frontend (React + TypeScript)
│   ├── App.tsx             # Komponen utama & interaksi Tauri API
│   ├── App.css             # Styling tema 2-kolom (Putih, Biru, Kuning)
│   └── main.tsx            # Entry point React
├── src-tauri/              # Backend Desktop (Rust + Tauri v2)
│   ├── src/
│   │   ├── env_manager.rs  # Logika baca/tulis/generate file .env
│   │   ├── project.rs      # Deteksi status proyek, venv, framework & package manager
│   │   ├── server.rs       # Manajemen proses Uvicorn & Node dev server
│   │   ├── setup.rs        # Eksekusi venv, pip/uv, dan frontend scaffolding
│   │   ├── lib.rs          # Registrasi Tauri handler & lifecycle cleanup
│   │   └── main.rs         # Entry point aplikasi Rust
│   ├── Cargo.toml          # Dependensi Rust
│   └── tauri.conf.json     # Konfigurasi jendela & permissions Tauri
├── package.json
└── README.md
```

---

## 📄 Lisensi

Proyek ini dilisensikan di bawah lisensi **MIT**. Bebas digunakan dan dikembangkan lebih lanjut.
