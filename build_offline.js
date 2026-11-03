const fs = require('fs');
const path = require('path');

const publicDir = path.join(__dirname, 'public');
let html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(publicDir, 'style.css'), 'utf8');
const qrJs = fs.readFileSync(path.join(publicDir, 'qrcode.min.js'), 'utf8');
const jsqrPath = path.join(publicDir, 'jsQR.js');
const jsqrJs = fs.existsSync(jsqrPath) ? fs.readFileSync(jsqrPath, 'utf8') : '';
const appJs = fs.readFileSync(path.join(publicDir, 'app.js'), 'utf8');

// 1. Update Title & Brand Tag for Standalone Offline Edition
html = html.replace(
  /<title>.*?<\/title>/,
  '<title>AntyShare — Offline Hotspot File Engine (100% Air-Gapped)</title>'
);

html = html.replace(
  /<span class="brand-tag">.*?<\/span>/,
  '<span class="brand-tag">Offline Hotspot</span>'
);

// 2. Replace Mode Switcher in Navbar with a Clean Status Pill
const offlineNavbarCenter = `
      <div class="offline-edition-badge-wrap">
        <span class="offline-edition-pill">📴 Offline Hotspot Mode (0 MB Data)</span>
      </div>`;

html = html.replace(/<nav class="mode-switcher" id="mode-switcher" role="tablist">[\s\S]*?<\/nav>/, offlineNavbarCenter);

// Add Online link to nav-actions
const navActionsReplacement = `
        <a href="https://antyshare.in" target="_blank" class="offline-online-link" title="Visit antyshare.in for Wi-Fi Radar & Global Internet Transfer">
          <span>🌐 Online Modes ↗</span>
        </a>
        <button class="btn-theme-toggle" id="btn-theme-toggle"`;

html = html.replace(/<button class="btn-theme-toggle" id="btn-theme-toggle"/, navActionsReplacement);

// 3. Remove Clutter Banners:
// - Remove Security Advisory Banner from offline standalone file
html = html.replace(/<aside class="security-advisory-banner"[\s\S]*?<\/aside>/, '');

// - Remove Online-Only Modes: Mode 1 (Quick Wi-Fi Radar) and Mode 3 (Global P2P)
html = html.replace(/<section class="mode-section active" id="mode-wifi">[\s\S]*?<\/section>/, '');
html = html.replace(/<section class="mode-section" id="mode-global">[\s\S]*?<\/section>/, '');

// - Remove redundant hero badge from Mode 2
html = html.replace(/<div class="mode-hero-badge">[\s\S]*?<\/div>/, '');

// - In offline standalone file, replace download card with a proud status banner
const standaloneNotice = `
      <div class="offline-edition-notice-banner" style="background: rgba(16, 185, 129, 0.12); border: 1px solid rgba(16, 185, 129, 0.35); border-radius: 12px; padding: 14px 20px; margin-bottom: 20px; display: flex; align-items: center; gap: 14px;">
        <span class="notice-icon" style="font-size: 26px;">📴</span>
        <div>
          <b style="color: #10b981; font-size: 14px;">100% Offline Standalone App Running (0 MB Internet Needed)</b>
          <p style="margin: 4px 0 0 0; font-size: 12.5px; color: var(--text-muted, #94a3b8);">You are running the saved offline edition. No internet or server connection is required. Transfer files device-to-device freely!</p>
        </div>
      </div>`;

html = html.replace(/<!-- Dedicated (Standalone Offline Suite|AntyShare Mobile APK Hub)[\s\S]*?class="(apk-hero-card|hero-download-card)[\s\S]*?<\/div>\s*<\/div>/, standaloneNotice);

// 4. Ensure Mode 2 (Offline Hotspot) is the Sole Active Section directly at the top
html = html.replace(
  /<section class="mode-section" id="mode-offline">/,
  '<section class="mode-section active" id="mode-offline" style="display: block;">'
);

// 5. Clean Mobile Bottom Navigation for Standalone Offline Edition
const offlineMobileNav = `
  <nav class="mobile-bottom-nav" id="mobile-bottom-nav" aria-label="Mobile navigation">
    <button type="button" class="mobile-nav-item active" data-mode="mode-offline" id="mob-nav-offline">
      <span class="mobile-nav-icon">📴</span>
      <span>Hotspot</span>
    </button>
    <a href="https://antyshare.in" target="_blank" class="mobile-nav-item" id="mob-nav-visit" style="text-decoration: none;">
      <span class="mobile-nav-icon">🌐</span>
      <span>antyshare.in</span>
    </a>
    <button type="button" class="mobile-nav-item" id="mob-nav-legal" aria-label="Open Legal and Trust Center">
      <span class="mobile-nav-icon">🛡️</span>
      <span>Legal</span>
    </button>
  </nav>`;

html = html.replace(/<nav class="mobile-bottom-nav" id="mobile-bottom-nav"[\s\S]*?<\/nav>/, offlineMobileNav);

// 6. Inline CSS
html = html.replace(/<link rel="stylesheet" href="\/style\.css[^"]*">/, `<style>\n${css}\n</style>`);

// 7. Inline Scripts with Standalone Offline Flag & jsQR
html = html.replace(
  /<script[^>]*src="[^"]*qrcode\.min\.js[^"]*"[^>]*><\/script>\s*(<script[^>]*src="[^"]*jsQR\.js[^"]*"[^>]*><\/script>\s*)?<script[^>]*src="[^"]*app\.js[^"]*"[^>]*><\/script>/i,
  `<script>\nwindow.IS_OFFLINE_STANDALONE = true;\n${qrJs}\n${jsqrJs}\n</script>\n<script>\n${appJs}\n</script>`
);

const outPath = path.join(publicDir, 'AntyShare-Offline.html');
fs.writeFileSync(outPath, html, 'utf8');
console.log('✅ AntyShare-Offline.html (Ultra-Clean Hotspot UI) generated! Size:', (html.length / 1024).toFixed(1), 'KB');
