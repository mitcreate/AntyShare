# 🛠️ AntyShare — Complete Build & Modification Guide

This guide contains everything required to modify, build, and re-create AntyShare from scratch.

---

## 📁 1. Project Architecture Overview

AntyShare consists of two unified components:
1. **PWA / Web Application (`/public` & `server.js`):**
   - Zero-storage memory-to-memory P2P file transfer engine using WebRTC DataChannel & WebSocket signaling.
   - Works on any modern browser (Chrome, Edge, Firefox, Safari) across PC, Mac, Linux, and Mobile.
   - Includes standalone offline PWA mode (`AntyShare-Offline.html`).

2. **Android Native Application (`/android`):**
   - Native Android app written in Java with AndroidX.
   - **Mode A (Connect to PC/Laptop):** Spawns an internal ultra-fast HTTP server on the phone (`EmbeddedHttpServer.java`) on port 8080. Laptop connects directly via Wi-Fi/Hotspot browser (`http://<phone-ip>:8080`) to send and receive files directly into phone storage (`Downloads/AntyShare`).
   - **Mode B (Phone to Phone):** Direct peer-to-peer Wi-Fi hotspot socket transfer engine (`P2pSocketServer.java`, `SenderActivity.java`, `ReceiverActivity.java`).
   - Permanent Zero-Deletion Protection: Files received are permanently written to `Downloads/AntyShare` and never deleted automatically.

---

## 💻 2. Web Application Setup & Run

### Prerequisites:
- Node.js (v18 or higher recommended)
- npm

### Run Locally:
```bash
# 1. Install dependencies
npm install

# 2. Launch server (Port 8000)
npm start
# or double-click: start.bat
```
Open `http://localhost:8000` in any web browser.

---

## 📱 3. Android App Build & Modification

### Prerequisites:
- JDK 17 (or JDK bundled with Android Studio)
- Android SDK (API 34 / Android 14 recommended)

### Build Commands (Terminal):
```bash
cd android

# Build Debug APK
./gradlew assembleDebug

# Output APK path:
# android/app/build/outputs/apk/debug/app-debug.apk
```

### Build via Android Studio:
1. Open Android Studio.
2. Click **File > Open** and select the `antyshare/android` folder.
3. Wait for Gradle sync to complete.
4. Click **Build > Build Bundle(s) / APK(s) > Build APK(s)**.

### Install APK to Connected Phone (ADB):
```bash
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

### Syncing APK with Web Portal:
Whenever a new APK is built, copy it to the `public/` directory so web visitors can download it:
```bash
cp android/app/build/outputs/apk/debug/app-debug.apk public/antyshare.apk
```

---

## 🚀 4. Production Deployment (Contabo VPS)

AntyShare uses a secure deployment script (`deploy.js`) that connects to Contabo VPS and restarts the PM2 process:
```bash
node deploy.js
```
*Note: Credentials are kept in external user vault (`~/.vps_vault/vps.env`) according to Zero-Credential Project Policy.*

---

## 🗂️ 5. Key Source Files Reference

| File | Purpose |
|------|---------|
| `server.js` | Web backend & WebSocket signaling server |
| `public/index.html` | Web frontend landing page & P2P interface |
| `public/app.js` | WebRTC DataChannel streaming engine & UI logic |
| `public/style.css` | Complete glassmorphism design system & animations |
| `public/antyshare.apk` | Shipped Android APK for instant download |
| `android/app/src/main/java/.../PcConnectActivity.java` | PC to Mobile connection screen & received file viewer |
| `android/app/src/main/java/.../EmbeddedHttpServer.java` | High-speed embedded HTTP server on phone (Port 8080) |
| `android/app/src/main/java/.../MainActivity.java` | App entry dashboard & mode selection |
| `android/app/src/main/java/.../SenderActivity.java` | Phone-to-phone sender flow |
| `android/app/src/main/java/.../ReceiverActivity.java` | Phone-to-phone receiver flow |
| `resources/` | Project screenshots and diagnostic tools |
