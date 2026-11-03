let Client;
try {
  Client = require('ssh2').Client;
} catch (e) {
  try {
    Client = require(path.join(os.homedir(), '.gemini/antigravity/scratch/node_modules/ssh2')).Client;
  } catch (e2) {
    console.error('ssh2 package required for deployment: npm install ssh2');
    process.exit(1);
  }
}
const fs = require('fs');
const path = require('path');
const os = require('os');

// Load secrets from external user vault (outside all project directories)
function parseEnv(filePath) {
  if (fs.existsSync(filePath)) {
    const envContent = fs.readFileSync(filePath, 'utf8');
    for (const line of envContent.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const idx = trimmed.indexOf('=');
        if (idx !== -1) {
          const key = trimmed.slice(0, idx).trim();
          const val = trimmed.slice(idx + 1).trim();
          if (!process.env[key]) process.env[key] = val;
        }
      }
    }
  }
}

// Dedicated external safe location
const vaultEnvPath = path.join(os.homedir(), '.vps_vault', 'vps.env');
parseEnv(vaultEnvPath);

const host = process.env.SSH_HOST || process.env.VPS_HOST;
const username = process.env.SSH_USER || process.env.VPS_USER || 'root';
const password = process.env.SSH_PASS || process.env.VPS_PASS;

if (!host) {
  console.error('❌ Error: VPS host IP not found in external vault (~/.vps_vault/vps.env) or environment variables (SSH_HOST).');
  process.exit(1);
}

if (!password) {
  console.error('❌ Error: VPS password not found in external vault (~/.vps_vault/vps.env) or environment variables (SSH_PASS).');
  process.exit(1);
}

const localBase = path.join(__dirname);
const relFiles = [
  'package.json',
  'server.js',
  'start.bat',
  'public/index.html',
  'public/AntyShare-Offline.html',
  'public/qrcode.min.js',
  'public/jsQR.js',
  'public/style.css',
  'public/app.js',
  'public/sw.js',
  'public/manifest.json',
  'public/icon-512.svg',
  'public/privacy.html',
  'public/terms.html',
  'public/about.html',
  'public/contact.html',
  'public/disclaimer.html',
  'public/antyshare.apk'
];

const bundle = {};
for (const rel of relFiles) {
  const full = path.join(localBase, rel);
  if (fs.existsSync(full)) {
    bundle[rel] = fs.readFileSync(full).toString('base64');
  }
}

const bundleJson = JSON.stringify(bundle);
console.log(`📦 Prepared bundle of ${Object.keys(bundle).length} files (${Math.round(bundleJson.length / 1024)} KB base64).`);

const remoteScript = `
node -e '
const fs = require("fs");
const path = require("path");

let data = "";
process.stdin.on("data", chunk => data += chunk);
process.stdin.on("end", () => {
  const bundle = JSON.parse(data);
  const baseDir = "/home/antyshare/htdocs/antyshare.in";
  for (const [rel, b64] of Object.entries(bundle)) {
    const target = path.join(baseDir, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, Buffer.from(b64, "base64"));
    console.log("Wrote " + rel);
  }
  const uploadsDir = path.join(baseDir, "uploads");
  if (fs.existsSync(uploadsDir)) {
    fs.rmSync(uploadsDir, { recursive: true, force: true });
    console.log("Deleted uploads directory - 100% Zero-Storage Enforced");
  }
  const batFile = path.join(baseDir, "public", "AntyShare_Windows_Setup.bat");
  if (fs.existsSync(batFile)) {
    fs.unlinkSync(batFile);
    console.log("Removed legacy AntyShare_Windows_Setup.bat");
  }
  console.log("ALL_FILES_WRITTEN");
});
'
`;

const conn = new Client();
conn.on('ready', () => {
  console.log('✅ SSH connected to Contabo VPS. Transferring AntyShare files...');
  conn.exec(remoteScript, (err, stream) => {
    if (err) throw err;
    stream.on('data', d => process.stdout.write(d));
    stream.stderr.on('data', d => process.stderr.write(d));
    stream.on('close', (code) => {
      console.log('File write complete, code:', code);

      // Now run npm install, permissions fix, and PM2 start
      const restartCmd = `
        set -e
        cd /home/antyshare/htdocs/antyshare.in
        echo "Installing production dependencies..."
        npm install --production
        chown -R antyshare:antyshare /home/antyshare/htdocs/antyshare.in
        
        # Check if pm2 process already exists
        if pm2 describe antyshare > /dev/null 2>&1; then
          echo "Restarting PM2 process antyshare..."
          pm2 restart antyshare --update-env
        else
          echo "Starting new PM2 process antyshare on port 8000..."
          PORT=8000 pm2 start server.js --name antyshare
        fi
        
        pm2 save
        sleep 2
        pm2 status
        
        echo "\n--- Local Health Check on Port 8000 ---"
        curl -I http://127.0.0.1:8000/api/info || true
        echo "\n🚀 ANTYSHARE_DEPLOY_SUCCESS"
      `;

      conn.exec(restartCmd, (err2, stream2) => {
        if (err2) throw err2;
        stream2.on('data', d => process.stdout.write(d));
        stream2.stderr.on('data', d => process.stderr.write(d));
        stream2.on('close', (code2) => {
          console.log('\nDeployment finished with code:', code2);
          conn.end();
        });
      });
    });

    // Send payload in chunks with backpressure handling
    let offset = 0;
    const chunkSize = 64 * 1024;
    function writeChunk() {
      let canWrite = true;
      while (offset < bundleJson.length && canWrite) {
        const chunk = bundleJson.slice(offset, offset + chunkSize);
        offset += chunkSize;
        canWrite = stream.write(chunk);
      }
      if (offset >= bundleJson.length) {
        stream.end();
      } else {
        stream.once('drain', writeChunk);
      }
    }
    writeChunk();
  });
}).on('error', (err) => {
  console.error('SSH Error:', err);
}).connect({
  host,
  port: 22,
  username,
  password,
  readyTimeout: 30000,
  algorithms: {
    serverHostKey: [
      'ssh-ed25519',
      'ecdsa-sha2-nistp256',
      'ecdsa-sha2-nistp384',
      'ecdsa-sha2-nistp521',
      'rsa-sha2-512',
      'rsa-sha2-256',
      'ssh-rsa'
    ]
  }
});
