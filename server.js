const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { WebSocketServer } = require('ws');
const QRCode = require('qrcode');

const PORT = parseInt(process.env.PORT || '8000', 10);
const HOST = '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');

// Ensure public directory exists
if (!fs.existsSync(PUBLIC_DIR)) {
  fs.mkdirSync(PUBLIC_DIR, { recursive: true });
}

// Automatically compile self-contained AntyShare-Offline.html on server start (Dedicated Offline Hotspot Edition)
function ensureOfflineBundle() {
  const offlinePath = path.join(PUBLIC_DIR, 'AntyShare-Offline.html');
  const htmlPath = path.join(PUBLIC_DIR, 'index.html');
  const cssPath = path.join(PUBLIC_DIR, 'style.css');
  const jsPath = path.join(PUBLIC_DIR, 'app.js');
  const qrJsPath = path.join(PUBLIC_DIR, 'qrcode.min.js');
  const jsqrJsPath = path.join(PUBLIC_DIR, 'jsQR.js');
  try {
    if (fs.existsSync(htmlPath) && fs.existsSync(cssPath) && fs.existsSync(jsPath)) {
      let html = fs.readFileSync(htmlPath, 'utf8');
      const css = fs.readFileSync(cssPath, 'utf8');
      const js = fs.readFileSync(jsPath, 'utf8');
      const qrJs = fs.existsSync(qrJsPath) ? fs.readFileSync(qrJsPath, 'utf8') : '';
      const jsqrJs = fs.existsSync(jsqrJsPath) ? fs.readFileSync(jsqrJsPath, 'utf8') : '';

      // 1. Title & Brand Tag
      html = html.replace(/<title>.*?<\/title>/, '<title>AntyShare — Offline Hotspot File Engine (100% Air-Gapped)</title>');
      html = html.replace(/<span class="brand-tag">.*?<\/span>/, '<span class="brand-tag">Offline Hotspot</span>');

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

      // - Remove redundant "Install Offline App" button bar
      html = html.replace(/<!-- Dedicated Offline Tools Suite[\s\S]*?<\/div>\s*<\/div>/, '');

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
      html = html.replace(/<link rel="stylesheet"[^>]*href="[^"]*style\.css[^"]*"[^>]*>/i, `<style>\n${css}\n</style>`);

      // 7. Inline QR library, jsQR, and app.js with IS_OFFLINE_STANDALONE flag
      const fullJsTag = `<script>\nwindow.IS_OFFLINE_STANDALONE = true;\n${qrJs}\n${jsqrJs}\n</script>\n<script>\n${js}\n</script>`;
      html = html.replace(/<script[^>]*src="[^"]*qrcode\.min\.js[^"]*"[^>]*><\/script>\s*(<script[^>]*src="[^"]*jsQR\.js[^"]*"[^>]*><\/script>\s*)?<script[^>]*src="[^"]*app\.js[^"]*"[^>]*><\/script>/i, fullJsTag);

      fs.writeFileSync(offlinePath, html, 'utf8');
      console.log('⚡ Standalone AntyShare-Offline.html (Ultra-Clean Hotspot UI) auto-bundled and ready.');
    }
  } catch (err) {
    console.warn('Could not auto-bundle AntyShare-Offline.html:', err.message);
  }
}
ensureOfflineBundle();

// Helper: Get local network IP addresses
function getLocalIPAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      // Filter for IPv4 and non-internal addresses
      if (iface.family === 'IPv4' && !iface.internal) {
        addresses.push({ interface: name, address: iface.address });
      }
    }
  }
  return addresses;
}

function getPrimaryLocalIP() {
  const ips = getLocalIPAddresses();
  // Prefer hotspot/wi-fi IPs (typically 192.168.x.x)
  const wifi = ips.find(i => i.address.startsWith('192.168.') || i.address.startsWith('10.') || i.address.startsWith('172.'));
  return wifi ? wifi.address : (ips[0] ? ips[0].address : '127.0.0.1');
}

// MIME Types Map
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.zip': 'application/zip',
  '.apk': 'application/vnd.android.package-archive',
  '.bat': 'application/x-bat',
  '.exe': 'application/octet-stream'
};

// HTTP Server
const server = http.createServer((req, res) => {
  const reqHost = req.headers['x-forwarded-host'] || req.headers.host || '';
  const urlObj = new URL(req.url, `http://${reqHost || 'localhost'}`);
  const pathname = decodeURIComponent(urlObj.pathname);

  // CORS & Security Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');
  if (reqHost.includes('antyshare.in')) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  // Automatic redirect: If accessed via configured VPS IP, redirect seamlessly to official secure HTTPS domain
  const vpsHostIp = process.env.VPS_IP;
  if (vpsHostIp && reqHost.includes(vpsHostIp) && !pathname.startsWith('/api/')) {
    res.writeHead(302, { 'Location': `https://antyshare.in${req.url}` });
    return res.end();
  }

  // Determine public base origin
  const isCloudVPS = reqHost.includes('antyshare.in') || (vpsHostIp && reqHost.includes(vpsHostIp));
  const publicBase = isCloudVPS ? 'https://antyshare.in' : `http://${getPrimaryLocalIP()}:${PORT}`;

  // 1. API: Server Info & Local IPs
  if (pathname === '/api/info' && req.method === 'GET') {
    const primaryIp = getPrimaryLocalIP();
    const allIps = getLocalIPAddresses();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      appName: 'AntyShare',
      version: '1.2.0',
      port: PORT,
      primaryIp,
      allIps,
      connectUrl: publicBase,
      modes: ['offline-hotspot', 'global-p2p', 'quick-wifi']
    }));
  }

  // 2. API: Dynamic QR Code Data URL
  if (pathname === '/api/qr' && req.method === 'GET') {
    const customUrl = urlObj.searchParams.get('url');
    const targetUrl = customUrl || publicBase;
    QRCode.toDataURL(targetUrl, {
      margin: 2,
      width: 320,
      color: { dark: '#00f0ff', light: '#0a0d14' }
    }, (err, dataUrl) => {
      if (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: err.message }));
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ url: targetUrl, qrCode: dataUrl }));
    });
    return;
  }

  // 3. ZERO-STORAGE SECURITY POLICY: Disk uploads & file storage are permanently disabled
  if (pathname.startsWith('/api/files') || pathname.startsWith('/api/upload') || pathname.startsWith('/api/download')) {
    res.writeHead(410, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      error: 'Zero-Storage Enforced: Server disk storage is permanently disabled on AntyShare. All file transfers stream directly peer-to-peer.'
    }));
  }

  // 3B. Legacy executable/bat scripts permanently disabled
  if (pathname.endsWith('.bat') || pathname.endsWith('.cmd')) {
    res.writeHead(410, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      error: 'Legacy script removed: Please use the AntyShare Progressive Web App (PWA) directly from your browser.'
    }));
  }

  // 4. Static File Server (from public/ with canonical path traversal defense)
  let staticPath = pathname === '/' ? '/index.html' : pathname;
  let safeStatic = path.resolve(PUBLIC_DIR, '.' + path.normalize(staticPath));
  if (!safeStatic.startsWith(path.resolve(PUBLIC_DIR))) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    return res.end('403 Forbidden');
  }

  // Clean URL support: e.g. /privacy -> /privacy.html
  if (!fs.existsSync(safeStatic) && fs.existsSync(safeStatic + '.html')) {
    safeStatic = safeStatic + '.html';
  }

  if (fs.existsSync(safeStatic) && fs.statSync(safeStatic).isFile()) {
    const ext = path.extname(safeStatic).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const isCodeOrMarkup = ['.html', '.js', '.css', '.json'].includes(ext);
    const headers = { 'Content-Type': contentType };
    if (isCodeOrMarkup) {
      headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
      headers['Pragma'] = 'no-cache';
      headers['Expires'] = '0';
    } else if (ext === '.apk') {
      headers['Content-Disposition'] = 'attachment; filename="AntyShare.apk"';
      headers['Cache-Control'] = 'public, max-age=3600';
    }
    res.writeHead(200, headers);
    return fs.createReadStream(safeStatic).pipe(res);
  }

  // Fallback to index.html for client routing
  const fallback = path.join(PUBLIC_DIR, 'index.html');
  if (fs.existsSync(fallback)) {
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, must-revalidate'
    });
    return fs.createReadStream(fallback).pipe(res);
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('404 Not Found');
});

// Helper: Format Bytes to human readable
function formatBytes(bytes, decimals = 1) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// Helper: Get real client IP (behind reverse proxy or direct)
function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket.remoteAddress || '127.0.0.1';
}

// WebSocket Server for Real-Time P2P Signaling, Local Wi-Fi Radar & Progress Telemetry
const wss = new WebSocketServer({
  server,
  maxPayload: 64 * 1024 // 64 KB limit to prevent WebSocket DoS memory flooding
});
const rooms = new Map(); // roomCode -> Set of ws clients

// Security check: Verify if two WebSocket clients are allowed to communicate
// 1. Explicitly paired via QR Code announcement or transfer request
// 2. Exact same 6-digit P2P room code (Mode 3 Global P2P Tunnel)
// 3. Same Wi-Fi or Hotspot public IP (Mode 1 Quick Radar & Mode 2 Hotspot)
function arePeersAllowedToCommunicate(wsA, wsB) {
  if (!wsA || !wsB || wsB.readyState !== 1) return false;
  if (wsA.pairedPeerId && wsA.pairedPeerId === wsB.id) return true;
  if (wsB.pairedPeerId && wsB.pairedPeerId === wsA.id) return true;
  if (wsA.pairedDeviceId && wsB.deviceId && wsA.pairedDeviceId === wsB.deviceId) return true;
  if (wsB.pairedDeviceId && wsA.deviceId && wsB.pairedDeviceId === wsA.deviceId) return true;
  if (wsA.roomCode && wsB.roomCode && wsA.roomCode === wsB.roomCode) return true;
  if (wsA.clientIp && wsB.clientIp && wsA.clientIp === wsB.clientIp) return true;
  return false;
}

wss.on('connection', (ws, req) => {
  ws.id = 'client_' + Math.random().toString(36).substr(2, 9);
  ws.clientIp = getClientIp(req);
  ws.roomCode = null;
  ws.deviceInfo = null;
  ws.pairedPeerId = null;
  ws.pairedDeviceId = null;

  // Immediately synchronize client with its assigned unique peerId and verified IP
  ws.send(JSON.stringify({
    type: 'SERVER_INIT',
    peerId: ws.id,
    clientIp: ws.clientIp
  }));

  ws.on('message', message => {
    try {
      const data = JSON.parse(message);

      // 1. Join or Create a P2P Room (Mode 3 Global P2P)
      if (data.type === 'JOIN_ROOM') {
        const code = String(data.roomCode || '').trim().toUpperCase();
        if (!code || code.length > 20) return;

        // Anti Brute-Force Rate Limiting (max 6 room join attempts per 30s per socket)
        const now = Date.now();
        if (!ws.roomAttemptWindow || now - ws.roomAttemptWindow > 30000) {
          ws.roomAttemptWindow = now;
          ws.roomAttempts = 0;
        }
        ws.roomAttempts = (ws.roomAttempts || 0) + 1;
        if (ws.roomAttempts > 6) {
          ws.send(JSON.stringify({
            type: 'ROOM_RATE_LIMITED',
            error: 'Too many room attempts. Please wait 30 seconds before trying again.'
          }));
          return;
        }

        // Strict 1-to-1 Capacity Cap: Max 2 peers per P2P room
        const existingRoom = rooms.get(code);
        if (existingRoom && existingRoom.size >= 2 && !existingRoom.has(ws)) {
          ws.send(JSON.stringify({
            type: 'ROOM_FULL',
            roomCode: code,
            error: 'This P2P Room is already full (1-to-1 only). Please verify your code or create a new room.'
          }));
          return;
        }

        if (ws.roomCode && rooms.has(ws.roomCode)) {
          rooms.get(ws.roomCode).delete(ws);
          if (rooms.get(ws.roomCode).size === 0) {
            rooms.delete(ws.roomCode);
          }
        }

        ws.roomCode = code;
        if (!rooms.has(code)) {
          rooms.set(code, new Set());
        }
        rooms.get(code).add(ws);

        ws.send(JSON.stringify({
          type: 'ROOM_JOINED',
          roomCode: code,
          peersCount: rooms.get(code).size
        }));

        // Notify both peers about each other so either peer can initiate transfer
        for (const peer of rooms.get(code)) {
          if (peer !== ws && peer.readyState === 1) {
            peer.send(JSON.stringify({
              type: 'PEER_CONNECTED',
              peerId: ws.id,
              peerName: ws.deviceInfo?.name || 'Remote Peer',
              peersCount: rooms.get(code).size
            }));
            ws.send(JSON.stringify({
              type: 'PEER_CONNECTED',
              peerId: peer.id,
              peerName: peer.deviceInfo?.name || 'Room Host',
              peersCount: rooms.get(code).size
            }));
          }
        }
      }

      // 2. WebRTC Signaling Relay (Offer, Answer, ICE Candidate)
      if (['SIGNAL_OFFER', 'SIGNAL_ANSWER', 'SIGNAL_ICE'].includes(data.type)) {
        if (!ws.roomCode || !rooms.has(ws.roomCode)) return;
        for (const peer of rooms.get(ws.roomCode)) {
          if (peer !== ws && peer.readyState === 1) {
            peer.send(JSON.stringify({
              type: data.type,
              payload: data.payload,
              from: ws.id
            }));
          }
        }
      }

      // 3. Mode 3: Local Radar Ping, Same-Network Isolation & Device Deduplication
      if (data.type === 'RADAR_PING') {
        const deviceId = String(data.deviceId || '').trim();
        const rawName = String(data.deviceInfo?.name || 'Device').trim().slice(0, 30);
        const normName = rawName.toLowerCase();
        const isMobile = Boolean(data.deviceInfo?.isMobile);

        ws.deviceId = deviceId;
        ws.deviceInfo = {
          name: rawName || (isMobile ? 'Mobile Phone' : 'Laptop / PC'),
          isMobile
        };

        // Broadcast radar peer list to clients on the exact same Wi-Fi public IP
        broadcastRadarPeers(ws.clientIp);
      }

      // Helper: Resolve target peer by socket ID or persistent device ID
      const findPeer = (targetId, targetDevId) => {
        return Array.from(wss.clients).find(c =>
          c !== ws && c.readyState === 1 && (
            (targetId && c.id === targetId) ||
            (targetDevId && c.deviceId && c.deviceId === targetDevId)
          )
        );
      };

      // 4. Targeted Transfer Request (Sender -> Server -> Receiver: Radar or Hotspot / P2P)
      if (data.type === 'RADAR_TRANSFER_REQUEST') {
        const target = findPeer(data.toPeerId, data.toDeviceId);
        if (target) {
          // Explicitly authorize pairing between these two clients for this transfer
          ws.pairedPeerId = target.id;
          ws.pairedDeviceId = target.deviceId;
          target.pairedPeerId = ws.id;
          target.pairedDeviceId = ws.deviceId;

          target.send(JSON.stringify({
            type: 'RADAR_TRANSFER_REQUEST',
            requestId: data.requestId,
            fromPeerId: ws.id,
            fromDeviceId: ws.deviceId,
            fromPeerName: ws.deviceInfo?.name || 'Nearby Device',
            fromIsMobile: ws.deviceInfo?.isMobile || false,
            fileName: data.fileName,
            fileSize: data.fileSize,
            fileFormatted: data.fileFormatted,
            fileCount: data.fileCount || 1
          }));
        } else {
          ws.send(JSON.stringify({
            type: 'RADAR_TRANSFER_ERROR',
            requestId: data.requestId,
            error: 'Target device is no longer reachable. Please make sure both devices are online.'
          }));
        }
      }

      // 5. Transfer Response (Receiver Accept/Decline -> Server -> Sender)
      if (data.type === 'RADAR_TRANSFER_RESPONSE') {
        const sender = findPeer(data.toPeerId, data.toDeviceId);
        if (sender) {
          // Explicitly authorize mutual pairing for QR-scanned / radar transfer
          ws.pairedPeerId = sender.id;
          ws.pairedDeviceId = sender.deviceId;
          sender.pairedPeerId = ws.id;
          sender.pairedDeviceId = ws.deviceId;

          sender.send(JSON.stringify({
            type: 'RADAR_TRANSFER_RESPONSE',
            requestId: data.requestId,
            fromPeerId: ws.id,
            fromDeviceId: ws.deviceId,
            fromPeerName: ws.deviceInfo?.name || 'Receiver',
            accepted: Boolean(data.accepted),
            reason: data.reason || ''
          }));
        }
      }

      // 6. Transfer Cancel (Sender cancelled before acceptance)
      if (data.type === 'RADAR_TRANSFER_CANCEL') {
        const target = findPeer(data.toPeerId, data.toDeviceId);
        if (target && arePeersAllowedToCommunicate(ws, target)) {
          target.send(JSON.stringify({
            type: 'RADAR_TRANSFER_CANCEL',
            requestId: data.requestId,
            fromPeerId: ws.id
          }));
        }
      }

      // 7. Live Progress Sync (Sender streams progress to Receiver)
      if (data.type === 'RADAR_TRANSFER_PROGRESS') {
        const target = findPeer(data.toPeerId, data.toDeviceId);
        if (target && arePeersAllowedToCommunicate(ws, target)) {
          target.send(JSON.stringify({
            type: 'RADAR_TRANSFER_PROGRESS',
            requestId: data.requestId,
            percent: data.percent,
            speed: data.speed,
            loaded: data.loaded,
            total: data.total
          }));
        }
      }

      // 8. Direct WebRTC P2P Signaling Relay (Zero Server Storage)
      if (data.type === 'RTC_SIGNAL') {
        const target = findPeer(data.toPeerId, data.toDeviceId);
        if (target && arePeersAllowedToCommunicate(ws, target)) {
          target.send(JSON.stringify({
            type: 'RTC_SIGNAL',
            fromPeerId: ws.id,
            fromDeviceId: ws.deviceId,
            signal: data.signal
          }));
        }
      }

      // 9. Direct QR Hotspot Pair Announcement
      if (data.type === 'PAIR_ANNOUNCE') {
        const target = findPeer(data.toPeerId, data.toDeviceId);
        if (target) {
          // Explicit mutual pairing authorized by QR scan
          ws.pairedPeerId = target.id;
          ws.pairedDeviceId = target.deviceId;
          target.pairedPeerId = ws.id;
          target.pairedDeviceId = ws.deviceId;

          // Forward to target
          target.send(JSON.stringify({
            type: 'PAIR_ANNOUNCE',
            fromPeerId: ws.id,
            fromDeviceId: ws.deviceId || data.fromDeviceId,
            fromPeerName: ws.deviceInfo?.name || data.fromPeerName || 'Paired Device',
            fromIsMobile: ws.deviceInfo?.isMobile ?? data.fromIsMobile
          }));

          // Send confirmation back to scanner
          ws.send(JSON.stringify({
            type: 'PAIR_ACKNOWLEDGED',
            targetPeerId: target.id,
            targetDeviceId: target.deviceId,
            targetPeerName: target.deviceInfo?.name || 'Paired Device'
          }));
        } else {
          ws.send(JSON.stringify({
            type: 'PAIR_ERROR',
            error: 'Target device not found or disconnected. Please refresh QR code on the other device.'
          }));
        }
      }

    } catch (e) {
      console.error('WS Message error:', e);
    }
  });

  ws.on('close', () => {
    const closedIp = ws.clientIp;
    if (ws.roomCode && rooms.has(ws.roomCode)) {
      rooms.get(ws.roomCode).delete(ws);
      if (rooms.get(ws.roomCode).size === 0) {
        rooms.delete(ws.roomCode);
      } else {
        for (const peer of rooms.get(ws.roomCode)) {
          if (peer.readyState === 1) {
            peer.send(JSON.stringify({ type: 'PEER_DISCONNECTED', peerId: ws.id }));
          }
        }
      }
    }
    // Update radar for clients on that specific IP
    if (closedIp) {
      broadcastRadarPeers(closedIp);
    }
  });
});

function broadcast(msg) {
  const json = JSON.stringify(msg);
  wss.clients.forEach(c => {
    if (c.readyState === 1) c.send(json);
  });
}

// Privacy Helper: Mask public IP address so raw IP is never exposed in UI or network packets
function maskPublicIp(ip) {
  if (!ip) return 'Local Wi-Fi Mesh';
  if (ip === '127.0.0.1' || ip.startsWith('192.168.') || ip.startsWith('10.') || ip.startsWith('172.')) {
    return 'Local Wi-Fi Hotspot';
  }
  const parts = ip.split('.');
  if (parts.length === 4) {
    return `${parts[0]}.${parts[1]}.***.***`;
  }
  if (ip.includes(':')) {
    const colons = ip.split(':');
    return `${colons[0]}:${colons[1]}::****`;
  }
  return 'Encrypted Wi-Fi Mesh';
}

// Broadcast radar peers ONLY to clients on the exact same public IP
function broadcastRadarPeers(filterIp = null) {
  const allClients = Array.from(wss.clients).filter(c => c.readyState === 1);
  const targetIps = filterIp ? [filterIp] : Array.from(new Set(allClients.map(c => c.clientIp)));

  for (const ip of targetIps) {
    if (!ip) continue;
    const ipClients = allClients.filter(c => c.clientIp === ip && c.deviceInfo);
    for (const client of ipClients) {
      const clientNormName = (client.deviceInfo?.name || '').trim().toLowerCase();
      // Deduplicate peers: only show unique physical devices (prevent duplicate tabs / re-scans)
      const uniquePeersMap = new Map();
      ipClients
        .filter(other => {
          // Ignore own connection
          if (other.id === client.id) return false;
          // Ignore self by deviceId
          if (client.deviceId && other.deviceId && other.deviceId === client.deviceId) return false;
          // Ignore self by normalized name and device type
          const otherNormName = (other.deviceInfo?.name || '').trim().toLowerCase();
          if (clientNormName && otherNormName && clientNormName === otherNormName && Boolean(client.deviceInfo?.isMobile) === Boolean(other.deviceInfo?.isMobile)) {
            return false;
          }
          return true;
        })
        .forEach(other => {
          const otherNormName = (other.deviceInfo?.name || '').trim().toLowerCase();
          // The definitive unique key for a peer on the same Wi-Fi is its Name + Device Type (or deviceId)
          const dedupeKey = otherNormName
            ? `${otherNormName}_${other.deviceInfo?.isMobile ? 'm' : 'd'}`
            : (other.deviceId || other.id);

          uniquePeersMap.set(dedupeKey, {
            id: other.id,
            deviceId: other.deviceId,
            ...other.deviceInfo
          });
        });

      const peers = Array.from(uniquePeersMap.values());

      client.send(JSON.stringify({
        type: 'RADAR_PEERS',
        peers,
        networkIp: maskPublicIp(ip)
      }));
    }
  }
}

// Start Server
server.listen(PORT, HOST, () => {
  const primaryIp = getPrimaryLocalIP();
  console.log(`\n======================================================`);
  console.log(`⚡ AntyShare Zero-Storage P2P Transfer Engine Running!`);
  console.log(`• Local Port:         ${PORT}`);
  console.log(`• Local Hotspot URL:  http://${primaryIp}:${PORT}`);
  console.log(`• Public Domain:      https://antyshare.in`);
  console.log(`• Architecture:       100% Zero-Disk End-to-End P2P`);
  console.log(`======================================================\n`);
});
