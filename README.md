# ⚡ AntyShare — Ultra-Fast Heavy File Transfer Engine

> **100% Zero-Storage • Peer-to-Peer & Offline Hotspot File Transfer**  
> Stream 1 GB to 50 GB heavy files directly memory-to-memory at 60–90 MB/s.

---

## 🚀 Key Features

* **Mode 1: Quick Wi-Fi Radar (Same-Router Isolation & Masked IP)**
  * Automatic local peer discovery on same Wi-Fi router.
  * Public IP masking (`103.112.***.***` / `Local Wi-Fi Network`) for anonymity.
  * Real-time automated executable/malware scanner alert before transfer acceptance.

* **Mode 2: 100% Offline Hotspot (0 MB Internet Data)**
  * Connect Phone Hotspot directly to Laptop Wi-Fi (Mobile Data can stay OFF).
  * Direct memory-to-memory streaming at physical Wi-Fi limits (60–90 MB/s).
  * Progressive Web App (PWA) caches all client assets for 100% offline launch.

* **Mode 3: Global P2P Tunnel (1-to-1 Room Lock & DTLS Encryption)**
  * Connect anywhere in the world using 6-digit room codes or direct links.
  * Strict 2-peer room lock: third-party intruders are automatically rejected with `ROOM_FULL`.
  * Anti-brute-force rate limiting protects rooms against automated guessing.
  * WebRTC DataChannel secured with DTLS-SRTP encryption (AES-128/256-GCM).

* **Strict Zero-Storage Architecture:**
  * Files NEVER touch server or host disk storage.
  * Memory-to-memory piping straight into recipient's Downloads folder.
  * 100% Tracker-Free, Ad-Free, and Account-Free.

---

## 📁 Repository Structure

```text
antyshare/
├── BUILD_INSTRUCTIONS.md   # Complete guide to modify, rebuild & deploy
├── server.js               # Node.js Signaling, WebSocket relay & Static server
├── package.json            # Node dependencies (ws, qrcode)
├── package-lock.json       # Lockfile
├── start.bat               # Quick launcher for local development
├── deploy.js               # Production deployment script (Contabo VPS)
├── android/                # Native Android Studio Project (Java, Gradle)
│   ├── app/src/main/       # Java source code, layouts, and AndroidManifest
│   └── build.gradle        # Gradle project configuration
├── resources/              # Project test tools and visual documentation
│   ├── screenshots/        # Verified UI and workflow test captures
│   └── tools/              # WebSocket & connectivity test scripts
└── public/                 # Client PWA & Frontend Assets
    ├── antyshare.apk       # Shipped Android application ready to install
    ├── index.html          # Main application UI & mode arenas
    ├── style.css           # CSS design system (Dark & Light theme, glassmorphism)
    ├── app.js              # Complete frontend logic, WebRTC engine & telemetry
    ├── sw.js               # Service Worker for 100% offline caching
    ├── manifest.json       # PWA manifest
    ├── icon-512.svg        # App icon
    ├── privacy.html        # Privacy Policy (Zero-storage declaration)
    ├── terms.html          # Terms of Service
    ├── about.html          # Platform Architecture & Tech Stack
    ├── contact.html        # Support, Abuse desk & Technical FAQs
    └── disclaimer.html     # Safety notice & non-sensitive media disclaimer
```

---

## 🛠️ Local Setup & Running

### Requirements:
* Node.js v18+ installed

### Steps:
```bash
# 1. Install dependencies
npm install

# 2. Start the local server
npm start
# or: node server.js
```

The application will run at:
👉 `http://localhost:8000`

---

## 🔒 Security & Privacy Guarantees

1. **No Cloud Storage:** No user file is ever saved on remote servers. All upload endpoints are permanently disabled (`410 Gone`).
2. **Encrypted WebRTC Pipes:** Browser-to-browser transfers use military-grade DTLS encryption.
3. **Malware Defense:** Executable scripts (`.exe`, `.bat`, `.cmd`, `.msi`, `.apk`) trigger bright security warning prompts for the recipient before acceptance.
4. **Camera Sensor Release:** Hardware video stream powers off immediately upon QR code acquisition.

---

## 📄 License

This project is open-source and available under the [MIT License](LICENSE).

© 2026 AntyShare.in — Zero-Storage Peer-to-Peer Transfer Engine.
