// AntyShare Client Application — Dynamic Multi-Mode File Transfer Engine

function getDefaultDeviceName() {
  const isMobile = /Android|iPhone|iPad/i.test(navigator.userAgent);
  if (/Android/i.test(navigator.userAgent)) return 'Android Phone';
  if (/iPhone|iPad/i.test(navigator.userAgent)) return 'iPhone / iPad';
  if (/Windows/i.test(navigator.userAgent)) return 'Windows PC';
  if (/Mac/i.test(navigator.userAgent)) return 'MacBook';
  return isMobile ? 'Mobile Phone' : 'Laptop / PC';
}

function getOrCreateDeviceId() {
  let id = null;
  try {
    id = localStorage.getItem('antyshare_device_id');
  } catch (e) {}

  if (!id) {
    const match = document.cookie.match(/(?:^|;\s*)antyshare_device_id=([^;]+)/);
    if (match) {
      try { id = decodeURIComponent(match[1]); } catch (e) {}
    }
  }

  if (!id) {
    id = 'dev_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 8);
  }

  try { localStorage.setItem('antyshare_device_id', id); } catch (e) {}
  try { document.cookie = `antyshare_device_id=${encodeURIComponent(id)}; path=/; max-age=31536000; SameSite=Lax`; } catch (e) {}

  return id;
}

const state = {
  activeMode: 'mode-wifi',
  localIp: null,
  connectUrl: null,
  ws: null,
  wsConnected: false,
  p2pRoomCode: null,
  p2pFileToSend: null,
  p2pFilesToSend: null,
  p2pTargetPeer: null,
  p2pTransferInProgress: false,
  p2pRole: null,
  peerConnection: null,
  dataChannel: null,
  uploadActive: false,
  myPeerId: null,
  // Mode 3: Radar & Targeted Beam (Persistent Unique Identity)
  deviceId: getOrCreateDeviceId(),
  deviceName: localStorage.getItem('antyshare_device_name') || getDefaultDeviceName(),
  isMobile: /Android|iPhone|iPad/i.test(navigator.userAgent),
  targetPeer: null,
  lastDiscoveredPeers: [],
  pendingOutgoingRequest: null,
  pendingIncomingRequest: null
};

// --- PWA Installation Lifecycle (Mode 2 Exclusive) ---
let deferredPrompt = null;
window._pwaPromptReady = false;

function initPWAInstallation() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    window._pwaPromptReady = true;

    // Passive prompt capture without showing intrusive floating banner
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    window._pwaPromptReady = false;
    const banner = document.getElementById('pwa-floating-banner');
    if (banner) banner.style.display = 'none';
    showToast('🎉 AntyShare App installed! You can now launch it 100% offline.');
  });

  // Dual Offline Protection: Download standalone AntyShare-Offline.html to device storage
  window.downloadOfflineAppFile = function() {
    try {
      const link = document.createElement('a');
      link.href = '/AntyShare-Offline.html';
      link.download = 'AntyShare-Offline.html';
      document.body.appendChild(link);
      link.click();
      requestAnimationFrame(() => link.remove());
      showToast('📥 AntyShare-Offline.html downloaded to Downloads folder! Even if shortcut is deleted, you can open this file anytime.');
    } catch (e) {
      console.warn('Offline file download error:', e);
    }
  };

  // Open Phone-to-PC Web Portal dynamically
  window.openPhonePortal = function() {
    const input = document.getElementById('phone-portal-ip');
    let val = input ? input.value.trim() : '';
    if (!val && input) {
      val = (input.getAttribute('placeholder') || '').replace(/^e\.g\.\s*/i, '').trim();
    }
    if (!val) {
      val = '192.168.43.1:8080';
    }
    val = val.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
    if (!val.includes(':')) {
      val = val + ':8080';
    }
    const targetUrl = 'http://' + val;
    window.open(targetUrl, '_blank', 'noopener,noreferrer');
  };

  const triggerInstall = async () => {
    // 1. Automatically save standalone offline file to device Downloads
    window.downloadOfflineAppFile();

    // 2. Also prompt browser PWA install (homescreen shortcut / laptop taskbar)
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        showToast('🎉 App shortcut created + 📥 Offline file saved to Downloads!');
      }
      deferredPrompt = null;
      window._pwaPromptReady = false;
      const banner = document.getElementById('pwa-floating-banner');
      if (banner) banner.style.display = 'none';
    } else {
      const isMobile = /Android|iPhone|iPad/i.test(navigator.userAgent);
      if (isMobile) {
        showToast('📥 Offline file saved! To add shortcut: tap browser menu (⋮) -> "Add to Home Screen"');
      } else {
        showToast('📥 Offline file saved! On Laptop: Click Install icon (🖥️ ⬇️) in address bar');
      }
    }
  };

  // Primary install trigger is located cleanly inside Mode 2's action bar
  const btnOfflineSectionPwa = document.getElementById('btn-offline-section-pwa');
  if (btnOfflineSectionPwa) btnOfflineSectionPwa.addEventListener('click', triggerInstall);

  const btnHeroDownload = document.getElementById('btn-hero-download-file');
  if (btnHeroDownload) btnHeroDownload.addEventListener('click', triggerInstall);

  const btnDownloadOfflineFile = document.getElementById('btn-download-offline-file');
  if (btnDownloadOfflineFile) btnDownloadOfflineFile.addEventListener('click', window.downloadOfflineAppFile);

  const footerBtnInstall = document.getElementById('footer-btn-install-app');
  if (footerBtnInstall) footerBtnInstall.addEventListener('click', triggerInstall);

  const btnBannerInstall = document.getElementById('btn-banner-install');
  if (btnBannerInstall) btnBannerInstall.addEventListener('click', triggerInstall);

  const btnBannerClose = document.getElementById('btn-banner-close');
  if (btnBannerClose) {
    btnBannerClose.addEventListener('click', () => {
      const banner = document.getElementById('pwa-floating-banner');
      if (banner) banner.style.display = 'none';
      sessionStorage.setItem('antyshare_pwa_dismissed', '1');
    });
  }
}

// Mode 2 Hotspot Live Pair Status Pill (Air-Gapped Optical WebRTC Handshake)
function updateOfflinePairStatus(peer) {
  const statusCard = document.getElementById('offline-pair-status-card');
  const statusText = document.getElementById('offline-pair-status-text');
  if (!statusText) return;

  // 1. If WebRTC DataChannel is actively open and streaming
  if (offlineRTC.dc && offlineRTC.dc.readyState === 'open') {
    statusText.innerHTML = `🟢 <b>Connected:</b> Direct Wi-Fi P2P Stream Active`;
    statusText.style.color = '#10b981';
    if (statusCard) statusCard.style.borderColor = 'rgba(16, 185, 129, 0.4)';
    return;
  }

  // 2. If Sender has generated Offer QR
  const senderQrBox = document.getElementById('mode2-sender-qr-box');
  if (offlineRTC.role === 'sender' && senderQrBox && senderQrBox.style.display !== 'none') {
    statusText.innerHTML = `📱 <b>Step 1 Active:</b> Scan Offer QR with Receiver phone`;
    statusText.style.color = '#00f0ff';
    if (statusCard) statusCard.style.borderColor = 'rgba(0, 240, 255, 0.4)';
    return;
  }

  // 3. If Receiver has generated Answer QR
  const receiverQrBox = document.getElementById('mode2-receiver-qr-box');
  if (offlineRTC.role === 'receiver' && receiverQrBox && receiverQrBox.style.display !== 'none') {
    statusText.innerHTML = `📱 <b>Step 2 Active:</b> Show this Answer QR to Sender laptop`;
    statusText.style.color = '#00f0ff';
    if (statusCard) statusCard.style.borderColor = 'rgba(0, 240, 255, 0.4)';
    return;
  }

  // 4. If paired via online server (Mode 1 / legacy)
  if (state.wsConnected && peer && (peer.id || peer.deviceId)) {
    statusText.innerHTML = `🟢 Live Pipe Active with <b>${escapeHtml(peer.name)}</b>`;
    statusText.style.color = '#10b981';
    if (statusCard) statusCard.style.borderColor = 'rgba(16, 185, 129, 0.4)';
    return;
  }

  // 5. Default pure offline hotspot state (NEVER show red error when offline!)
  statusText.innerHTML = `📶 <b>Air-Gapped Hotspot Mode:</b> Ready for Optical Handshake (0 Mobile Data)`;
  statusText.style.color = '#10b981';
  if (statusCard) statusCard.style.borderColor = 'rgba(16, 185, 129, 0.4)';
}

// --- DOM Content Loaded ---
document.addEventListener('DOMContentLoaded', () => {
  initThemeEngine();
  initSecurityBanner();
  initMobileNav();
  initHotspotSubswitcher();
  initModeSwitcher();
  initOfflineHotspotMode();
  initGlobalP2PMode();
  initQuickWifiMode();
  const isOfflineStandalone = !!window.IS_OFFLINE_STANDALONE || 
                              window.location.protocol === 'file:' || 
                              !window.location.host ||
                              (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
                              window.navigator.standalone === true ||
                              window.location.search.includes('source=pwa');

  if (isOfflineStandalone) {
    state.activeMode = 'mode-offline';

    // In PWA / Standalone, hide online-only sections (Radar & Global)
    const secWifi = document.getElementById('mode-wifi');
    if (secWifi) secWifi.style.display = 'none';
    const secGlobal = document.getElementById('mode-global');
    if (secGlobal) secGlobal.style.display = 'none';

    // Hide online tabs in desktop navbar
    const tabWifi = document.getElementById('tab-btn-wifi');
    if (tabWifi) tabWifi.style.display = 'none';
    const tabGlobal = document.getElementById('tab-btn-global');
    if (tabGlobal) tabGlobal.style.display = 'none';

    // In mobile bottom nav, hide Radar and Global, leaving only Hotspot and link to online site
    const mobWifi = document.getElementById('mob-nav-wifi');
    if (mobWifi) mobWifi.style.display = 'none';
    const mobGlobal = document.getElementById('mob-nav-global');
    if (mobGlobal) mobGlobal.style.display = 'none';
    const mobOffline = document.getElementById('mob-nav-offline');
    if (mobOffline) mobOffline.classList.add('active');

    // Add a clean link in mobile nav to online site if not present
    const mobNav = document.getElementById('mobile-bottom-nav');
    if (mobNav && !document.getElementById('mob-nav-visit')) {
      const visitLink = document.createElement('a');
      visitLink.id = 'mob-nav-visit';
      visitLink.className = 'mobile-nav-item';
      visitLink.href = 'https://antyshare.in';
      visitLink.target = '_blank';
      visitLink.style.textDecoration = 'none';
      visitLink.innerHTML = '<span class="mobile-nav-icon">🌐</span><span>antyshare.in</span>';
      const legalBtn = document.getElementById('mob-nav-legal');
      if (legalBtn) {
        mobNav.insertBefore(visitLink, legalBtn);
      } else {
        mobNav.appendChild(visitLink);
      }
    }

    // Hide install banner since app is already running as standalone/offline
    const banner = document.getElementById('pwa-floating-banner');
    if (banner) banner.style.display = 'none';

    initWebSocket();
    loadServerInfo();
    switchMode('mode-offline');
  } else {
    initWebSocket();
    loadServerInfo();
    loadMode3OfflineQR();
    initPWAInstallation();
    switchMode(state.activeMode);
  }

  // Register PWA Service Worker for offline instant loading
  if ('serviceWorker' in navigator && (window.location.protocol === 'http:' || window.location.protocol === 'https:')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').then(reg => {
        console.log('✅ ServiceWorker registered for offline usage:', reg.scope);
      }).catch(err => {
        console.warn('ServiceWorker registration error:', err);
      });
    });
  }

  // Check URL parameters for direct room joining (e.g. ?room=123456)
  const urlParams = new URLSearchParams(window.location.search);
  const roomParam = urlParams.get('room');
  if (roomParam) {
    switchMode('mode-global');
    const input = document.getElementById('input-p2p-code');
    if (input) input.value = roomParam;
    showToast(`P2P Room Code detected: ${roomParam}`);

    // Auto-join room when WebSocket is connected
    const tryAutoJoin = () => {
      if (state.wsConnected) {
        joinP2PRoom(roomParam);
      } else {
        setTimeout(tryAutoJoin, 300);
      }
    };
    tryAutoJoin();
  }

  // Check mode parameter (e.g. ?mode=offline)
  const modeParam = urlParams.get('mode');
  if (modeParam === 'offline') {
    switchMode('mode-offline');
  }

  // Check URL parameters for direct offline QR pairing (e.g. ?p=client_xxx&d=dev_yyy)
  const pairParam = urlParams.get('p') || urlParams.get('pair');
  const devParam = urlParams.get('d') || urlParams.get('dev');
  if (pairParam || devParam) {
    const targetName = decodeURIComponent(urlParams.get('n') || urlParams.get('name') || 'Laptop');
    state.targetPeer = { id: pairParam, deviceId: devParam, name: targetName };
    if (modeParam === 'offline' || urlParams.get('m') === 'offline') {
      switchMode('mode-offline');
    } else {
      switchMode('mode-wifi');
    }
    updateOfflinePairStatus(state.targetPeer);

    const fnParam = urlParams.get('f') || urlParams.get('fn');
    const fsParam = urlParams.get('s') || urlParams.get('fs');
    const fcParam = urlParams.get('c') || urlParams.get('fc');
    const sdpParam = urlParams.get('sdp');

    if (fnParam) {
      // Receiver side of incoming beam: Show Accept/Reject modal immediately!
      const fileName = decodeURIComponent(fnParam);
      const fileSize = parseInt(fsParam || '0', 10);
      const fileCount = parseInt(fcParam || '1', 10);

      state.pendingIncomingRequest = {
        requestId: 'req_' + Date.now(),
        fromPeerId: pairParam || '',
        fromDeviceId: devParam || '',
        fromPeerName: targetName,
        fileName,
        fileSize,
        fileFormatted: formatBytes(fileSize),
        fileCount,
        sdpPayload: sdpParam ? decodeURIComponent(sdpParam) : ''
      };

      const nameEl = document.getElementById('incoming-sender-name');
      const fileEl = document.getElementById('incoming-file-name');
      const sizeEl = document.getElementById('incoming-file-size');
      if (nameEl) nameEl.textContent = targetName;
      if (fileEl) fileEl.textContent = fileName;
      if (sizeEl) sizeEl.textContent = formatBytes(fileSize);

      const dangerousExts = ['.exe', '.bat', '.cmd', '.msi', '.vbs', '.scr', '.ps1', '.sh', '.com', '.jar', '.apk', '.bin'];
      const isDangerous = dangerousExts.some(ext => fileName.toLowerCase().endsWith(ext));
      const warnBox = document.getElementById('incoming-file-warning');
      if (warnBox) warnBox.style.display = isDangerous ? 'block' : 'none';

      playChime(true);
      showModal('modal-incoming-request');
      showToast(`📱 Incoming file transfer request from ${targetName}!`);
    } else {
      showToast(`✓ Paired with ${targetName}! Drop file to Beam Live.`);
    }

    // Clean up URL parameters so subsequent reloads don't duplicate
    window.history.replaceState({}, document.title, window.location.pathname);
  }
});

// ============================================================
// 1. THEME SWITCHER, SECURITY BANNER & MOBILE CONTROLLERS
// ============================================================
function initThemeEngine() {
  const btnToggle = document.getElementById('btn-theme-toggle');
  const savedTheme = localStorage.getItem('antyshare_theme') || 
    (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');

  if (savedTheme === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }

  function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'light' ? 'dark' : 'light';
    if (next === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
    try {
      localStorage.setItem('antyshare_theme', next);
    } catch (e) {}
    showToast(next === 'light' ? '☀️ Switched to Light Theme' : '🌙 Switched to Dark Theme');
  }

  if (btnToggle) btnToggle.addEventListener('click', toggleTheme);
}

function initSecurityBanner() {
  const banner = document.getElementById('security-advisory-banner');
  const btnDismiss = document.getElementById('btn-dismiss-security-banner');
  if (sessionStorage.getItem('antyshare_security_dismissed') === '1' && banner) {
    banner.style.display = 'none';
  }
  if (btnDismiss && banner) {
    btnDismiss.addEventListener('click', () => {
      banner.style.display = 'none';
      sessionStorage.setItem('antyshare_security_dismissed', '1');
    });
  }
}

function initMobileNav() {
  const mobItems = document.querySelectorAll('.mobile-bottom-nav .mobile-nav-item[data-mode]');
  mobItems.forEach(item => {
    item.addEventListener('click', () => {
      const mode = item.dataset.mode;
      if (mode) switchMode(mode);
    });
  });

  // In-App Legal & Policies Action Sheet Controller
  const btnLegal = document.getElementById('mob-nav-legal');
  const legalSheet = document.getElementById('modal-legal-sheet');
  const btnCloseLegal = document.getElementById('btn-close-legal-sheet');

  if (btnLegal && legalSheet) {
    btnLegal.addEventListener('click', (e) => {
      e.stopPropagation();
      const isActive = legalSheet.classList.toggle('active');
      legalSheet.setAttribute('aria-hidden', isActive ? 'false' : 'true');
    });

    if (btnCloseLegal) {
      btnCloseLegal.addEventListener('click', () => {
        legalSheet.classList.remove('active');
        legalSheet.setAttribute('aria-hidden', 'true');
      });
    }

    legalSheet.addEventListener('click', (e) => {
      if (e.target === legalSheet) {
        legalSheet.classList.remove('active');
        legalSheet.setAttribute('aria-hidden', 'true');
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && legalSheet.classList.contains('active')) {
        legalSheet.classList.remove('active');
        legalSheet.setAttribute('aria-hidden', 'true');
      }
    });
  }
}

function initHotspotSubswitcher() {
  const btnPair = document.getElementById('sub-btn-pair');
  const btnTransfer = document.getElementById('sub-btn-transfer');
  const grid = document.getElementById('offline-grid-two-cols');

  if (btnPair && btnTransfer && grid) {
    btnPair.addEventListener('click', () => {
      btnPair.classList.add('active');
      btnTransfer.classList.remove('active');
      grid.classList.add('show-pair');
      grid.classList.remove('show-transfer');
    });

    btnTransfer.addEventListener('click', () => {
      btnTransfer.classList.add('active');
      btnPair.classList.remove('active');
      grid.classList.add('show-transfer');
      grid.classList.remove('show-pair');
    });
  }
}

function initModeSwitcher() {
  const tabs = document.querySelectorAll('.mode-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const modeId = tab.dataset.mode;
      switchMode(modeId);
    });
  });

  const linkRadar = document.getElementById('link-goto-radar-mode');
  if (linkRadar) {
    linkRadar.addEventListener('click', (e) => {
      e.preventDefault();
      switchMode('mode-wifi');
    });
  }
}

function switchMode(targetModeId) {
  state.activeMode = targetModeId;

  // Reset scroll to top instantly so switching modes never lands user at bottom footer
  try {
    window.scrollTo({ top: 0, behavior: 'instant' });
  } catch (e) {
    window.scrollTo(0, 0);
  }

  // Close legal action sheet if open
  const legalSheet = document.getElementById('modal-legal-sheet');
  if (legalSheet) {
    legalSheet.classList.remove('active');
    legalSheet.setAttribute('aria-hidden', 'true');
  }

  // Update tabs
  document.querySelectorAll('.mode-tab').forEach(tab => {
    const isActive = tab.dataset.mode === targetModeId;
    tab.classList.toggle('active', isActive);
    tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });

  // Update mobile bottom navigation
  document.querySelectorAll('.mobile-bottom-nav .mobile-nav-item[data-mode]').forEach(mobItem => {
    mobItem.classList.toggle('active', mobItem.dataset.mode === targetModeId);
  });

  // Update mode sections
  document.querySelectorAll('.mode-section').forEach(sec => {
    sec.classList.toggle('active', sec.id === targetModeId);
  });

  // Floating PWA Banner removed in favor of native APK and clean UI
  const pwaBanner = document.getElementById('pwa-floating-banner');
  if (pwaBanner) pwaBanner.style.display = 'none';

  // Reset mobile hotspot subswitcher to Step 1: Pair initially
  const subBtnPair = document.getElementById('sub-btn-pair');
  const subBtnTransfer = document.getElementById('sub-btn-transfer');
  const grid = document.getElementById('offline-grid-two-cols');
  if (subBtnPair && subBtnTransfer && grid) {
    subBtnPair.classList.add('active');
    subBtnTransfer.classList.remove('active');
    grid.classList.add('show-pair');
    grid.classList.remove('show-transfer');
  }

  // Mode specific hooks
  if (targetModeId === 'mode-offline') {
    loadServerInfo();
    updateOfflinePairStatus(state.targetPeer);
  } else if (targetModeId === 'mode-wifi') {
    pingRadar();
  } else if (targetModeId === 'mode-global') {
    // Active WebSocket connection persistently keeps room alive; do not re-send JOIN_ROOM on UI tab toggle
  }
}

// ============================================================
// 2. MODE 2: OFFLINE HOTSPOT (ZERO-STORAGE LIVE STREAM & 0-INTERNET OPTICAL P2P)
// ============================================================
const offlineRTC = {
  pc: null,
  dc: null,
  role: 'sender', // 'sender' | 'receiver'
  filesToSend: null
};

function initOfflineHotspotMode() {
  const dropzone = document.getElementById('offline-dropzone');
  const fileInput = document.getElementById('offline-file-input');
  const btnCopyIp = document.getElementById('btn-copy-ip');
  const btnRoleSend = document.getElementById('btn-mode2-role-send');
  const btnRoleReceive = document.getElementById('btn-mode2-role-receive');
  const senderView = document.getElementById('mode2-sender-view');
  const receiverView = document.getElementById('mode2-receiver-view');
  const btnSelectFiles = document.getElementById('btn-mode2-select-files');
  const btnScanAnswer = document.getElementById('btn-mode2-scan-answer');

  // Role Toggle: Sender vs Receiver
  if (btnRoleSend && btnRoleReceive) {
    btnRoleSend.addEventListener('click', () => {
      offlineRTC.role = 'sender';
      btnRoleSend.classList.add('active');
      btnRoleReceive.classList.remove('active');
      if (senderView) senderView.style.display = 'block';
      if (receiverView) receiverView.style.display = 'none';
    });

    btnRoleReceive.addEventListener('click', () => {
      offlineRTC.role = 'receiver';
      btnRoleReceive.classList.add('active');
      btnRoleSend.classList.remove('active');
      if (receiverView) receiverView.style.display = 'block';
      if (senderView) senderView.style.display = 'none';
    });
  }

  if (btnSelectFiles && fileInput) {
    btnSelectFiles.addEventListener('click', () => fileInput.click());
  }

  if (btnScanAnswer) {
    btnScanAnswer.addEventListener('click', startCameraScanner);
  }

  // Quick jump link from Mode 2 banner to Mode 1 (Radar)
  const linkGotoRadar = document.getElementById('link-goto-radar-mode');
  if (linkGotoRadar) {
    linkGotoRadar.addEventListener('click', (e) => {
      e.preventDefault();
      switchMode('mode-wifi');
    });
  }

  // Copy Sender Pairing Code button
  const btnCopySenderCode = document.getElementById('btn-copy-sender-code');
  if (btnCopySenderCode) {
    btnCopySenderCode.addEventListener('click', () => {
      const text = document.getElementById('mode2-sender-code-text')?.textContent;
      if (text && !text.includes('Generating')) {
        navigator.clipboard.writeText(text);
        showToast('📋 Pairing code copied to clipboard!');
      }
    });
  }

  // Toggle Laptop Answer Code Input Box
  const btnToggleAnswerInput = document.getElementById('btn-toggle-sender-answer-input');
  const answerInputBox = document.getElementById('sender-answer-input-box');
  if (btnToggleAnswerInput && answerInputBox) {
    btnToggleAnswerInput.addEventListener('click', () => {
      answerInputBox.style.display = answerInputBox.style.display === 'none' ? 'block' : 'none';
      if (answerInputBox.style.display === 'block') {
        document.getElementById('input-sender-answer-code')?.focus();
      }
    });
  }

  // Submit Sender's entered Answer Code from Phone
  const btnSubmitSenderAnswer = document.getElementById('btn-submit-sender-answer-code');
  if (btnSubmitSenderAnswer) {
    btnSubmitSenderAnswer.addEventListener('click', () => {
      const inputEl = document.getElementById('input-sender-answer-code');
      const code = inputEl?.value?.trim();
      if (!code) {
        showToast('⚠️ Please paste Phone\'s Answer Code first.');
        return;
      }
      handleOfflineAnswerScanned(code);
    });
  }

  // Submit Receiver's entered Pairing Code from Sender
  const btnSubmitReceiverPairing = document.getElementById('btn-submit-receiver-pairing-code');
  if (btnSubmitReceiverPairing) {
    btnSubmitReceiverPairing.addEventListener('click', () => {
      const inputEl = document.getElementById('input-receiver-pairing-code');
      const code = inputEl?.value?.trim();
      if (!code) {
        showToast('⚠️ Please enter Sender\'s Code first.');
        return;
      }
      handleOfflineOfferScanned(code);
    });
  }

  // Copy Receiver Answer Code button
  const btnCopyReceiverCode = document.getElementById('btn-copy-receiver-code');
  if (btnCopyReceiverCode) {
    btnCopyReceiverCode.addEventListener('click', () => {
      const text = document.getElementById('mode2-receiver-code-text')?.textContent;
      if (text && !text.includes('Generating')) {
        navigator.clipboard.writeText(text);
        showToast('📋 Answer code copied to clipboard!');
      }
    });
  }

  const handleFilesSelected = (files) => {
    if (!files || files.length === 0) return;

    // 1. If online WebSocket is connected and paired with target peer, use server signaling
    if (state.wsConnected && state.targetPeer && state.targetPeer.id) {
      initiateRadarTransferRequest(Array.from(files), state.targetPeer);
      return;
    }

    // 2. 0-Internet / 0-Node.js Air-Gapped Mode: Generate Offer QR directly!
    startOfflineSenderFlow(files);
  };

  if (dropzone) {
    dropzone.addEventListener('click', (e) => {
      if (e.target.tagName !== 'INPUT') {
        fileInput?.click();
      }
    });

    ['dragenter', 'dragover'].forEach(eventName => {
      dropzone.addEventListener(eventName, e => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.add('dragover');
      });
    });

    ['dragleave', 'drop'].forEach(eventName => {
      dropzone.addEventListener(eventName, e => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.remove('dragover');
      });
    });

    dropzone.addEventListener('drop', e => {
      const files = e.dataTransfer.files;
      if (files && files.length > 0) {
        handleFilesSelected(files);
      }
    });
  }

  if (fileInput) {
    fileInput.addEventListener('change', () => {
      if (fileInput.files && fileInput.files.length > 0) {
        handleFilesSelected(fileInput.files);
      }
    });
  }

  if (btnCopyIp) {
    btnCopyIp.addEventListener('click', () => {
      if (state.connectUrl) {
        navigator.clipboard.writeText(state.connectUrl);
        showToast('Copied local address to clipboard! 📋');
      }
    });
  }
}

// Ultra-Compact WebRTC Parameters (< 175 characters for giant, easily scannable QR blocks)
function extractMinifiedWebRTC(sdp, role) {
  const u = sdp.match(/a=ice-ufrag:(.+)/)?.[1]?.trim() || '';
  const p = sdp.match(/a=ice-pwd:(.+)/)?.[1]?.trim() || '';
  const f = sdp.match(/a=fingerprint:sha-256 (.+)/)?.[1]?.trim() || '';

  // Extract all IPv4 host candidates
  const candLines = (sdp || '').split('\n').filter(l => l.includes('typ host'));
  let bestCand = '192.168.43.1:54321';
  for (const line of candLines) {
    const parts = line.trim().split(/\s+/);
    const ip = parts[4];
    const port = parts[5];
    if (ip && port && !ip.includes(':')) {
      bestCand = `${ip}:${port}`;
      if (ip.startsWith('192.168.') || ip.startsWith('172.') || ip.startsWith('10.')) {
        break;
      }
    }
  }

  return {
    t: role === 'offer' ? 'o' : 'a',
    u,
    p,
    f,
    c: bestCand
  };
}

function reconstructSDP(min) {
  const { t, u, p, f, c } = min;
  const [ip, port] = (c || '192.168.43.1:54321').split(':');
  const setup = t === 'o' ? 'actpass' : 'active';
  return [
    'v=0',
    `o=- ${Date.now()} 2 IN IP4 127.0.0.1`,
    's=-',
    't=0 0',
    'a=group:BUNDLE 0',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
    `c=IN IP4 ${ip}`,
    `a=ice-ufrag:${u}`,
    `a=ice-pwd:${p}`,
    'a=ice-options:trickle',
    `a=fingerprint:sha-256 ${f}`,
    `a=setup:${setup}`,
    'a=mid:0',
    'a=sctp-port:5000',
    'a=max-message-size:262144',
    `a=candidate:1 1 UDP 2122260223 ${ip} ${port} typ host`,
    ''
  ].join('\r\n');
}

function encodeMinifiedPayload(min) {
  return 'antyshare:m:' + JSON.stringify(min);
}

function encodeOfflineToken(obj, prefix = 'ANTY') {
  try {
    const json = JSON.stringify(obj);
    let binary = '';
    const bytes = new TextEncoder().encode(json);
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    const b64 = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return `${prefix}-${b64}`;
  } catch (e) {
    console.warn('encodeOfflineToken fallback:', e);
    return `${prefix}-${encodeURIComponent(JSON.stringify(obj))}`;
  }
}

function decodeOfflineToken(token) {
  if (!token || typeof token !== 'string') return null;
  const trimmed = token.trim();
  if (trimmed.startsWith('antyshare:m:')) {
    try { return JSON.parse(trimmed.slice(12)); } catch (e) {}
  }
  if (trimmed.startsWith('{') && trimmed.includes('"t":')) {
    try { return JSON.parse(trimmed); } catch (e) {}
  }
  const clean = trimmed.replace(/^ANTY(-ANSW)?-?/i, '').trim();
  try {
    let b64 = clean.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const json = new TextDecoder().decode(bytes);
    return JSON.parse(json);
  } catch (e) {
    try {
      return JSON.parse(decodeURIComponent(clean));
    } catch (err) {
      console.warn('decodeOfflineToken failed:', err);
      return null;
    }
  }
}

async function decodeMinifiedPayload(payload) {
  if (typeof payload === 'object' && payload !== null) {
    return {
      type: payload.t === 'o' ? 'offer' : 'answer',
      sdp: reconstructSDP(payload),
      meta: payload
    };
  }
  const trimmed = (payload || '').trim();
  if (trimmed.startsWith('antyshare:m:')) {
    const jsonStr = trimmed.slice(12);
    const min = JSON.parse(jsonStr);
    return {
      type: min.t === 'o' ? 'offer' : 'answer',
      sdp: reconstructSDP(min),
      meta: min
    };
  }
  if (trimmed.startsWith('{') && trimmed.includes('"t":') && trimmed.includes('"u":')) {
    const min = JSON.parse(trimmed);
    return {
      type: min.t === 'o' ? 'offer' : 'answer',
      sdp: reconstructSDP(min),
      meta: min
    };
  }
  if (trimmed.startsWith('ANTY-') || trimmed.startsWith('ANTY_') || trimmed.includes('-')) {
    const min = decodeOfflineToken(trimmed);
    if (min) {
      return {
        type: min.t === 'o' ? 'offer' : 'answer',
        sdp: reconstructSDP(min),
        meta: min
      };
    }
  }
  // Legacy decompression fallback
  return decompressSDP(trimmed);
}

async function decompressSDP(payload) {
  try {
    const parts = payload.split(':');
    const mode = parts[1];
    const type = parts[2] === 'o' ? 'offer' : 'answer';
    const data = parts.slice(3).join(':');

    if (mode === 'c') {
      let base64 = data.replace(/-/g, '+').replace(/_/g, '/');
      while (base64.length % 4) base64 += '=';
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const ds = new DecompressionStream('deflate-raw');
      const stream = new Blob([bytes]).stream().pipeThrough(ds);
      const sdp = await new Response(stream).text();
      return { type, sdp };
    } else {
      return { type, sdp: decodeURIComponent(data) };
    }
  } catch (err) {
    console.error('Decompression error:', err);
    return { type: 'offer', sdp: '' };
  }
}

async function startOfflineSenderFlow(files) {
  offlineRTC.role = 'sender';
  offlineRTC.filesToSend = Array.from(files);

  const totalBytes = offlineRTC.filesToSend.reduce((acc, f) => acc + f.size, 0);
  const fileNameDisplay = offlineRTC.filesToSend.length === 1
    ? offlineRTC.filesToSend[0].name
    : `${offlineRTC.filesToSend[0].name} (+${offlineRTC.filesToSend.length - 1} more)`;

  // Register state for streaming upon DataChannel open
  state.pendingOutgoingRequest = {
    files: offlineRTC.filesToSend,
    targetName: 'Nearby Receiver',
    totalBytes,
    fileNameDisplay
  };

  // Close previous connection if any
  if (offlineRTC.pc) {
    try { offlineRTC.pc.close(); } catch (e) {}
  }

  const pc = new RTCPeerConnection({ iceServers: [] });
  offlineRTC.pc = pc;

  const dc = pc.createDataChannel('antyshareBeam', { ordered: true });
  offlineRTC.dc = dc;

  setupDataChannel(dc, 'offline_receiver', true);

  // Gather host candidates
  const sdpPromise = new Promise(resolve => {
    let resolved = false;
    const finish = () => {
      if (!resolved && pc.localDescription) {
        resolved = true;
        resolve(pc.localDescription.sdp);
      }
    };
    pc.onicecandidate = (e) => {
      if (!e.candidate) finish();
    };
    setTimeout(finish, 1000);
  });

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  const fullOfferSdp = await sdpPromise;
  const minOffer = extractMinifiedWebRTC(fullOfferSdp, 'offer');
  minOffer.fn = fileNameDisplay;
  minOffer.fs = totalBytes;
  minOffer.fc = offlineRTC.filesToSend.length;
  minOffer.pid = state.myPeerId || '';
  minOffer.dev = state.deviceId || '';
  minOffer.nam = state.deviceName || 'Laptop';
  
  // 100% Zero-Internet Air-Gapped Optical Payload (Pure Browser Native)
  const minPayload = encodeMinifiedPayload(minOffer);
  const pairCode = encodeOfflineToken(minOffer, 'ANTY');

  displayOfflineOfferQR(minPayload, pairCode, offlineRTC.filesToSend);
}

async function displayOfflineOfferQR(qrPayload, pairCode, files) {
  const qrImg = document.getElementById('offline-sender-qr-img');
  const loader = document.getElementById('sender-qr-loader');
  const qrBox = document.getElementById('mode2-sender-qr-box');
  const promptBox = document.getElementById('mode2-sender-prompt');
  const waitStatus = document.getElementById('mode2-sender-waiting-status');
  const codeText = document.getElementById('mode2-sender-code-text');

  if (promptBox) promptBox.style.display = 'none';
  if (qrBox) qrBox.style.display = 'block';
  if (loader) loader.style.display = 'flex';
  if (qrImg) qrImg.style.display = 'none';

  if (codeText && pairCode) {
    codeText.textContent = pairCode;
  }

  if (waitStatus) {
    waitStatus.innerHTML = `
      <div class="spinner" style="width: 20px; height: 20px; margin: 0 auto 8px; border: 2px solid rgba(0, 240, 255, 0.2); border-top-color: #00f0ff; border-radius: 50%; animation: spin 1s linear infinite;"></div>
      <span style="font-size: 13px; font-weight: 600; color: #00f0ff;">⏳ Waiting for Receiver phone to scan QR or enter code...</span>
    `;
    waitStatus.style.display = 'block';
  }

  try {
    if (typeof QRCode !== 'undefined' && QRCode.toDataURL) {
      // LOW ERROR CORRECTION + COMPACT PAYLOAD = GIANT, INSTANTLY SCANNABLE QR BLOCKS
      const dataUrl = await QRCode.toDataURL(qrPayload, {
        width: 320,
        margin: 2,
        errorCorrectionLevel: 'L',
        color: { dark: '#000000', light: '#ffffff' }
      });
      if (qrImg) {
        qrImg.src = dataUrl;
        qrImg.style.display = 'block';
      }
      if (loader) loader.style.display = 'none';
      const statusText = document.getElementById('offline-pair-status-text');
      if (statusText) {
        statusText.innerHTML = '📱 <b>Ready to Beam:</b> Scan QR or enter Pairing Code';
        statusText.style.color = '#00f0ff';
      }
      showToast('📱 Show QR or Pairing Code to Receiver!');
    }
  } catch (err) {
    console.warn('QR render error:', err);
    if (loader) loader.style.display = 'none';
  }
}

async function handleOfflineOfferScanned(decodedText) {
  try {
    let offerMeta = null;
    let sdp = null;

    if (typeof decodedText === 'object' && decodedText !== null) {
      offerMeta = decodedText;
      sdp = reconstructSDP(decodedText);
    } else {
      const trimmed = (decodedText || '').trim();
      const decoded = await decodeMinifiedPayload(trimmed);
      sdp = decoded.sdp;
      offerMeta = decoded.meta;
    }

    if (!sdp) {
      showToast('⚠️ Could not decode Offer code or QR.');
      return;
    }

    switchMode('mode-offline');

    const fileName = offerMeta?.fn || 'Incoming File';
    const fileSize = offerMeta?.fs || 0;
    const senderName = offerMeta?.nam || 'Laptop';

    state.pendingIncomingRequest = {
      requestId: 'req_' + Date.now(),
      fromPeerId: offerMeta?.pid || '',
      fromDeviceId: offerMeta?.dev || '',
      fromPeerName: senderName,
      fileName,
      fileSize,
      fileFormatted: formatBytes(fileSize),
      fileCount: offerMeta?.fc || 1,
      sdpPayload: sdp
    };

    state.pendingOfflineOffer = { sdp, offerMeta };

    // Update receiver modal UI
    const nameEl = document.getElementById('incoming-sender-name');
    const fileEl = document.getElementById('incoming-file-name');
    const sizeEl = document.getElementById('incoming-file-size');
    if (nameEl) nameEl.textContent = senderName;
    if (fileEl) fileEl.textContent = fileName;
    if (sizeEl) sizeEl.textContent = formatBytes(fileSize);

    const dangerousExts = ['.exe', '.bat', '.cmd', '.msi', '.vbs', '.scr', '.ps1', '.sh', '.com', '.jar', '.apk', '.bin'];
    const isDangerous = dangerousExts.some(ext => fileName.toLowerCase().endsWith(ext));
    const warnBox = document.getElementById('incoming-file-warning');
    if (warnBox) warnBox.style.display = isDangerous ? 'block' : 'none';

    playChime(true);
    showModal('modal-incoming-request');
  } catch (err) {
    console.error('Error handling offline offer:', err);
    showToast('❌ Error parsing sender code/QR. Please try again.');
  }
}

async function proceedOfflineOpticalAnswer() {
  const offerData = state.pendingOfflineOffer || { sdp: state.pendingIncomingRequest?.sdpPayload };
  if (!offerData || !offerData.sdp) return;

  const btnReceive = document.getElementById('btn-mode2-role-receive');
  if (btnReceive) btnReceive.click();

  if (offlineRTC.pc) {
    try { offlineRTC.pc.close(); } catch (e) {}
  }

  const pc = new RTCPeerConnection({ iceServers: [] });
  offlineRTC.pc = pc;

  pc.ondatachannel = (e) => {
    console.log('✅ Offline Hotspot Receiver DataChannel connected!');
    offlineRTC.dc = e.channel;
    setupDataChannel(e.channel, 'offline_sender', false);
    playChime(true);
    showToast('⚡ Direct Hotspot P2P Connected! Receiving files...');

    const subBtnTransfer = document.getElementById('sub-btn-transfer');
    if (subBtnTransfer) subBtnTransfer.click();

    const statusText = document.getElementById('offline-pair-status-text');
    if (statusText) {
      statusText.textContent = '🟢 Connected & Streaming Live';
      statusText.style.color = '#10b981';
    }

    const recQrBox = document.getElementById('mode2-receiver-qr-box');
    if (recQrBox) recQrBox.style.display = 'none';
  };

  const sdpPromise = new Promise(resolve => {
    let resolved = false;
    const finish = () => {
      if (!resolved && pc.localDescription) {
        resolved = true;
        resolve(pc.localDescription.sdp);
      }
    };
    pc.onicecandidate = (e) => {
      if (!e.candidate) finish();
    };
    setTimeout(finish, 1000);
  });

  await pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: offerData.sdp }));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);

  const fullAnswerSdp = await sdpPromise;
  const minAnswer = extractMinifiedWebRTC(fullAnswerSdp, 'answer');
  const minAnswerPayload = encodeMinifiedPayload(minAnswer);
  const answerToken = encodeOfflineToken(minAnswer, 'ANTY-ANSW');

  displayOfflineAnswerQR(minAnswerPayload, answerToken);
}

async function displayOfflineAnswerQR(minAnswerPayload, answerToken) {
  const qrImg = document.getElementById('offline-receiver-qr-img');
  const loader = document.getElementById('receiver-qr-loader');
  const qrBox = document.getElementById('mode2-receiver-qr-box');
  const promptBox = document.getElementById('mode2-receiver-prompt');
  const codeText = document.getElementById('mode2-receiver-code-text');

  if (promptBox) promptBox.style.display = 'none';
  if (qrBox) qrBox.style.display = 'block';
  if (loader) loader.style.display = 'flex';
  if (qrImg) qrImg.style.display = 'none';

  if (codeText && answerToken) {
    codeText.textContent = answerToken;
  }

  try {
    if (typeof QRCode !== 'undefined' && QRCode.toDataURL) {
      // HIGH-CONTRAST PURE BLACK ON WHITE FOR ULTRA-FAST CAMERA DETECTION
      const dataUrl = await QRCode.toDataURL(minAnswerPayload, {
        width: 280,
        margin: 2,
        errorCorrectionLevel: 'L',
        color: { dark: '#000000', light: '#ffffff' }
      });
      if (qrImg) {
        qrImg.src = dataUrl;
        qrImg.style.display = 'block';
      }
      if (loader) loader.style.display = 'none';
      playChime(true);
      updateOfflinePairStatus();
      showToast('📱 Step 2: Show this Answer QR or Code to Sender!');
    }
  } catch (err) {
    console.warn('Answer QR render error:', err);
    if (loader) loader.style.display = 'none';
  }
}

async function handleOfflineAnswerScanned(decodedText) {
  try {
    if (!offlineRTC.pc) {
      showToast('⚠️ No active transfer waiting. Please select files first.');
      return;
    }

    let answerSdp = null;
    if (typeof decodedText === 'object' && decodedText !== null) {
      answerSdp = reconstructSDP(decodedText);
    } else {
      const trimmed = (decodedText || '').trim();
      const decoded = await decodeMinifiedPayload(trimmed);
      if (decoded.type === 'answer') {
        answerSdp = decoded.sdp;
      }
    }

    if (!answerSdp) {
      showToast('⚠️ Could not decode Answer code or QR.');
      return;
    }

    await offlineRTC.pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: answerSdp }));
    showToast('✅ Answer verified! Opening local Wi-Fi data stream...');
    playChime(true);

    const statusText = document.getElementById('offline-pair-status-text');
    if (statusText) {
      statusText.textContent = '🟢 P2P Connected • Streaming Chunks';
      statusText.style.color = '#10b981';
    }

    const waitStatus = document.getElementById('mode2-sender-waiting-status');
    if (waitStatus) {
      waitStatus.innerHTML = '<span style="font-size: 13.5px; font-weight: 700; color: #10b981;">⚡ Connected! Beaming file memory-to-memory...</span>';
    }
  } catch (err) {
    console.error('Error handling offline answer:', err);
    showToast('❌ Error establishing connection from Answer.');
  }
}

function handleOfflineOpticalPayload(decodedText) {
  if (typeof decodedText === 'string') {
    const trimmed = decodedText.trim();
    if (trimmed.startsWith('ANTY-ANSW-')) {
      handleOfflineAnswerScanned(trimmed);
      return;
    }
    if (trimmed.startsWith('ANTY-')) {
      handleOfflineOfferScanned(trimmed);
      return;
    }
  }

  if (decodedText.startsWith('antyshare:m:')) {
    try {
      const min = JSON.parse(decodedText.slice(12));
      if (min.t === 'o') {
        handleOfflineOfferScanned(decodedText);
      } else {
        handleOfflineAnswerScanned(decodedText);
      }
      return;
    } catch (e) {}
  }

  if (decodedText.startsWith('{') && decodedText.includes('"t":')) {
    try {
      const min = JSON.parse(decodedText);
      if (min.t === 'o') {
        handleOfflineOfferScanned(decodedText);
      } else {
        handleOfflineAnswerScanned(decodedText);
      }
      return;
    } catch (e) {}
  }

  if (decodedText.startsWith('antyshare:c:o:') || decodedText.startsWith('antyshare:r:o:')) {
    handleOfflineOfferScanned(decodedText);
  } else if (decodedText.startsWith('antyshare:c:a:') || decodedText.startsWith('antyshare:r:a:')) {
    handleOfflineAnswerScanned(decodedText);
  } else {
    if (offlineRTC.role === 'sender' && offlineRTC.pc) {
      handleOfflineAnswerScanned(decodedText);
    } else {
      handleOfflineOfferScanned(decodedText);
    }
  }
}

// Unified Zero-Storage Live Stream Telemetry HUD (Works for Mode 1 Radar, Mode 2 Hotspot & Mode 3 Global P2P)
function updateTransferHUD({ visible, filename, speed, percent, bytes, status, complete }) {
  // Mode 1: Quick Wi-Fi Radar HUD
  const radarHud = document.getElementById('radar-beam-hud');
  if (radarHud) {
    if (visible && state.activeMode === 'mode-wifi') {
      radarHud.style.display = 'block';
    } else if (!visible) {
      radarHud.style.display = 'none';
    }
    if (filename) document.getElementById('radar-hud-filename').textContent = filename;
    if (speed) document.getElementById('radar-hud-speed').textContent = speed;
    if (percent !== undefined) document.getElementById('radar-hud-progress').style.width = `${percent}%`;
    if (bytes) document.getElementById('radar-hud-bytes').textContent = bytes;
    if (status) document.getElementById('radar-hud-status').textContent = status;
  }

  // Mode 2: Offline Hotspot Zero-Storage Live Stream HUD
  const offlineHud = document.getElementById('transfer-hud');
  if (offlineHud) {
    if (visible && state.activeMode === 'mode-offline') {
      offlineHud.style.display = 'block';
    } else if (!visible) {
      offlineHud.style.display = 'none';
    }
    if (filename) document.getElementById('hud-filename').textContent = filename;
    if (speed) document.getElementById('hud-speed').textContent = speed;
    if (percent !== undefined) document.getElementById('hud-progress-fill').style.width = `${percent}%`;
    if (bytes) document.getElementById('hud-bytes').textContent = bytes;
    if (status) document.getElementById('hud-eta').textContent = status;
    const completeMsg = document.getElementById('hud-stream-complete-msg');
    if (completeMsg) completeMsg.style.display = complete ? 'block' : 'none';
  }

  // Mode 3: Global P2P HUD (Strict Role Isolation: Sender vs Receiver)
  if (state.activeMode === 'mode-global') {
    const isSender = (state.p2pRole === 'sender') || Boolean(state.pendingOutgoingRequest) || (p2p.isInitiator && !state.pendingIncomingRequest);
    const p2pSenderHud = document.getElementById('p2p-sender-hud');
    const p2pReceiverHud = document.getElementById('p2p-transfer-hud');

    if (isSender) {
      // CURRENT DEVICE IS SENDER: ONLY show Sender HUD on Left Card
      if (p2pSenderHud) {
        p2pSenderHud.style.display = visible ? 'block' : 'none';
        if (filename) {
          const el = document.getElementById('p2p-sender-hud-filename');
          if (el) el.textContent = filename;
        }
        if (speed) {
          const el = document.getElementById('p2p-sender-hud-speed');
          if (el) el.textContent = speed;
        }
        if (percent !== undefined) {
          const el = document.getElementById('p2p-sender-hud-progress');
          if (el) el.style.width = `${percent}%`;
        }
        if (bytes) {
          const el = document.getElementById('p2p-sender-hud-bytes');
          if (el) el.textContent = bytes;
        }
        if (status) {
          const el = document.getElementById('p2p-sender-hud-eta');
          if (el) el.textContent = status;
        }
      }
      // Never show Receiver HUD on Sender screen
      if (p2pReceiverHud) {
        p2pReceiverHud.style.display = 'none';
      }
    } else {
      // CURRENT DEVICE IS RECEIVER: ONLY show Receiver HUD on Right Card
      if (p2pReceiverHud) {
        p2pReceiverHud.style.display = visible ? 'block' : 'none';
        if (filename) {
          const el = document.getElementById('p2p-hud-filename');
          if (el) el.textContent = filename;
        }
        if (speed) {
          const el = document.getElementById('p2p-hud-speed');
          if (el) el.textContent = speed;
        }
        if (percent !== undefined) {
          const el = document.getElementById('p2p-hud-progress');
          if (el) el.style.width = `${percent}%`;
        }
        if (bytes) {
          const el = document.getElementById('p2p-hud-bytes');
          if (el) el.textContent = bytes;
        }
        if (status) {
          const el = document.getElementById('p2p-hud-eta');
          if (el) el.textContent = status;
        }
        const completeMsg = document.getElementById('p2p-hud-complete-msg');
        if (completeMsg) completeMsg.style.display = complete ? 'block' : 'none';
      }
      // Never show Sender HUD on Receiver screen
      if (p2pSenderHud) {
        p2pSenderHud.style.display = 'none';
      }
    }
  }
}

// Fetch Server Info (Mode 2 is 100% Air-Gapped Optical WebRTC, zero legacy duplicate QR)
async function loadServerInfo() {
  if (window.location.protocol !== 'file:') {
    try {
      const res = await fetch('/api/info');
      if (res.ok) {
        const data = await res.json();
        state.localIp = data.primaryIp;
        state.connectUrl = data.connectUrl;
      }
    } catch (e) {}
  }
}

// ============================================================
// 3. MODE 3: GLOBAL P2P TUNNEL (WEBRTC SIGNALLING VIA WS)
// ============================================================
function initGlobalP2PMode() {
  const p2pDropzone = document.getElementById('p2p-dropzone');
  const p2pFileInput = document.getElementById('p2p-file-input');
  const btnJoin = document.getElementById('btn-join-p2p');
  const btnCopyP2p = document.getElementById('btn-copy-p2p-url');
  const btnReset = document.getElementById('btn-p2p-reset');
  const inputCode = document.getElementById('input-p2p-code');

  if (p2pDropzone && p2pFileInput) {
    p2pDropzone.addEventListener('click', (e) => {
      if (e.target.tagName !== 'INPUT') {
        p2pFileInput.click();
      }
    });

    ['dragenter', 'dragover'].forEach(eventName => {
      p2pDropzone.addEventListener(eventName, e => {
        e.preventDefault();
        e.stopPropagation();
        p2pDropzone.classList.add('dragover');
      });
    });

    ['dragleave', 'drop'].forEach(eventName => {
      p2pDropzone.addEventListener(eventName, e => {
        e.preventDefault();
        e.stopPropagation();
        p2pDropzone.classList.remove('dragover');
      });
    });

    p2pDropzone.addEventListener('drop', e => {
      const files = e.dataTransfer.files;
      if (files && files.length > 0) {
        setupP2PRoom(files);
      }
    });

    p2pFileInput.addEventListener('change', () => {
      if (p2pFileInput.files && p2pFileInput.files.length > 0) {
        if (state.p2pTargetPeer && state.p2pTargetPeer.id) {
          // Peer is already connected in this room: Send new file directly!
          const files = Array.from(p2pFileInput.files);
          const totalBytes = files.reduce((acc, f) => acc + f.size, 0);
          const fileNameDisplay = files.length === 1 ? files[0].name : `${files[0].name} (+${files.length - 1} more)`;

          const fileInfoEl = document.getElementById('p2p-selected-file-info');
          if (fileInfoEl) {
            fileInfoEl.textContent = `📁 ${fileNameDisplay} (${formatBytes(totalBytes)})`;
            fileInfoEl.style.display = 'block';
          }

          const completeActions = document.getElementById('p2p-sender-completed-actions');
          if (completeActions) completeActions.style.display = 'none';

          state.p2pTransferInProgress = true;
          showToast(`Beaming ${fileNameDisplay} to ${state.p2pTargetPeer.name}...`);
          initiateRadarTransferRequest(files, state.p2pTargetPeer);
        } else {
          setupP2PRoom(p2pFileInput.files);
        }
      }
    });
  }

  if (btnReset) {
    btnReset.addEventListener('click', resetP2PRoom);
  }

  const btnSendMore = document.getElementById('btn-p2p-send-more');
  if (btnSendMore) {
    btnSendMore.addEventListener('click', () => {
      if (p2pFileInput) {
        p2pFileInput.value = '';
        p2pFileInput.click();
      }
    });
  }

  const btnNewRoom = document.getElementById('btn-p2p-new-room');
  if (btnNewRoom) {
    btnNewRoom.addEventListener('click', resetP2PRoom);
  }

  const btnLeaveRoom = document.getElementById('btn-p2p-leave-room');
  if (btnLeaveRoom) {
    btnLeaveRoom.addEventListener('click', resetP2PReceiver);
  }

  if (btnJoin && inputCode) {
    btnJoin.addEventListener('click', () => {
      joinP2PRoom(inputCode.value);
    });

    inputCode.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        joinP2PRoom(inputCode.value);
      }
    });

    // Auto-formatting and auto-submit on typing 6 digits
    inputCode.addEventListener('input', () => {
      const raw = inputCode.value.replace(/[^0-9]/g, '').slice(0, 6);
      if (raw.length > 3) {
        inputCode.value = `${raw.slice(0, 3)}-${raw.slice(3)}`;
      } else {
        inputCode.value = raw;
      }
      if (raw.length === 6) {
        joinP2PRoom(raw);
      }
    });
  }

  if (btnCopyP2p) {
    btnCopyP2p.addEventListener('click', () => {
      const url = document.getElementById('p2p-share-url')?.value;
      if (url) {
        navigator.clipboard.writeText(url);
        showToast('P2P Room Link copied to clipboard! 📋');
      }
    });
  }
}

function onP2PSenderTransferComplete() {
  const completeActions = document.getElementById('p2p-sender-completed-actions');
  const normalControls = document.querySelector('.p2p-sender-controls');
  const waitingInd = document.getElementById('p2p-waiting-indicator');

  if (waitingInd && state.p2pTargetPeer) {
    waitingInd.innerHTML = `🟢 <b>${escapeHtml(state.p2pTargetPeer.name)}</b> connected & ready`;
    waitingInd.style.color = '#10b981';
  }

  if (completeActions) completeActions.style.display = 'flex';
  if (normalControls) normalControls.style.display = 'none';
}

function resetP2PRoom() {
  state.p2pFilesToSend = null;
  state.p2pFileToSend = null;
  state.p2pRoomCode = null;
  state.p2pTargetPeer = null;
  state.p2pTransferInProgress = false;
  state.p2pRole = null;

  const dropzone = document.getElementById('p2p-dropzone');
  const display = document.getElementById('p2p-code-display');
  const fileInput = document.getElementById('p2p-file-input');
  const fileInfo = document.getElementById('p2p-selected-file-info');
  const senderHud = document.getElementById('p2p-sender-hud');
  const completeActions = document.getElementById('p2p-sender-completed-actions');
  const normalControls = document.querySelector('.p2p-sender-controls');

  if (dropzone) dropzone.style.display = 'block';
  if (display) display.style.display = 'none';
  if (fileInput) fileInput.value = '';
  if (fileInfo) fileInfo.style.display = 'none';
  if (senderHud) senderHud.style.display = 'none';
  if (completeActions) completeActions.style.display = 'none';
  if (normalControls) normalControls.style.display = 'flex';

  showToast('Ready for new transfer.');
}

function resetP2PReceiver() {
  state.p2pRoomCode = null;
  state.p2pTargetPeer = null;
  state.p2pTransferInProgress = false;
  state.p2pRole = null;

  const inputCode = document.getElementById('input-p2p-code');
  if (inputCode) inputCode.value = '';

  const statusTitle = document.getElementById('p2p-status-title');
  const statusDesc = document.getElementById('p2p-status-desc');
  if (statusTitle) statusTitle.textContent = 'Direct P2P Encrypted Tunnel';
  if (statusDesc) statusDesc.textContent = 'When you connect, files stream directly between both browsers without saving on any server.';

  const receiverHud = document.getElementById('p2p-transfer-hud');
  if (receiverHud) receiverHud.style.display = 'none';

  const receiverActions = document.getElementById('p2p-receiver-completed-actions');
  if (receiverActions) receiverActions.style.display = 'none';

  showToast('Disconnected from room.');
}

function setupP2PRoom(files) {
  const fileList = Array.isArray(files) ? files : Array.from(files || []);
  if (fileList.length === 0) return;
  state.p2pRole = 'sender';
  state.p2pFilesToSend = fileList;
  state.p2pFileToSend = fileList[0];

  const totalBytes = fileList.reduce((acc, f) => acc + f.size, 0);
  const totalFormatted = formatBytes(totalBytes);
  const fileNameDisplay = fileList.length === 1 ? fileList[0].name : `${fileList[0].name} (+${fileList.length - 1} more)`;

  const fileInfoEl = document.getElementById('p2p-selected-file-info');
  if (fileInfoEl) {
    fileInfoEl.textContent = `📁 ${fileNameDisplay} (${totalFormatted})`;
    fileInfoEl.style.display = 'block';
  }

  // If a target peer is already in the room, immediately initiate transfer!
  if (state.p2pTargetPeer && state.p2pTargetPeer.id) {
    showToast(`Sending files to ${state.p2pTargetPeer.name}...`);
    initiateRadarTransferRequest(fileList, state.p2pTargetPeer);
    return;
  }

  // Generate friendly 6-digit code e.g. 748-291
  const code = state.p2pRoomCode || Math.floor(100000 + Math.random() * 900000).toString();
  const formattedCode = `${code.slice(0, 3)}-${code.slice(3)}`;
  state.p2pRoomCode = code;

  const dropzone = document.getElementById('p2p-dropzone');
  const display = document.getElementById('p2p-code-display');
  if (dropzone) dropzone.style.display = 'none';
  if (display) display.style.display = 'block';

  const codeEl = document.getElementById('p2p-generated-code');
  if (codeEl) codeEl.textContent = formattedCode;

  const shareUrl = `${window.location.origin}/?mode=global&room=${code}`;
  const shareInput = document.getElementById('p2p-share-url');
  if (shareInput) shareInput.value = shareUrl;

  const waitingEl = document.getElementById('p2p-waiting-indicator');
  if (waitingEl) {
    waitingEl.textContent = '⏳ Waiting for recipient to join...';
    waitingEl.style.color = '';
  }

  // Signal server to join room
  if (state.ws && state.wsConnected) {
    state.ws.send(JSON.stringify({ type: 'JOIN_ROOM', roomCode: code }));
  }

  showToast(`Room created! Share code: ${formattedCode}`);
}

function joinP2PRoom(code) {
  const cleanCode = String(code || '').replace(/[^0-9]/g, '').trim();
  if (cleanCode.length < 6) {
    showToast('Please enter a valid 6-digit code!');
    return;
  }
  state.p2pRole = 'receiver';
  state.p2pRoomCode = cleanCode;

  const formatted = `${cleanCode.slice(0, 3)}-${cleanCode.slice(3)}`;
  const statusTitle = document.getElementById('p2p-status-title');
  const statusDesc = document.getElementById('p2p-status-desc');

  if (statusTitle) statusTitle.textContent = `Connecting to Room ${formatted}...`;
  if (statusDesc) statusDesc.textContent = 'Establishing secure P2P handshake with host...';

  if (state.ws && state.wsConnected) {
    state.ws.send(JSON.stringify({ type: 'JOIN_ROOM', roomCode: cleanCode }));
    showToast(`Joining Room ${formatted}...`);
  } else {
    showToast('Connecting to server...');
  }
}

// ============================================================
// 4. MODE 3: QUICK WI-FI RADAR & TARGETED BEAM
// ============================================================
function initQuickWifiMode() {
  const myLabel = document.getElementById('my-device-label');
  const myIcon = document.getElementById('my-device-icon');
  const nameInput = document.getElementById('input-device-name');
  const btnSaveName = document.getElementById('btn-save-device-name');
  const radarFileInput = document.getElementById('radar-file-input');

  if (myLabel) myLabel.textContent = state.deviceName;
  if (myIcon) myIcon.textContent = state.isMobile ? '📱' : '💻';
  if (nameInput) nameInput.value = state.deviceName;

  // Save device name
  function updateDeviceName() {
    const val = (nameInput.value || '').trim();
    if (!val) return;
    state.deviceName = val;
    localStorage.setItem('antyshare_device_name', val);
    if (myLabel) myLabel.textContent = val;
    pingRadar();
    showToast(`Device name updated to: ${val}`);
  }

  if (btnSaveName) btnSaveName.addEventListener('click', updateDeviceName);
  if (nameInput) {
    nameInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') updateDeviceName();
    });
  }

  // Handle radar file selection
  if (radarFileInput) {
    radarFileInput.addEventListener('change', () => {
      if (radarFileInput.files && radarFileInput.files.length > 0 && state.targetPeer) {
        initiateRadarTransferRequest(Array.from(radarFileInput.files), state.targetPeer);
      }
    });
  }

  // Sender modal cancel button
  const btnCancelReq = document.getElementById('btn-cancel-transfer-req');
  if (btnCancelReq) {
    btnCancelReq.addEventListener('click', () => {
      clearTimeout(state.outgoingTimeoutId);
      if (state.pendingOutgoingRequest && state.ws && state.wsConnected) {
        state.ws.send(JSON.stringify({
          type: 'RADAR_TRANSFER_CANCEL',
          requestId: state.pendingOutgoingRequest.requestId,
          toPeerId: state.pendingOutgoingRequest.targetPeerId
        }));
      }
      hideModal('modal-sender-waiting');
      state.pendingOutgoingRequest = null;
      showToast('Transfer request cancelled.');
    });
  }

  // Receiver modal buttons
  const btnAccept = document.getElementById('btn-accept-transfer');
  const btnDecline = document.getElementById('btn-decline-transfer');

  if (btnDecline) {
    btnDecline.addEventListener('click', () => {
      if (state.pendingIncomingRequest && state.ws && state.wsConnected) {
        state.ws.send(JSON.stringify({
          type: 'RADAR_TRANSFER_RESPONSE',
          requestId: state.pendingIncomingRequest.requestId,
          toPeerId: state.pendingIncomingRequest.fromPeerId,
          accepted: false,
          reason: 'Declined by user'
        }));
      }
      hideModal('modal-incoming-request');
      state.pendingIncomingRequest = null;
      showToast('Transfer request declined.');
    });
  }

  if (btnAccept) {
    btnAccept.addEventListener('click', async () => {
      if (state.pendingIncomingRequest) {
        const fromPeerId = state.pendingIncomingRequest.fromPeerId;
        const fromDeviceId = state.pendingIncomingRequest.fromDeviceId;
        state.targetPeer = {
          id: fromPeerId,
          deviceId: fromDeviceId,
          name: state.pendingIncomingRequest.fromPeerName
        };
        updateOfflinePairStatus(state.targetPeer);

        if (state.ws && state.wsConnected) {
          state.ws.send(JSON.stringify({
            type: 'RADAR_TRANSFER_RESPONSE',
            requestId: state.pendingIncomingRequest.requestId,
            toPeerId: fromPeerId,
            toDeviceId: fromDeviceId,
            accepted: true
          }));

          // Prepare direct WebRTC peer connection on receiver
          createP2PConnection(fromPeerId, false, fromDeviceId);

          // Show beam HUD on receiver
          updateTransferHUD({
            visible: true,
            filename: `Receiving: ${state.pendingIncomingRequest.fileName}`,
            speed: 'Connecting direct P2P stream...',
            bytes: `0 B / ${state.pendingIncomingRequest.fileFormatted}`,
            percent: 0,
            status: `Approved • Establishing direct Wi-Fi tunnel with ${state.pendingIncomingRequest.fromPeerName}`
          });
        } else if (state.pendingOfflineOffer || state.pendingIncomingRequest.sdpPayload) {
          // Pure air-gapped fallback
          await proceedOfflineOpticalAnswer();
        }
      }
      hideModal('modal-incoming-request');
    });
  }

  // Initialize Zero-Internet Offline QR & Camera Scanner
  initMode3OfflineQRPairing();
}

function initMode3OfflineQRPairing() {
  loadMode3OfflineQR();

  const btnRefreshQR = document.getElementById('btn-refresh-offline-qr');
  if (btnRefreshQR) {
    btnRefreshQR.addEventListener('click', () => {
      loadMode3OfflineQR();
      showToast('Offline QR Code refreshed!');
    });
  }

  const btnOpenScanner = document.getElementById('btn-open-camera-scanner');
  if (btnOpenScanner) {
    btnOpenScanner.addEventListener('click', startCameraScanner);
  }

  const btnMode2Scanner = document.getElementById('btn-mode2-open-scanner');
  if (btnMode2Scanner) {
    btnMode2Scanner.addEventListener('click', startCameraScanner);
  }

  const btnCloseScanner = document.getElementById('btn-close-camera-scanner');
  if (btnCloseScanner) {
    btnCloseScanner.addEventListener('click', stopCameraScanner);
  }

  // File fallback for picking QR code from gallery/screenshot
  const inputFallback = document.getElementById('input-qr-file-fallback');
  if (inputFallback) {
    inputFallback.addEventListener('change', async () => {
      if (inputFallback.files && inputFallback.files[0]) {
        handleFileQRScan(inputFallback.files[0]);
      }
    });
  }

  // Native phone camera snap button (works 100% on mobile file:// downloads)
  const inputCameraSnap = document.getElementById('input-qr-camera-snap');
  if (inputCameraSnap) {
    inputCameraSnap.addEventListener('change', async () => {
      if (inputCameraSnap.files && inputCameraSnap.files[0]) {
        handleFileQRScan(inputCameraSnap.files[0]);
      }
    });
  }
}

async function loadMode3OfflineQR() {
  const qrImg = document.getElementById('mode3-offline-qr-img');
  const spinner = document.getElementById('mode3-qr-spinner');
  if (!qrImg) return;

  const peerId = state.myPeerId || state.ws?.id || 'client_' + Math.random().toString(36).substr(2, 9);
  const rawOrigin = window.location.origin;
  const origin = (rawOrigin && rawOrigin.includes('antyshare.in'))
    ? 'https://antyshare.in'
    : (rawOrigin && rawOrigin.startsWith('http') ? rawOrigin : 'https://antyshare.in');
  const pairUrl = `${origin}/?pair=${encodeURIComponent(peerId)}&dev=${encodeURIComponent(state.deviceId)}&name=${encodeURIComponent(state.deviceName)}`;

  // 1. Instant client-side QR generation
  if (typeof QRCode !== 'undefined' && QRCode.toDataURL) {
    try {
      const dataUrl = await QRCode.toDataURL(pairUrl, {
        width: 220,
        margin: 1,
        color: { dark: '#00f0ff', light: '#0d1322' }
      });
      qrImg.src = dataUrl;
      qrImg.style.display = 'block';
      if (spinner) spinner.style.display = 'none';
      return;
    } catch (e) {
      console.warn('Client QR error:', e);
    }
  }

  // 2. Fallback to server API
  try {
    const res = await fetch(`/api/qr?url=${encodeURIComponent(pairUrl)}`);
    const data = await res.json();
    if (data.qrCode) {
      qrImg.src = data.qrCode;
      qrImg.style.display = 'block';
      if (spinner) spinner.style.display = 'none';
    }
  } catch (err) {
    console.warn('Could not generate Mode 3 offline QR:', err);
    if (spinner) spinner.style.display = 'none';
  }
}

let scannerStream = null;
let scannerScanning = false;

async function startCameraScanner() {
  showModal('modal-camera-scanner');
  const video = document.getElementById('camera-scanner-video');
  const viewport = document.querySelector('.camera-viewport-wrap');
  const statusText = document.getElementById('scanner-status-text');
  if (statusText) statusText.textContent = 'Starting camera...';

  // Check if live camera stream is permitted in this browser context
  const hasLiveCamera = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.isSecureContext !== false);

  if (!hasLiveCamera) {
    console.warn('Live getUserMedia is restricted on file:// URLs by mobile browser policy.');
    if (viewport) viewport.style.display = 'none';
    if (statusText) {
      statusText.innerHTML = '⚡ <b>Offline Mode:</b> Live webcam stream is restricted by Android for downloaded files.<br/>Tap <b>"Take Photo of QR"</b> below to snap with camera!';
    }
    return;
  }

  try {
    if (viewport) viewport.style.display = 'block';
    scannerStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } }
    });
    if (video) {
      video.srcObject = scannerStream;
      await video.play();
    }
    scannerScanning = true;
    if (statusText) statusText.textContent = 'Align QR code in the frame to pair...';
    scanCameraVideoFrame();
  } catch (err) {
    console.warn('Camera access denied or unavailable:', err);
    if (viewport) viewport.style.display = 'none';
    if (statusText) {
      statusText.innerHTML = '⚠️ Live camera restricted by browser permissions.<br/>Tap <b>"Take Photo of QR"</b> below to snap with camera!';
    }
  }
}

function stopCameraScanner() {
  scannerScanning = false;
  if (scannerStream) {
    scannerStream.getTracks().forEach(t => t.stop());
    scannerStream = null;
  }
  const video = document.getElementById('camera-scanner-video');
  if (video) video.srcObject = null;
  hideModal('modal-camera-scanner');
}

async function scanCameraVideoFrame() {
  if (!scannerScanning) return;
  const video = document.getElementById('camera-scanner-video');

  if (video && video.readyState === video.HAVE_ENOUGH_DATA) {
    let detectedPayload = null;

    // 1. Native BarcodeDetector (fast hardware acceleration if supported)
    if ('BarcodeDetector' in window) {
      try {
        const detector = new BarcodeDetector({ formats: ['qr_code'] });
        const barcodes = await detector.detect(video);
        if (barcodes && barcodes.length > 0 && barcodes[0].rawValue) {
          detectedPayload = barcodes[0].rawValue;
        }
      } catch (e) {}
    }

    // 2. Universal jsQR fallback (scans 100% of frames on any mobile browser!)
    if (!detectedPayload && typeof jsQR !== 'undefined') {
      try {
        const canvas = document.getElementById('camera-scanner-canvas');
        if (canvas) {
          canvas.width = video.videoWidth || 640;
          canvas.height = video.videoHeight || 480;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: 'dontInvert'
          });
          if (code && code.data) {
            detectedPayload = code.data;
          }
        }
      } catch (e) {}
    }

    if (detectedPayload) {
      handleScannedQRResult(detectedPayload);
      return;
    }
  }

  if (scannerScanning) {
    requestAnimationFrame(scanCameraVideoFrame);
  }
}

async function handleFileQRScan(file) {
  const statusText = document.getElementById('scanner-status-text');
  if (statusText) statusText.textContent = 'Scanning image file...';

  const img = new Image();
  img.onload = async () => {
    const canvas = document.getElementById('camera-scanner-canvas');
    if (!canvas) return;
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);

    let detectedPayload = null;

    if ('BarcodeDetector' in window) {
      try {
        const detector = new BarcodeDetector({ formats: ['qr_code'] });
        const barcodes = await detector.detect(canvas);
        if (barcodes && barcodes.length > 0 && barcodes[0].rawValue) {
          detectedPayload = barcodes[0].rawValue;
        }
      } catch (e) {}
    }

    if (!detectedPayload && typeof jsQR !== 'undefined') {
      try {
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: 'attemptBoth'
        });
        if (code && code.data) {
          detectedPayload = code.data;
        }
      } catch (e) {}
    }

    if (detectedPayload) {
      handleScannedQRResult(detectedPayload);
      return;
    }

    showToast('⚠️ Could not detect QR code in this image. Try another photo.');
    if (statusText) statusText.textContent = 'Could not detect QR. Try scanning with camera.';
  };
  img.src = URL.createObjectURL(file);
}

function handleScannedQRResult(decodedText) {
  stopCameraScanner();
  playChime(true);

  if (typeof decodedText !== 'string') return;
  const trimmed = decodedText.trim();

  // 1. Try URL parsing first (Handles Smart Transfer QR codes from both online & offline modes)
  try {
    const url = new URL(trimmed);
    const pairId = url.searchParams.get('p') || url.searchParams.get('pair');
    const pairDev = url.searchParams.get('d') || url.searchParams.get('dev');
    const targetName = decodeURIComponent(url.searchParams.get('n') || url.searchParams.get('name') || 'Laptop');
    const mode = url.searchParams.get('m') || url.searchParams.get('mode');
    const fn = url.searchParams.get('f') || url.searchParams.get('fn');
    const fs = url.searchParams.get('s') || url.searchParams.get('fs');
    const fc = url.searchParams.get('c') || url.searchParams.get('fc');
    const sdpParam = url.searchParams.get('sdp');

    if (pairId || pairDev) {
      state.targetPeer = { id: pairId, deviceId: pairDev, name: targetName };
      if (mode === 'offline') {
        switchMode('mode-offline');
      }
      updateOfflinePairStatus(state.targetPeer);

      if (state.ws && state.wsConnected) {
        state.ws.send(JSON.stringify({
          type: 'PAIR_ANNOUNCE',
          toPeerId: pairId,
          toDeviceId: pairDev,
          fromPeerId: state.myPeerId || state.ws.id,
          fromDeviceId: state.deviceId,
          fromPeerName: state.deviceName,
          fromIsMobile: state.isMobile
        }));
      }

      if (fn) {
        // Scanning device is the RECEIVER: Pop up Accept/Reject modal immediately!
        const fileName = decodeURIComponent(fn);
        const fileSize = parseInt(fs || '0', 10);
        const fileCount = parseInt(fc || '1', 10);

        state.pendingIncomingRequest = {
          requestId: 'req_' + Date.now(),
          fromPeerId: pairId || '',
          fromDeviceId: pairDev || '',
          fromPeerName: targetName,
          fileName,
          fileSize,
          fileFormatted: formatBytes(fileSize),
          fileCount,
          sdpPayload: sdpParam ? decodeURIComponent(sdpParam) : ''
        };

        const nameEl = document.getElementById('incoming-sender-name');
        const fileEl = document.getElementById('incoming-file-name');
        const sizeEl = document.getElementById('incoming-file-size');
        if (nameEl) nameEl.textContent = targetName;
        if (fileEl) fileEl.textContent = fileName;
        if (sizeEl) sizeEl.textContent = formatBytes(fileSize);

        const dangerousExts = ['.exe', '.bat', '.cmd', '.msi', '.vbs', '.scr', '.ps1', '.sh', '.com', '.jar', '.apk', '.bin'];
        const isDangerous = dangerousExts.some(ext => fileName.toLowerCase().endsWith(ext));
        const warnBox = document.getElementById('incoming-file-warning');
        if (warnBox) warnBox.style.display = isDangerous ? 'block' : 'none';

        showModal('modal-incoming-request');
        showToast(`📱 Incoming file transfer request from ${targetName}!`);
        return;
      }

      showToast(`✓ Paired with ${targetName}! Select file to beam:`);
      setTimeout(() => {
        if (mode === 'offline') {
          document.getElementById('offline-file-input')?.click();
        } else {
          document.getElementById('radar-file-input')?.click();
        }
      }, 500);
      return;
    }
  } catch (e) {}

  // 2. Air-Gapped Optical WebRTC Handshake (0 Internet & Zero Node.js)
  if (trimmed.startsWith('antyshare:m:') || trimmed.startsWith('ANTY-') || trimmed.startsWith('antyshare:c:') || trimmed.startsWith('antyshare:r:') || (trimmed.startsWith('{') && trimmed.includes('"t":'))) {
    handleOfflineOpticalPayload(trimmed);
    return;
  }

  // Plain JSON payload support
  try {
    const data = JSON.parse(decodedText);
    if (data.peerId || data.deviceId) {
      state.targetPeer = { id: data.peerId, deviceId: data.deviceId, name: data.name || 'Paired Device' };
      updateOfflinePairStatus(state.targetPeer);
      if (state.ws && state.wsConnected) {
        state.ws.send(JSON.stringify({
          type: 'PAIR_ANNOUNCE',
          toPeerId: data.peerId,
          toDeviceId: data.deviceId,
          fromPeerId: state.myPeerId || state.ws.id,
          fromDeviceId: state.deviceId,
          fromPeerName: state.deviceName,
          fromIsMobile: state.isMobile
        }));
      }
      showToast(`✓ Paired with ${state.targetPeer.name}! Select file to beam:`);
      setTimeout(() => {
        document.getElementById('radar-file-input')?.click();
      }, 500);
      return;
    }
  } catch (e) {}

  showToast(`Scanned payload: ${decodedText.slice(0, 30)}...`);
}

function pingRadar() {
  if (state.ws && state.wsConnected) {
    state.ws.send(JSON.stringify({
      type: 'RADAR_PING',
      deviceId: state.deviceId,
      deviceInfo: {
        name: state.deviceName,
        isMobile: state.isMobile
      }
    }));
  }
}

function renderRadarPeers(peers, networkIp = null) {
  const radarPeersContainer = document.getElementById('radar-peers');
  const discoveredList = document.getElementById('discovered-peers-list');
  const ipLabel = document.getElementById('radar-network-ip');

  if (ipLabel && networkIp) {
    ipLabel.textContent = `Wi-Fi Network: ${networkIp}`;
  }

  if (!radarPeersContainer || !discoveredList) return;

  radarPeersContainer.innerHTML = '';
  discoveredList.innerHTML = '';

  // Strict deduplication: filter out own device and collapse duplicate tabs/scans from same device
  const seenKeys = new Set();
  const otherPeers = [];
  const myNormName = (state.deviceName || '').trim().toLowerCase();

  for (const p of peers) {
    // 1. Ignore self by socket id
    if (p.id === state.ws?.id) continue;
    // 2. Ignore self by deviceId
    if (p.deviceId && state.deviceId && p.deviceId === state.deviceId) continue;

    const pNormName = (p.name || '').trim().toLowerCase();
    // 3. Ignore self by normalized name and device type
    if (myNormName && pNormName && myNormName === pNormName && Boolean(p.isMobile) === Boolean(state.isMobile)) {
      continue;
    }

    // 4. Strict deduplication key:
    // Any two connections on the same Wi-Fi with the same Name and device type (e.g. "1111" mobile)
    // represent the EXACT SAME physical device (e.g. repeated QR scans or multiple background tabs).
    const key = pNormName
      ? `${pNormName}_${p.isMobile ? 'm' : 'd'}`
      : (p.deviceId || p.id);

    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      otherPeers.push(p);
    }
  }

  if (otherPeers.length === 0) {
    discoveredList.innerHTML = `<span class="scanning-text">No other devices on this Wi-Fi yet. Open <b>antyshare.in</b> on another phone or laptop connected to this same Wi-Fi!</span>`;
    return;
  }

  discoveredList.innerHTML = `<h4>Found ${otherPeers.length} active device(s) on your Wi-Fi:</h4>`;

  otherPeers.forEach((p, idx) => {
    // Calculate angle on radar using responsive percentages
    const angle = (idx / otherPeers.length) * 2 * Math.PI;
    const xPct = (50 + 33 * Math.cos(angle)).toFixed(1);
    const yPct = (50 + 33 * Math.sin(angle)).toFixed(1);

    const node = document.createElement('div');
    node.className = 'radar-peer-node';
    node.style.left = `${xPct}%`;
    node.style.top = `${yPct}%`;
    node.title = `Click to beam file to ${p.name}`;
    node.innerHTML = `<span>${p.isMobile ? '📱' : '💻'}</span><span class="peer-node-label" style="display:block; font-size:8.5px; font-weight:700; color:var(--cyan-primary); max-width:44px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; text-align:center;">${escapeHtml(p.name)}</span>`;

    node.addEventListener('click', () => {
      triggerRadarPeerBeam(p);
    });

    radarPeersContainer.appendChild(node);

    // Discovered peer item in list
    const item = document.createElement('div');
    item.style.cssText = 'padding: 10px 14px; margin-top: 8px; background: var(--badge-bg); border: 1px solid var(--border-color); border-radius: 8px; width: 100%; display: flex; justify-content: space-between; align-items: center; box-sizing: border-box;';
    item.innerHTML = `
      <div style="display: flex; align-items: center; gap: 10px;">
        <span style="font-size: 20px;">${p.isMobile ? '📱' : '💻'}</span>
        <div>
          <b style="color: var(--text-main); font-size: 14px;">${escapeHtml(p.name)}</b>
          <div style="font-size: 11px; color: var(--green-primary); font-weight: 600;">Online on same Wi-Fi</div>
        </div>
      </div>
      <button class="btn-download-file" style="padding: 6px 14px; font-size: 12px; background: rgba(16, 185, 129, 0.15); border: 1px solid rgba(16, 185, 129, 0.35); color: var(--green-primary); cursor: pointer;">⚡ Beam File</button>
    `;
    item.querySelector('button').addEventListener('click', () => {
      triggerRadarPeerBeam(p);
    });
    discoveredList.appendChild(item);
  });
}

function triggerRadarPeerBeam(peer) {
  state.targetPeer = peer;
  showToast(`Selected ${peer.name}. Choose file(s) to send:`);
  const fileInput = document.getElementById('radar-file-input');
  if (fileInput) {
    fileInput.value = '';
    fileInput.click();
  }
}

function initiateRadarTransferRequest(files, targetPeer) {
  if (!files || files.length === 0 || !targetPeer) return;

  const totalBytes = files.reduce((acc, f) => acc + f.size, 0);
  const totalFormatted = formatBytes(totalBytes);
  const fileNameDisplay = files.length === 1 ? files[0].name : `${files[0].name} (+${files.length - 1} more)`;
  const requestId = 'req_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);

  state.pendingOutgoingRequest = {
    requestId,
    targetPeerId: targetPeer.id,
    targetDeviceId: targetPeer.deviceId,
    targetName: targetPeer.name,
    files,
    totalBytes,
    totalFormatted,
    fileNameDisplay
  };

  // Populate & show waiting modal
  document.getElementById('waiting-target-name').textContent = targetPeer.name;
  document.getElementById('waiting-file-name').textContent = fileNameDisplay;
  document.getElementById('waiting-file-size').textContent = totalFormatted;
  showModal('modal-sender-waiting');

  // 60s Timeout Guard: give user plenty of time (60 seconds) to review & accept on the other screen
  clearTimeout(state.outgoingTimeoutId);
  state.outgoingTimeoutId = setTimeout(() => {
    if (state.pendingOutgoingRequest) {
      hideModal('modal-sender-waiting');
      showToast(`⚠️ Transfer request timed out (60s). Please tap to send again.`);
      playChime(false);
      state.pendingOutgoingRequest = null;
    }
  }, 60000);

  // Send request via WebSocket
  state.ws.send(JSON.stringify({
    type: 'RADAR_TRANSFER_REQUEST',
    requestId,
    toPeerId: targetPeer.id,
    toDeviceId: targetPeer.deviceId,
    fileName: fileNameDisplay,
    fileSize: totalBytes,
    fileFormatted: totalFormatted,
    fileCount: files.length
  }));
}

// WebRTC P2P Engine Configuration (100% Zero-Storage End-to-End P2P)
const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' }
  ]
};

const p2p = {
  pc: null,
  dc: null,
  targetPeerId: null,
  isInitiator: false,
  activeTransfer: null
};

function sendRTCSignal(toPeerId, signal) {
  if (state.ws && state.wsConnected) {
    state.ws.send(JSON.stringify({
      type: 'RTC_SIGNAL',
      toPeerId,
      toDeviceId: p2p.targetDeviceId || state.targetPeer?.deviceId,
      signal
    }));
  }
}

async function createP2PConnection(peerId, isInitiator, targetDeviceId = null) {
  // Clean up any prior peer connection
  if (p2p.pc) {
    try { p2p.pc.close(); } catch (e) {}
    p2p.pc = null;
    p2p.dc = null;
  }

  p2p.targetPeerId = peerId;
  p2p.targetDeviceId = targetDeviceId || state.targetPeer?.deviceId;
  p2p.isInitiator = isInitiator;

  const pc = new RTCPeerConnection(RTC_CONFIG);
  p2p.pc = pc;

  pc.onicecandidate = e => {
    if (e.candidate) {
      sendRTCSignal(peerId, { candidate: e.candidate });
    }
  };

  pc.onconnectionstatechange = () => {
    console.log(`📡 P2P Connection State: ${pc.connectionState}`);
    if (pc.connectionState === 'connected') {
      showToast('⚡ Direct P2P tunnel active! (0 MB Server Data)');
    }
  };

  if (isInitiator) {
    // Sender creates DataChannel
    const dc = pc.createDataChannel('antyshareBeam', { ordered: true });
    setupDataChannel(dc, peerId, true);

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      sendRTCSignal(peerId, { sdp: pc.localDescription });
    } catch (err) {
      console.warn('Error creating WebRTC offer:', err);
      showToast('❌ WebRTC error creating connection offer.');
      updateTransferHUD({ visible: false });
      state.pendingOutgoingRequest = null;
    }
  } else {
    // Receiver listens for incoming DataChannel
    pc.ondatachannel = e => {
      setupDataChannel(e.channel, peerId, false);
    };
  }
}

function setupDataChannel(dc, peerId, isInitiator) {
  p2p.dc = dc;
  dc.binaryType = 'arraybuffer';

  let currentFile = null;
  let receivedBytes = 0;
  let expectedTotalBytes = 0;
  let startTime = Date.now();
  let lastLoaded = 0;
  let lastTime = startTime;

  dc.onopen = () => {
    console.log('✅ P2P DataChannel is OPEN and ready for maximum Wi-Fi speed!');
    if (isInitiator && state.pendingOutgoingRequest) {
      // Start streaming file chunks directly to receiver
      sendP2PFileStream(dc, state.pendingOutgoingRequest);
    }
  };

  dc.onmessage = e => {
    if (typeof e.data === 'string') {
      try {
        const meta = JSON.parse(e.data);

        if (meta.type === 'P2P_FILE_START') {
          currentFile = {
            name: meta.name,
            size: meta.size,
            mime: meta.mime,
            chunks: []
          };
          if (!expectedTotalBytes) {
            expectedTotalBytes = meta.totalBytes || meta.size;
            startTime = Date.now();
            lastLoaded = 0;
            lastTime = startTime;
          }

          updateTransferHUD({
            visible: true,
            filename: `⚡ P2P: ${meta.name}`,
            speed: 'Connecting local stream...',
            status: 'Direct Wi-Fi stream (0 MB Server Storage)'
          });
        } else if (meta.type === 'P2P_FILE_END') {
          if (currentFile && currentFile.chunks.length > 0) {
            // 1. EXACT TIMING SYNCHRONIZATION: Instantly snap HUD to 100% complete state!
            updateTransferHUD({
              visible: true,
              percent: 100,
              speed: '✓ 100% Downloaded!',
              bytes: `${formatBytes(currentFile.size)} / ${formatBytes(currentFile.size)} (100%)`,
              status: `Saved ${currentFile.name} to Downloads folder`
            });

            // 2. Reconstruct blob and trigger immediate download with sanitized filename
            const blob = new Blob(currentFile.chunks, { type: currentFile.mime || 'application/octet-stream' });
            const downloadUrl = URL.createObjectURL(blob);
            const safeName = sanitizeFileName(currentFile.name);

            // Active progress bar element for exact right-side trajectory alignment
            const hudEl = document.getElementById('p2p-hud-progress') || 
                          document.getElementById('p2p-transfer-hud') || 
                          document.getElementById('radar-beam-hud') || 
                          document.getElementById('transfer-hud');

            // Single clean native browser download trigger (Arrow 1 directly to Chrome toolbar icon)
            const a = document.createElement('a');
            a.href = downloadUrl;
            a.download = safeName;
            if (hudEl) {
              const r = hudEl.getBoundingClientRect();
              a.style.position = 'fixed';
              a.style.left = `${Math.max(r.right - 25, r.left + 50)}px`;
              a.style.top = `${r.top + r.height / 2}px`;
              a.style.width = '32px';
              a.style.height = '32px';
              a.style.transform = 'translate(-50%, -50%)';
              a.style.opacity = '0.01';
              a.style.pointerEvents = 'none';
              a.style.zIndex = '999999';
            }
            document.body.appendChild(a);
            a.click();
            // Retain anchor in DOM for 2.5s so Chrome's browser process completes geometry query for toolbar flight
            setTimeout(() => a.remove(), 2500);
            setTimeout(() => URL.revokeObjectURL(downloadUrl), 60000);

            showToast(`📥 Saved ${safeName} to Downloads folder!`);
            currentFile = null;
          }
        } else if (meta.type === 'P2P_ALL_DONE') {
          updateTransferHUD({
            visible: true,
            percent: 100,
            speed: '✓ 100% P2P Received!',
            status: 'Saved in your device Downloads (0 MB VPS data used)',
            complete: true
          });
          playChime(true);
          showToast('🎉 All files received directly via P2P!');

          const receiverActions = document.getElementById('p2p-receiver-completed-actions');
          if (receiverActions) receiverActions.style.display = 'block';
          const statusDesc = document.getElementById('p2p-status-desc');
          if (statusDesc) statusDesc.textContent = 'File received! Ready to receive more files from this host, or leave room.';
        }
      } catch (err) {
        console.error('DataChannel text parsing error:', err);
      }
    } else if (e.data instanceof ArrayBuffer) {
      // Binary chunk received!
      if (currentFile) {
        currentFile.chunks.push(e.data);
        receivedBytes += e.data.byteLength;

        const now = Date.now();
        const timeDiff = (now - lastTime) / 1000;
        const percent = expectedTotalBytes > 0 ? ((receivedBytes / expectedTotalBytes) * 100).toFixed(1) : '50.0';

        if (timeDiff >= 0.25 || receivedBytes === expectedTotalBytes) {
          const bytesDiff = receivedBytes - lastLoaded;
          const currentSpeed = bytesDiff / timeDiff;
          updateTransferHUD({
            visible: true,
            percent,
            speed: `⚡ ${(currentSpeed / (1024 * 1024)).toFixed(1)} MB/s (P2P)`,
            bytes: `${formatBytes(receivedBytes)} / ${formatBytes(expectedTotalBytes)} (${percent}%)`
          });
          lastLoaded = receivedBytes;
          lastTime = now;
        }
      }
    }
  };

  dc.onclose = () => {
    console.log('DataChannel closed');
  };

  dc.onerror = err => {
    console.warn('DataChannel error:', err);
  };
}

async function sendP2PFileStream(dc, req) {
  const { files, targetName, totalBytes } = req;

  updateTransferHUD({
    visible: true,
    filename: req.fileNameDisplay,
    percent: 0,
    speed: '⚡ Direct P2P Streaming...',
    status: `Streaming directly to ${targetName} (0 MB VPS Storage)`
  });

  const startTime = Date.now();
  let totalLoaded = 0;
  let lastLoaded = 0;
  let lastTime = startTime;
  const CHUNK_SIZE = 64 * 1024; // 64 KB chunks

  for (let i = 0; i < files.length; i++) {
    const file = files[i];

    // Send file metadata header
    dc.send(JSON.stringify({
      type: 'P2P_FILE_START',
      name: file.name,
      size: file.size,
      mime: file.type || 'application/octet-stream',
      totalBytes
    }));

    let offset = 0;
    while (offset < file.size) {
      // Flow Control (Backpressure): pause reading if buffer exceeds 8 MB
      if (dc.bufferedAmount > 8 * 1024 * 1024) {
        dc.bufferedAmountLowThreshold = 2 * 1024 * 1024;
        await new Promise(resolve => {
          dc.onbufferedamountlow = () => {
            dc.onbufferedamountlow = null;
            resolve();
          };
        });
      }

      const slice = file.slice(offset, offset + CHUNK_SIZE);
      const buffer = await slice.arrayBuffer();
      dc.send(buffer);
      offset += buffer.byteLength;
      totalLoaded += buffer.byteLength;

      // Real-time speed telemetry
      const now = Date.now();
      const timeDiff = (now - lastTime) / 1000;
      if (timeDiff >= 0.25 || totalLoaded === totalBytes) {
        const percent = ((totalLoaded / totalBytes) * 100).toFixed(1);
        const bytesDiff = totalLoaded - lastLoaded;
        const currentSpeed = bytesDiff / timeDiff;
        const currentSpeedFormatted = `${(currentSpeed / (1024 * 1024)).toFixed(1)} MB/s`;

        updateTransferHUD({
          visible: true,
          percent,
          speed: `⚡ ${currentSpeedFormatted} (P2P)`,
          bytes: `${formatBytes(totalLoaded)} / ${formatBytes(totalBytes)} (${percent}%)`
        });

        lastLoaded = totalLoaded;
        lastTime = now;
      }
    }

    // Send file end
    dc.send(JSON.stringify({ type: 'P2P_FILE_END', name: file.name }));
  }

  // All files finished
  dc.send(JSON.stringify({ type: 'P2P_ALL_DONE' }));

  updateTransferHUD({
    visible: true,
    percent: 100,
    speed: '✓ 100% Beamed via P2P!',
    status: `Completed in ${((Date.now() - startTime) / 1000).toFixed(1)}s (0 MB VPS storage used)`,
    complete: true
  });

  showToast(`🎉 Beamed directly to ${targetName} via P2P!`);
  playChime(true);

  // Clear queued files so it NEVER automatically re-triggers!
  state.p2pFilesToSend = null;
  state.p2pFileToSend = null;
  state.p2pTransferInProgress = false;
  onP2PSenderTransferComplete();

  setTimeout(() => {
    state.pendingOutgoingRequest = null;
  }, 4000);
}

function showModal(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = 'flex';
}

function hideModal(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = 'none';
}

function playChime(isPositive = true) {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    if (isPositive) {
      osc.frequency.setValueAtTime(587.33, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15);
    } else {
      osc.frequency.setValueAtTime(440, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(220, ctx.currentTime + 0.15);
    }
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
  } catch (e) {}
}

// ============================================================
// 5. WEBSOCKET SIGNALLING & TELEMETRY
// ============================================================
function initWebSocket() {
  let wsHost = window.location.host;
  let protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  if (!wsHost || window.location.protocol === 'file:') {
    wsHost = 'antyshare.in';
    protocol = 'wss:';
  }
  const wsUrl = `${protocol}//${wsHost}`;

  try {
    state.ws = new WebSocket(wsUrl);

    state.ws.onopen = () => {
      state.wsConnected = true;
      document.getElementById('server-status')?.classList.add('online');
      pingRadar();
      loadServerInfo();
      loadMode3OfflineQR();
    };

    state.ws.onmessage = async e => {
      try {
        const msg = JSON.parse(e.data);

        if (msg.type === 'SERVER_INIT') {
          state.myPeerId = msg.peerId;
          state.ws.id = msg.peerId;
          console.log('✅ Server synchronized. Socket Peer ID:', msg.peerId);
          loadServerInfo();
          loadMode3OfflineQR();

          // Announce pairing to target peer if paired via QR scan or URL parameter
          if (state.targetPeer && (state.targetPeer.id || state.targetPeer.deviceId)) {
            state.ws.send(JSON.stringify({
              type: 'PAIR_ANNOUNCE',
              toPeerId: state.targetPeer.id,
              toDeviceId: state.targetPeer.deviceId,
              fromPeerId: state.myPeerId,
              fromDeviceId: state.deviceId,
              fromPeerName: state.deviceName,
              fromIsMobile: state.isMobile
            }));
          }
        } else if (msg.type === 'PAIR_ACKNOWLEDGED') {
          const pairKey = msg.targetDeviceId || msg.targetPeerId;
          const isFreshPair = (state.lastChimedPairKey !== pairKey);
          state.lastChimedPairKey = pairKey;
          state.targetPeer = {
            id: msg.targetPeerId,
            deviceId: msg.targetDeviceId,
            name: msg.targetPeerName
          };
          updateOfflinePairStatus(state.targetPeer);
          if (isFreshPair) {
            playChime(true);
            try { navigator.vibrate?.([150, 80, 150]); } catch (e) {}
            showToast(`✓ Paired with ${msg.targetPeerName}! Drop file to Beam Live.`);
          }
        } else if (msg.type === 'PAIR_ANNOUNCE') {
          const pairKey = msg.fromDeviceId || msg.fromPeerId;
          const isFreshPair = (state.lastChimedPairKey !== pairKey);
          state.lastChimedPairKey = pairKey;
          state.targetPeer = {
            id: msg.fromPeerId,
            deviceId: msg.fromDeviceId,
            name: msg.fromPeerName,
            isMobile: msg.fromIsMobile
          };
          updateOfflinePairStatus(state.targetPeer);
          if (isFreshPair) {
            playChime(true);
            try { navigator.vibrate?.([200, 100, 200]); } catch (e) {}
            showToast(`📱 ${msg.fromPeerName} paired with you! Ready for live stream.`);
          }
        } else if (msg.type === 'PAIR_ERROR') {
          showToast(`⚠️ ${msg.error}`);
        } else if (msg.type === 'NEW_FILES') {
          showToast(`📥 New file received in vault!`);
          loadFilesList();
        } else if (msg.type === 'RADAR_PEERS') {
          renderRadarPeers(msg.peers || [], msg.networkIp);
        } else if (msg.type === 'RADAR_TRANSFER_REQUEST') {
          // Incoming transfer request from nearby peer
          state.pendingIncomingRequest = msg;
          document.getElementById('incoming-sender-name').textContent = msg.fromPeerName;
          document.getElementById('incoming-file-name').textContent = msg.fileName;
          document.getElementById('incoming-file-size').textContent = msg.fileFormatted;

          // Executable & Script file security warning check
          const dangerousExts = ['.exe', '.bat', '.cmd', '.msi', '.vbs', '.scr', '.ps1', '.sh', '.com', '.jar', '.apk', '.bin'];
          const fileNameLower = (msg.fileName || '').toLowerCase();
          const isDangerous = dangerousExts.some(ext => fileNameLower.endsWith(ext));
          const warnBox = document.getElementById('incoming-file-warning');
          if (warnBox) {
            warnBox.style.display = isDangerous ? 'block' : 'none';
          }

          playChime(true);
          showModal('modal-incoming-request');
        } else if (msg.type === 'RADAR_TRANSFER_RESPONSE') {
          // Receiver responded
          clearTimeout(state.outgoingTimeoutId);
          if (msg.accepted) {
            hideModal('modal-sender-waiting');
            showToast(`✅ ${msg.fromPeerName} accepted! Establishing direct P2P tunnel...`);
            playChime(true);

            // Update Mode 2 waiting status on Sender laptop
            const waitStatus = document.getElementById('mode2-sender-waiting-status');
            if (waitStatus) {
              waitStatus.innerHTML = '<span style="color: #10b981; font-weight: 700; font-size: 13px;">🟢 Receiver Accepted! Streaming direct memory-to-memory...</span>';
            }
            const statusText = document.getElementById('offline-pair-status-text');
            if (statusText) {
              statusText.innerHTML = `🟢 <b>Connected to ${escapeHtml(msg.fromPeerName)}:</b> Streaming Live (0 MB Server Data)`;
              statusText.style.color = '#10b981';
            }

            if (state.pendingOutgoingRequest) {
              // 100% Zero-Storage Architecture: Pure WebRTC P2P Direct Stream
              createP2PConnection(msg.fromPeerId, true, msg.fromDeviceId);

              // P2P Connection timeout guard
              setTimeout(() => {
                if (p2p.dc?.readyState !== 'open' && state.pendingOutgoingRequest) {
                  console.warn('⚡ P2P direct connection timeout');
                  showToast('⚠️ Direct P2P tunnel timed out. Ensure both devices are on the same Wi-Fi or Hotspot.');
                  updateTransferHUD({
                    visible: true,
                    status: '⚠️ P2P timeout. Please ensure both devices are online.',
                    complete: false
                  });
                  state.pendingOutgoingRequest = null;
                  state.p2pTransferInProgress = false;
                }
              }, 12000);
            }
          } else {
            hideModal('modal-sender-waiting');
            showToast(`❌ ${msg.fromPeerName} declined the transfer.`);
            playChime(false);
            const waitStatus = document.getElementById('mode2-sender-waiting-status');
            if (waitStatus) {
              waitStatus.innerHTML = '<span style="color: #ef4444; font-weight: 700; font-size: 13px;">❌ Receiver declined the transfer request.</span>';
            }
            state.pendingOutgoingRequest = null;
          }
        } else if (msg.type === 'RTC_SIGNAL') {
          // WebRTC Peer Signaling (Offer, Answer, ICE Candidates)
          if (p2p.pc) {
            const { signal } = msg;
            if (signal.sdp) {
              if (signal.sdp.type === 'offer') {
                await p2p.pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
                const answer = await p2p.pc.createAnswer();
                await p2p.pc.setLocalDescription(answer);
                sendRTCSignal(msg.fromPeerId, { sdp: p2p.pc.localDescription });
              } else if (signal.sdp.type === 'answer') {
                await p2p.pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
              }
            } else if (signal.candidate) {
              try {
                await p2p.pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
              } catch (err) {
                console.warn('ICE candidate error:', err);
              }
            }
          }
        } else if (msg.type === 'RADAR_TRANSFER_CANCEL') {
          hideModal('modal-incoming-request');
          state.pendingIncomingRequest = null;
          showToast('Sender cancelled the transfer request.');
        } else if (msg.type === 'RADAR_TRANSFER_PROGRESS') {
          // Receiver gets live streaming progress
          updateTransferHUD({
            visible: true,
            percent: msg.percent,
            speed: msg.speed,
            bytes: `${formatBytes(msg.loaded)} / ${formatBytes(msg.total)} (${msg.percent}%)`
          });
        } else if (msg.type === 'RADAR_TRANSFER_ERROR') {
          clearTimeout(state.outgoingTimeoutId);
          hideModal('modal-sender-waiting');
          showToast(`⚠️ ${msg.error}`);
          playChime(false);
          state.pendingOutgoingRequest = null;
        } else if (msg.type === 'ROOM_JOINED') {
          console.log(`P2P Room registered: ${msg.roomCode}, peers: ${msg.peersCount}`);
          if (msg.peersCount === 1) {
            const statusDesc = document.getElementById('p2p-status-desc');
            if (statusDesc && state.activeMode === 'mode-global') {
              statusDesc.textContent = `Room ${msg.roomCode} joined. Waiting for host to beam files...`;
            }
          }
        } else if (msg.type === 'ROOM_FULL') {
          showToast(`❌ Room ${msg.roomCode || ''} is full (1-to-1 only).`);
          playChime(false);
          const statusDesc = document.getElementById('p2p-status-desc');
          if (statusDesc) statusDesc.textContent = msg.error;
          const inputCode = document.getElementById('input-p2p-code');
          if (inputCode) inputCode.value = '';
        } else if (msg.type === 'ROOM_RATE_LIMITED') {
          showToast(`⏳ ${msg.error}`);
          playChime(false);
        } else if (msg.type === 'PEER_CONNECTED') {
          playChime(true);
          showToast(`🤝 Peer connected: ${msg.peerName}!`);

          state.p2pTargetPeer = { id: msg.peerId, name: msg.peerName };

          const waitingInd = document.getElementById('p2p-waiting-indicator');
          if (waitingInd) {
            waitingInd.textContent = `🟢 Connected with ${escapeHtml(msg.peerName)}!`;
            waitingInd.style.color = '#10b981';
          }

          const statusTitle = document.getElementById('p2p-status-title');
          const statusDesc = document.getElementById('p2p-status-desc');
          if (statusTitle) statusTitle.textContent = `Connected with ${escapeHtml(msg.peerName)}`;
          if (statusDesc) statusDesc.textContent = 'Direct P2P pipe ready. Waiting for stream handshake...';

          // If sender has files explicitly queued to send in P2P room AND transfer is not already in progress:
          if (state.p2pFilesToSend && state.p2pFilesToSend.length > 0 && !state.p2pTransferInProgress) {
            console.log('⚡ Peer joined! Initiating P2P transfer request...');
            state.p2pTransferInProgress = true;
            initiateRadarTransferRequest(state.p2pFilesToSend, state.p2pTargetPeer);
          }
        } else if (msg.type === 'PEER_DISCONNECTED') {
          if (state.p2pTargetPeer && state.p2pTargetPeer.id === msg.peerId) {
            state.p2pTargetPeer = null;
            showToast('Peer left the P2P room.');
            const waitingInd = document.getElementById('p2p-waiting-indicator');
            if (waitingInd) {
              waitingInd.textContent = '⏳ Waiting for recipient to join...';
              waitingInd.style.color = '';
            }
            const statusTitle = document.getElementById('p2p-status-title');
            const statusDesc = document.getElementById('p2p-status-desc');
            if (statusTitle) statusTitle.textContent = 'Direct P2P Encrypted Tunnel';
            if (statusDesc) statusDesc.textContent = 'Peer disconnected. Waiting for connection...';
          }
        }
      } catch (err) {
        console.warn('WS message error:', err);
      }
    };

    state.ws.onclose = () => {
      state.wsConnected = false;
      const statusInd = document.getElementById('server-status');
      if (statusInd) {
        statusInd.className = 'status-indicator offline';
        const label = statusInd.querySelector('.status-label');
        if (label) label.textContent = 'Offline';
      }
      updateOfflinePairStatus(state.targetPeer);
      clearTimeout(window._wsReconnectTimer);
      window._wsReconnectTimer = setTimeout(initWebSocket, 4000); // Debounced reconnect
    };
  } catch (e) {
    console.warn('WS init failed:', e);
  }
}

// ============================================================
// 6. UTILITY HELPERS
// ============================================================
function formatBytes(bytes, decimals = 1) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

function formatTime(seconds) {
  if (seconds <= 0 || !isFinite(seconds)) return '0s';
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}m ${secs}s`;
}

function showToast(text) {
  const toast = document.getElementById('toast-notification');
  if (!toast) return;
  toast.innerHTML = `<span>⚡</span> <span>${escapeHtml(text)}</span>`;
  toast.classList.add('show');
  clearTimeout(window._toastTimeout);
  window._toastTimeout = setTimeout(() => {
    toast.classList.remove('show');
  }, 3500);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function sanitizeFileName(name) {
  if (!name) return `file_${Date.now()}`;
  return String(name)
    .replace(/[/\\]/g, '_')
    .replace(/[\x00-\x1f\x80-\x9f]/g, '')
    .trim()
    .slice(0, 150) || `file_${Date.now()}`;
}

/**
 * Single Native Download Trajectory
 * Clean no-op to eliminate any duplicate in-page circle/orb.
 */
function triggerRightDownloadEffect() {
  // Browser native download engine handles the single trajectory to the toolbar icon.
}
window.triggerRightDownloadEffect = triggerRightDownloadEffect;
window.triggerFlyToDownloadAnimation = triggerRightDownloadEffect;



