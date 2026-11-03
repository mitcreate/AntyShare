package com.antyshare.app.server;

import android.os.Environment;
import android.util.Log;

import com.antyshare.app.util.NetworkUtils;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.io.PrintWriter;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import android.content.ContentResolver;
import android.net.Uri;
import android.provider.MediaStore;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Set;
import java.util.concurrent.Executors;

public class EmbeddedHttpServer {
    private static final String TAG = "AntyShareHttpServer";
    public static final int PORT = 8080;

    public static class SharedItem {
        public final String name;
        public final long size;
        public final Uri uri;

        public SharedItem(String name, long size, Uri uri) {
            this.name = name;
            this.size = size;
            this.uri = uri;
        }
    }

    private ServerSocket serverSocket;
    private ExecutorService threadPool;
    private boolean isRunning = false;
    private final File storageDir;
    private final File deletedCacheFile;
    private final Set<String> deletedFiles = Collections.synchronizedSet(new HashSet<>());
    private ServerEventListener listener;
    private ContentResolver contentResolver;
    private final List<SharedItem> sharedItems = Collections.synchronizedList(new ArrayList<>());
    private final Set<String> approvedFiles = Collections.synchronizedSet(new HashSet<>());

    public interface ServerEventListener {
        void onClientConnected(String clientIp);
        void onFileReceived(String fileName, long sizeBytes);
        void onError(String message);
        boolean onRequestTransfer(String clientIp, String fileName, long sizeBytes);
    }

    public EmbeddedHttpServer() {
        File downloads = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
        this.storageDir = new File(downloads, "AntyShare");
        if (!storageDir.exists()) {
            storageDir.mkdirs();
        }
        this.deletedCacheFile = new File(storageDir, ".deleted_files");
        loadDeletedCache();
    }

    public void setContentResolver(ContentResolver resolver) {
        this.contentResolver = resolver;
    }

    public void setSharedItems(List<SharedItem> items, ContentResolver resolver) {
        this.contentResolver = resolver;
        this.sharedItems.clear();
        if (items != null) {
            this.sharedItems.addAll(items);
        }
    }

    private void loadDeletedCache() {
        if (deletedCacheFile != null && deletedCacheFile.exists()) {
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(new FileInputStream(deletedCacheFile), StandardCharsets.UTF_8))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    line = line.trim();
                    if (!line.isEmpty()) {
                        deletedFiles.add(line);
                    }
                }
            } catch (Exception e) {
                Log.w(TAG, "Failed to load deleted cache: " + e.getMessage());
            }
        }
    }

    private synchronized void saveDeletedCache() {
        if (deletedCacheFile == null) return;
        try {
            if (!storageDir.exists()) {
                storageDir.mkdirs();
            }
            try (PrintWriter writer = new PrintWriter(new FileOutputStream(deletedCacheFile, false))) {
                synchronized (deletedFiles) {
                    for (String name : deletedFiles) {
                        writer.println(name);
                    }
                }
                writer.flush();
            }
        } catch (Exception e) {
            Log.w(TAG, "Failed to save deleted cache: " + e.getMessage());
        }
    }

    private boolean tryDeletePhysicalFile(File file) {
        if (file == null || !file.exists()) return true;

        try {
            if (file.delete()) return true;
        } catch (Exception ignored) {}

        try (FileOutputStream fos = new FileOutputStream(file, false)) {
            fos.write(new byte[0]);
            fos.flush();
        } catch (Exception ignored) {}

        try {
            if (file.delete()) return true;
        } catch (Exception ignored) {}

        if (contentResolver != null) {
            try {
                Uri contentUri = MediaStore.Files.getContentUri("external");
                int rows = contentResolver.delete(contentUri,
                        MediaStore.MediaColumns.DATA + "=?",
                        new String[]{file.getAbsolutePath()});
                if (rows > 0 || !file.exists()) return true;
            } catch (Exception ignored) {}

            try {
                Uri imageUri = MediaStore.Images.Media.EXTERNAL_CONTENT_URI;
                int rows = contentResolver.delete(imageUri,
                        MediaStore.MediaColumns.DATA + "=?",
                        new String[]{file.getAbsolutePath()});
                if (rows > 0 || !file.exists()) return true;
            } catch (Exception ignored) {}

            try {
                if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.Q) {
                    Uri dlUri = MediaStore.Downloads.EXTERNAL_CONTENT_URI;
                    int rows = contentResolver.delete(dlUri,
                            MediaStore.MediaColumns.DATA + "=?",
                            new String[]{file.getAbsolutePath()});
                    if (rows > 0 || !file.exists()) return true;
                }
            } catch (Exception ignored) {}
        }

        try {
            Process p = Runtime.getRuntime().exec(new String[]{"rm", "-f", file.getAbsolutePath()});
            p.waitFor(300, java.util.concurrent.TimeUnit.MILLISECONDS);
            if (!file.exists()) return true;
        } catch (Exception ignored) {}

        try {
            file.deleteOnExit();
        } catch (Exception ignored) {}

        return !file.exists();
    }

    public boolean deleteFileByName(String fileName) {
        synchronized (sharedItems) {
            Iterator<SharedItem> it = sharedItems.iterator();
            while (it.hasNext()) {
                if (it.next().name.equals(fileName)) {
                    it.remove();
                }
            }
        }
        File target = new File(storageDir, fileName);
        if (target.exists() && target.isFile()) {
            tryDeletePhysicalFile(target);
        }
        deletedFiles.add(fileName);
        saveDeletedCache();
        return true;
    }

    public void clearAllStorageFiles() {
        synchronized (sharedItems) {
            sharedItems.clear();
        }
        File[] files = storageDir.exists() ? storageDir.listFiles(File::isFile) : null;
        if (files != null) {
            for (File f : files) {
                if (f.getName().startsWith(".")) continue;
                tryDeletePhysicalFile(f);
                deletedFiles.add(f.getName());
            }
        }
        saveDeletedCache();
    }

    public void setListener(ServerEventListener listener) {
        this.listener = listener;
    }

    public synchronized void start() {
        if (isRunning) return;
        isRunning = true;
        if (threadPool == null || threadPool.isShutdown()) {
            threadPool = Executors.newCachedThreadPool();
        }

        threadPool.execute(() -> {
            try {
                serverSocket = new ServerSocket(PORT);
                Log.d(TAG, "Embedded HTTP Server successfully bound on port " + PORT);
                while (isRunning && serverSocket != null && !serverSocket.isClosed()) {
                    try {
                        Socket socket = serverSocket.accept();
                        if (listener != null) {
                            listener.onClientConnected(socket.getInetAddress().getHostAddress());
                        }
                        threadPool.execute(() -> handleConnection(socket));
                    } catch (IOException e) {
                        if (!isRunning) break;
                        Log.e(TAG, "Accept error: " + e.getMessage());
                    }
                }
            } catch (IOException e) {
                Log.e(TAG, "ServerSocket bind error on port " + PORT + ": " + e.getMessage());
                if (listener != null) {
                    listener.onError("Port bind error: " + e.getMessage());
                }
            }
        });
    }

    public synchronized void stop() {
        isRunning = false;
        try {
            if (serverSocket != null) serverSocket.close();
        } catch (IOException ignored) {}
        if (threadPool != null) {
            threadPool.shutdownNow();
        }
    }

    public boolean isRunning() {
        return isRunning;
    }

    private void handleConnection(Socket socket) {
        try (
            InputStream in = new BufferedInputStream(socket.getInputStream());
            OutputStream out = new BufferedOutputStream(socket.getOutputStream())
        ) {
            BufferedReader reader = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8));
            String requestLine = reader.readLine();
            if (requestLine == null || requestLine.isEmpty()) return;

            String[] parts = requestLine.split(" ");
            if (parts.length < 2) return;
            String method = parts[0];
            String uri = parts[1];

            // Read Headers
            long contentLength = -1;
            String contentType = "";
            String line;
            while ((line = reader.readLine()) != null && !line.isEmpty()) {
                String lower = line.toLowerCase();
                if (lower.startsWith("content-length:")) {
                    contentLength = Long.parseLong(line.substring(15).trim());
                } else if (lower.startsWith("content-type:")) {
                    contentType = line.substring(13).trim();
                }
            }

            if (method.equalsIgnoreCase("GET")) {
                handleGet(socket, uri, out);
            } else if (method.equalsIgnoreCase("POST") && uri.startsWith("/upload")) {
                handleUpload(socket, uri, in, out, contentLength, contentType);
            } else if (method.equalsIgnoreCase("POST") && uri.startsWith("/api/delete")) {
                handleDelete(uri, out);
            } else if (method.equalsIgnoreCase("POST") && uri.startsWith("/api/clear-all")) {
                handleClearAll(out);
            } else {
                sendResponse(out, 404, "text/plain", "Not Found".getBytes(StandardCharsets.UTF_8));
            }
        } catch (Exception e) {
            Log.w(TAG, "Connection handler error: " + e.getMessage());
        } finally {
            try { socket.close(); } catch (IOException ignored) {}
        }
    }

    private void handleGet(Socket socket, String uri, OutputStream out) throws IOException {
        if (uri.equals("/") || uri.equals("/index.html")) {
            byte[] html = getWebPortalHtml().getBytes(StandardCharsets.UTF_8);
            sendResponse(out, 200, "text/html; charset=utf-8", html);
        } else if (uri.equals("/api/status")) {
            long freeBytes = storageDir.getFreeSpace();
            String json = String.format("{\"status\":\"online\",\"device\":\"%s\",\"freeSpace\":\"%s\",\"files\":%d}",
                    NetworkUtils.getDeviceModel(), NetworkUtils.formatBytes(freeBytes), getFileList().length);
            sendResponse(out, 200, "application/json", json.getBytes(StandardCharsets.UTF_8));
        } else if (uri.startsWith("/api/delete")) {
            handleDelete(uri, out);
        } else if (uri.startsWith("/api/clear-all")) {
            handleClearAll(out);
        } else if (uri.startsWith("/api/request-transfer")) {
            String clientIp = socket.getInetAddress() != null ? socket.getInetAddress().getHostAddress() : "Laptop";
            String fileName = "file";
            long sizeBytes = 0;

            int nameIdx = uri.indexOf("name=");
            if (nameIdx != -1) {
                int end = uri.indexOf('&', nameIdx);
                String raw = end != -1 ? uri.substring(nameIdx + 5, end) : uri.substring(nameIdx + 5);
                try {
                    fileName = URLDecoder.decode(raw, "UTF-8");
                } catch (Exception ignored) {}
            }

            int sizeIdx = uri.indexOf("size=");
            if (sizeIdx != -1) {
                int end = uri.indexOf('&', sizeIdx);
                String raw = end != -1 ? uri.substring(sizeIdx + 5, end) : uri.substring(sizeIdx + 5);
                try {
                    sizeBytes = Long.parseLong(raw);
                } catch (Exception ignored) {}
            }

            boolean accepted = false;
            if (listener != null) {
                accepted = listener.onRequestTransfer(clientIp, fileName, sizeBytes);
            } else {
                accepted = true;
            }

            if (accepted) {
                approvedFiles.add(fileName);
                String json = "{\"status\":\"accepted\"}";
                sendResponse(out, 200, "application/json", json.getBytes(StandardCharsets.UTF_8));
            } else {
                String json = "{\"status\":\"rejected\"}";
                sendResponse(out, 403, "application/json", json.getBytes(StandardCharsets.UTF_8));
            }
        } else if (uri.equals("/api/files")) {
            StringBuilder sb = new StringBuilder("{\"sessionFiles\":[");
            boolean first = true;
            synchronized (sharedItems) {
                for (SharedItem item : sharedItems) {
                    if (deletedFiles.contains(item.name)) continue;
                    if (!first) sb.append(",");
                    first = false;
                    sb.append(String.format("{\"name\":\"%s\",\"size\":%d,\"sizeFormatted\":\"%s\"}",
                            item.name.replace("\"", "\\\""), item.size, NetworkUtils.formatBytes(item.size)));
                }
            }
            sb.append("],\"storageFiles\":[");
            first = true;
            File[] files = getFileList();
            for (File f : files) {
                if (!first) sb.append(",");
                first = false;
                sb.append(String.format("{\"name\":\"%s\",\"size\":%d,\"sizeFormatted\":\"%s\"}",
                        f.getName().replace("\"", "\\\""), f.length(), NetworkUtils.formatBytes(f.length())));
            }
            sb.append("]}");
            sendResponse(out, 200, "application/json", sb.toString().getBytes(StandardCharsets.UTF_8));
        } else if (uri.startsWith("/download")) {
            String fileName = "";
            int idx = uri.indexOf("file=");
            if (idx != -1) {
                fileName = URLDecoder.decode(uri.substring(idx + 5), "UTF-8");
            }
            SharedItem matchedItem = null;
            synchronized (sharedItems) {
                for (SharedItem it : sharedItems) {
                    if (it.name.equals(fileName)) {
                        matchedItem = it;
                        break;
                    }
                }
            }
            if (matchedItem != null && contentResolver != null) {
                sendUriDownload(out, matchedItem);
            } else {
                File target = new File(storageDir, fileName);
                if (target.exists() && target.isFile() && target.getParentFile().equals(storageDir)) {
                    sendFileDownload(out, target);
                } else {
                    sendResponse(out, 404, "text/plain", "File Not Found".getBytes(StandardCharsets.UTF_8));
                }
            }
        } else {
            sendResponse(out, 404, "text/plain", "404 Not Found".getBytes(StandardCharsets.UTF_8));
        }
    }

    private void sendFileDownload(OutputStream out, File file) throws IOException {
        String header = "HTTP/1.1 200 OK\r\n" +
                "Content-Type: application/octet-stream\r\n" +
                "Content-Length: " + file.length() + "\r\n" +
                "Content-Disposition: attachment; filename=\"" + file.getName() + "\"\r\n" +
                "Connection: close\r\n\r\n";
        out.write(header.getBytes(StandardCharsets.UTF_8));

        try (FileInputStream fis = new FileInputStream(file)) {
            byte[] buffer = new byte[64 * 1024];
            int read;
            while ((read = fis.read(buffer)) != -1) {
                out.write(buffer, 0, read);
            }
            out.flush();
        }
    }

    private void sendUriDownload(OutputStream out, SharedItem item) throws IOException {
        String header = "HTTP/1.1 200 OK\r\n" +
                "Content-Type: application/octet-stream\r\n" +
                "Content-Length: " + item.size + "\r\n" +
                "Content-Disposition: attachment; filename=\"" + item.name + "\"\r\n" +
                "Connection: close\r\n\r\n";
        out.write(header.getBytes(StandardCharsets.UTF_8));

        try (InputStream is = contentResolver.openInputStream(item.uri)) {
            if (is != null) {
                byte[] buffer = new byte[64 * 1024];
                int read;
                while ((read = is.read(buffer)) != -1) {
                    out.write(buffer, 0, read);
                }
                out.flush();
            }
        }
    }

    private void handleUpload(Socket socket, String uri, InputStream in, OutputStream out, long contentLength, String contentType) throws IOException {
        String clientIp = socket.getInetAddress() != null ? socket.getInetAddress().getHostAddress() : "Laptop";
        String requestedName = null;
        int nameIdx = uri.indexOf("name=");
        if (nameIdx != -1) {
            int endIdx = uri.indexOf('&', nameIdx);
            String raw = endIdx != -1 ? uri.substring(nameIdx + 5, endIdx) : uri.substring(nameIdx + 5);
            try {
                requestedName = URLDecoder.decode(raw, "UTF-8");
            } catch (Exception ignored) {}
        }

        if (requestedName != null && !requestedName.trim().isEmpty()) {
            requestedName = new File(requestedName).getName().replaceAll("[\\\\/:*?\"<>|]", "_");
        } else {
            requestedName = "upload_" + System.currentTimeMillis();
        }

        // Check if pre-approved, or prompt user if not pre-approved
        if (!approvedFiles.remove(requestedName)) {
            if (listener != null) {
                boolean accepted = listener.onRequestTransfer(clientIp, requestedName, contentLength);
                if (!accepted) {
                    sendResponse(out, 403, "application/json", "{\"error\":\"Transfer rejected by phone\"}".getBytes(StandardCharsets.UTF_8));
                    return;
                }
            }
        }

        File outFile = new File(storageDir, requestedName);
        if (outFile.exists()) {
            String baseName = requestedName;
            String extension = "";
            int dotIdx = requestedName.lastIndexOf('.');
            if (dotIdx > 0) {
                baseName = requestedName.substring(0, dotIdx);
                extension = requestedName.substring(dotIdx);
            }
            int count = 1;
            while (outFile.exists()) {
                outFile = new File(storageDir, baseName + " (" + count + ")" + extension);
                count++;
            }
        }

        // Stream file directly to disk
        try (FileOutputStream fos = new FileOutputStream(outFile)) {
            byte[] buffer = new byte[64 * 1024];
            long remaining = contentLength > 0 ? contentLength : Long.MAX_VALUE;
            int read;
            while (remaining > 0 && (read = in.read(buffer, 0, (int) Math.min(buffer.length, remaining))) != -1) {
                fos.write(buffer, 0, read);
                if (contentLength > 0) remaining -= read;
            }
            fos.flush();
        }

        deletedFiles.remove(outFile.getName());
        saveDeletedCache();

        if (listener != null) {
            listener.onFileReceived(outFile.getName(), outFile.length());
        }

        String json = "{\"success\":true,\"name\":\"" + outFile.getName() + "\"}";
        sendResponse(out, 200, "application/json", json.getBytes(StandardCharsets.UTF_8));
    }

    private void sendResponse(OutputStream out, int statusCode, String contentType, byte[] data) throws IOException {
        String header = "HTTP/1.1 " + statusCode + (statusCode == 200 ? " OK" : " Error") + "\r\n" +
                "Content-Type: " + contentType + "\r\n" +
                "Content-Length: " + data.length + "\r\n" +
                "Access-Control-Allow-Origin: *\r\n" +
                "Connection: close\r\n\r\n";
        out.write(header.getBytes(StandardCharsets.UTF_8));
        out.write(data);
        out.flush();
    }

    private void handleDelete(String uri, OutputStream out) throws IOException {
        String fileName = "";
        int idx = uri.indexOf("file=");
        if (idx == -1) idx = uri.indexOf("name=");
        if (idx != -1) {
            int end = uri.indexOf('&', idx);
            String raw = end != -1 ? uri.substring(idx + 5, end) : uri.substring(idx + 5);
            try {
                fileName = URLDecoder.decode(raw, "UTF-8");
            } catch (Exception ignored) {}
        }

        if (fileName.isEmpty()) {
            sendResponse(out, 400, "application/json", "{\"error\":\"Missing filename\"}".getBytes(StandardCharsets.UTF_8));
            return;
        }

        deleteFileByName(fileName);
        sendResponse(out, 200, "application/json", ("{\"success\":true,\"name\":\"" + fileName.replace("\"", "\\\"") + "\"}").getBytes(StandardCharsets.UTF_8));
    }

    private void handleClearAll(OutputStream out) throws IOException {
        clearAllStorageFiles();
        sendResponse(out, 200, "application/json", "{\"success\":true}".getBytes(StandardCharsets.UTF_8));
    }

    public File[] getFileList() {
        if (!storageDir.exists()) return new File[0];
        File[] files = storageDir.listFiles(f -> f.isFile() && !f.getName().startsWith("."));
        return files != null ? files : new File[0];
    }

    private String getWebPortalHtml() {
        return "<!DOCTYPE html>\n" +
                "<html lang=\"en\">\n" +
                "<head>\n" +
                "  <meta charset=\"UTF-8\" />\n" +
                "  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\" />\n" +
                "  <title>AntyShare — Phone to PC Transfer Portal</title>\n" +
                "  <style>\n" +
                "    :root { --bg: #0a0d14; --card: #121722; --border: #1f293d; --teal: #00f0ff; --green: #10b981; --red: #ef4444; --text: #f8fafc; --muted: #94a3b8; }\n" +
                "    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }\n" +
                "    body { background: var(--bg); color: var(--text); padding: 24px; min-height: 100vh; display: flex; flex-direction: column; align-items: center; }\n" +
                "    .container { width: 100%; max-width: 740px; }\n" +
                "    .header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 1px solid var(--border); }\n" +
                "    .brand { display: flex; align-items: center; gap: 10px; font-size: 24px; font-weight: bold; color: var(--text); }\n" +
                "    .brand span.bolt { color: var(--teal); font-size: 28px; }\n" +
                "    .status-pill { background: rgba(16, 185, 129, 0.15); border: 1px solid var(--green); color: var(--green); padding: 6px 14px; border-radius: 20px; font-size: 13px; font-weight: bold; display: flex; align-items: center; gap: 8px; }\n" +
                "    .card { background: var(--card); border: 1px solid var(--border); border-radius: 14px; padding: 22px; margin-bottom: 20px; }\n" +
                "    .card-header-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }\n" +
                "    .card-title { font-size: 17px; font-weight: bold; display: flex; align-items: center; gap: 8px; }\n" +
                "    .card-subtitle { font-size: 13px; color: var(--muted); margin-bottom: 16px; }\n" +
                "    .drop-zone { border: 2px dashed var(--teal); border-radius: 12px; padding: 36px 20px; text-align: center; cursor: pointer; background: rgba(0, 240, 255, 0.03); transition: all 0.2s; }\n" +
                "    .drop-zone:hover { background: rgba(0, 240, 255, 0.08); border-color: #fff; }\n" +
                "    .btn-action { background: var(--teal); color: var(--bg); border: none; padding: 12px 24px; border-radius: 8px; font-size: 14px; font-weight: bold; cursor: pointer; transition: opacity 0.2s; }\n" +
                "    .btn-action:hover { opacity: 0.9; }\n" +
                "    .progress-bar { width: 100%; height: 10px; background: #162032; border-radius: 5px; overflow: hidden; margin-top: 14px; display: none; }\n" +
                "    .progress-fill { width: 0%; height: 100%; background: var(--teal); transition: width 0.15s; }\n" +
                "    .tab-bar { display: flex; gap: 6px; background: #0c111c; padding: 4px; border-radius: 10px; border: 1px solid var(--border); margin-bottom: 16px; }\n" +
                "    .tab-btn { flex: 1; padding: 9px 12px; background: transparent; border: none; border-radius: 7px; color: var(--muted); font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.2s; display: flex; align-items: center; justify-content: center; gap: 6px; }\n" +
                "    .tab-btn.active { background: #1a2234; color: var(--teal); box-shadow: 0 2px 6px rgba(0,0,0,0.3); }\n" +
                "    .tab-badge { background: rgba(0, 240, 255, 0.15); color: var(--teal); padding: 1px 7px; border-radius: 10px; font-size: 11px; font-weight: 700; }\n" +
                "    .tab-btn.active .tab-badge { background: var(--teal); color: var(--bg); }\n" +
                "    .btn-clear { background: rgba(239, 68, 68, 0.12); border: 1px solid rgba(239, 68, 68, 0.35); color: #f87171; padding: 6px 12px; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer; transition: all 0.2s; display: inline-flex; align-items: center; gap: 6px; }\n" +
                "    .btn-clear:hover { background: var(--red); color: #fff; }\n" +
                "    .file-item { display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; background: #162032; border: 1px solid rgba(255,255,255,0.04); border-radius: 8px; margin-bottom: 8px; transition: all 0.2s; position: relative; }\n" +
                "    .file-item:hover { background: #1b263b; }\n" +
                "    .file-item.downloaded { background: rgba(16, 185, 129, 0.07); border: 1px solid rgba(16, 185, 129, 0.35); border-left: 4px solid var(--green); }\n" +
                "    .file-item.is-sent-by-laptop { background: rgba(0, 240, 255, 0.03); border: 1px solid rgba(0, 240, 255, 0.18); border-left: 4px solid var(--teal); }\n" +
                "    .badge-downloaded { display: inline-flex; align-items: center; gap: 4px; background: rgba(16, 185, 129, 0.18); border: 1px solid rgba(16, 185, 129, 0.4); color: var(--green); font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 10px; margin-left: 8px; vertical-align: middle; }\n" +
                "    .badge-sent { display: inline-flex; align-items: center; gap: 4px; background: rgba(0, 240, 255, 0.12); border: 1px solid rgba(0, 240, 255, 0.35); color: var(--teal); font-size: 11px; font-weight: 700; padding: 2px 7px; border-radius: 10px; margin-left: 8px; vertical-align: middle; }\n" +
                "    .badge-from-phone { display: inline-flex; align-items: center; gap: 4px; background: rgba(168, 85, 247, 0.15); border: 1px solid rgba(168, 85, 247, 0.35); color: #c084fc; font-size: 11px; font-weight: 700; padding: 2px 7px; border-radius: 10px; margin-left: 8px; vertical-align: middle; }\n" +
                "    .btn-already-on-pc { background: rgba(255, 255, 255, 0.06); border: 1px solid rgba(255, 255, 255, 0.15); color: #94a3b8; padding: 6px 11px; border-radius: 6px; font-size: 11.5px; font-weight: 600; display: inline-flex; align-items: center; gap: 4px; cursor: default; }\n" +
                "    .link-redownload { color: #64748b; font-size: 11.5px; text-decoration: underline; cursor: pointer; padding: 2px 6px; transition: color 0.15s; }\n" +
                "    .link-redownload:hover { color: var(--teal); }\n" +
                "    .sent-item { display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; background: rgba(0, 240, 255, 0.04); border: 1px solid rgba(0, 240, 255, 0.18); border-left: 3px solid var(--teal); border-radius: 8px; margin-bottom: 6px; }\n" +
                "    .file-info { display: flex; align-items: center; gap: 10px; min-width: 0; flex: 1; padding-right: 12px; }\n" +
                "    .file-icon { font-size: 20px; flex-shrink: 0; }\n" +
                "    .file-text { min-width: 0; }\n" +
                "    .file-name { font-size: 14px; font-weight: 500; word-break: break-all; color: #f8fafc; display: flex; align-items: center; flex-wrap: wrap; }\n" +
                "    .file-meta { font-size: 12px; color: var(--muted); margin-top: 2px; }\n" +
                "    .file-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }\n" +
                "    .btn-download { background: var(--green); color: var(--bg); border: none; padding: 7px 14px; border-radius: 6px; font-size: 12px; font-weight: bold; cursor: pointer; text-decoration: none; display: inline-flex; align-items: center; gap: 4px; transition: all 0.15s; }\n" +
                "    .btn-download:hover { opacity: 0.9; transform: translateY(-1px); }\n" +
                "    .btn-download.is-downloaded { background: rgba(16, 185, 129, 0.16); border: 1px solid var(--green); color: var(--green); }\n" +
                "    .btn-download.is-downloaded:hover { background: var(--green); color: var(--bg); }\n" +
                "    .btn-delete { background: rgba(239, 68, 68, 0.12); border: 1px solid rgba(239, 68, 68, 0.25); color: #f87171; padding: 6px 10px; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer; transition: all 0.15s; }\n" +
                "    .btn-delete:hover { background: var(--red); color: #fff; }\n" +
                "    .empty-box { text-align: center; padding: 32px 16px; color: var(--muted); }\n" +
                "    .empty-box .ico { font-size: 32px; margin-bottom: 8px; opacity: 0.7; }\n" +
                "    .empty-box p { font-size: 13.5px; }\n" +
                "    .empty-box .sub { font-size: 12px; color: #64748b; margin-top: 4px; }\n" +
                "  </style>\n" +
                "</head>\n" +
                "<body>\n" +
                "  <div class=\"container\">\n" +
                "    <div class=\"header\">\n" +
                "      <div class=\"brand\"><span class=\"bolt\">⚡</span> AntyShare PC Portal</div>\n" +
                "      <div class=\"status-pill\">🟢 Connected to Phone</div>\n" +
                "    </div>\n" +
                "    <div class=\"card\">\n" +
                "      <div class=\"card-title\">📤 Send Files from Laptop to Phone</div>\n" +
                "      <div class=\"card-subtitle\">Select photos, 4K videos, zip files or software to transfer into phone's Downloads folder.</div>\n" +
                "      <div class=\"drop-zone\" id=\"dropzone\">\n" +
                "        <div style=\"font-size: 32px; margin-bottom: 8px;\">📁</div>\n" +
                "        <p style=\"font-size: 15px; font-weight: 600; margin-bottom: 6px;\">Drag and Drop files here</p>\n" +
                "        <p style=\"font-size: 12.5px; color: var(--muted); margin-bottom: 14px;\">or click to browse from laptop</p>\n" +
                "        <input type=\"file\" id=\"file-input\" style=\"display: none;\" multiple />\n" +
                "        <button class=\"btn-action\" onclick=\"document.getElementById('file-input').click()\">Choose Files</button>\n" +
                "      </div>\n" +
                "      <div class=\"progress-bar\" id=\"prog-bar\"><div class=\"progress-fill\" id=\"prog-fill\"></div></div>\n" +
                "      <p id=\"upload-status\" style=\"font-size: 13px; color: var(--muted); margin-top: 8px; text-align: center;\"></p>\n" +
                "      <div id=\"sent-history-box\" style=\"margin-top: 18px; display: none; border-top: 1px dashed var(--border); padding-top: 14px;\">\n" +
                "        <div style=\"font-size: 13px; font-weight: 700; color: var(--teal); margin-bottom: 10px; display: flex; align-items: center; justify-content: space-between;\">\n" +
                "          <span>📤 Transferred to Phone (This Session):</span>\n" +
                "          <span style=\"font-size: 11px; color: var(--muted); cursor: pointer; text-decoration: underline;\" onclick=\"clearSentHistory()\">Clear List</span>\n" +
                "        </div>\n" +
                "        <div id=\"sent-history-list\"></div>\n" +
                "      </div>\n" +
                "    </div>\n" +
                "    <div class=\"card\">\n" +
                "      <div class=\"card-header-row\">\n" +
                "        <div class=\"card-title\">📥 Download Files from Phone</div>\n" +
                "      </div>\n" +
                "      <div class=\"card-subtitle\">Download files shared by your phone or saved in storage.</div>\n" +
                "      <div class=\"tab-bar\">\n" +
                "        <button class=\"tab-btn active\" id=\"tab-btn-session\" onclick=\"switchTab('session')\">\n" +
                "          📱 Files Shared by Phone <span class=\"tab-badge\" id=\"badge-session\">0</span>\n" +
                "        </button>\n" +
                "        <button class=\"tab-btn\" id=\"tab-btn-storage\" onclick=\"switchTab('storage')\">\n" +
                "          💾 Phone Storage Vault <span class=\"tab-badge\" id=\"badge-storage\">0</span>\n" +
                "        </button>\n" +
                "      </div>\n" +
                "      <div id=\"view-session\">\n" +
                "        <div id=\"session-list\"><p style=\"font-size: 13px; color: var(--muted);\">Loading files...</p></div>\n" +
                "      </div>\n" +
                "      <div id=\"view-storage\" style=\"display: none;\">\n" +
                "        <div id=\"storage-list\"><p style=\"font-size: 13px; color: var(--muted);\">Loading files...</p></div>\n" +
                "      </div>\n" +
                "    </div>\n" +
                "  </div>\n" +
                "  <script>\n" +
                "    function formatBytes(bytes) {\n" +
                "      if (!bytes || bytes === 0) return '0 B';\n" +
                "      const k = 1024, sizes = ['B', 'KB', 'MB', 'GB'];\n" +
                "      const i = Math.floor(Math.log(bytes) / Math.log(k));\n" +
                "      return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];\n" +
                "    }\n" +
                "    function getFileIcon(name) {\n" +
                "      const l = name.toLowerCase();\n" +
                "      if (l.endsWith('.png') || l.endsWith('.jpg') || l.endsWith('.jpeg') || l.endsWith('.webp') || l.endsWith('.gif')) return '🖼️';\n" +
                "      if (l.endsWith('.mp4') || l.endsWith('.mkv') || l.endsWith('.mov') || l.endsWith('.webm') || l.endsWith('.avi')) return '🎬';\n" +
                "      if (l.endsWith('.mp3') || l.endsWith('.wav') || l.endsWith('.aac') || l.endsWith('.m4a')) return '🎵';\n" +
                "      if (l.endsWith('.zip') || l.endsWith('.rar') || l.endsWith('.7z') || l.endsWith('.tar')) return '📦';\n" +
                "      if (l.endsWith('.apk')) return '🤖';\n" +
                "      if (l.endsWith('.pdf')) return '📕';\n" +
                "      if (l.endsWith('.txt') || l.endsWith('.doc') || l.endsWith('.docx')) return '📄';\n" +
                "      return '📁';\n" +
                "    }\n" +
                "    let downloadedFiles = new Set();\n" +
                "    try {\n" +
                "      const saved = localStorage.getItem('antyshare_downloaded_files');\n" +
                "      if (saved) downloadedFiles = new Set(JSON.parse(saved));\n" +
                "    } catch (e) {}\n" +
                "    let laptopSentFiles = new Set();\n" +
                "    try {\n" +
                "      const savedSent = localStorage.getItem('antyshare_laptop_sent');\n" +
                "      if (savedSent) laptopSentFiles = new Set(JSON.parse(savedSent));\n" +
                "    } catch (e) {}\n" +
                "    let clientDeletedFiles = new Set();\n" +
                "    try {\n" +
                "      const savedDel = localStorage.getItem('antyshare_client_deleted');\n" +
                "      if (savedDel) clientDeletedFiles = new Set(JSON.parse(savedDel));\n" +
                "    } catch (e) {}\n" +
                "    function renderSentHistory() {\n" +
                "      const box = document.getElementById('sent-history-box');\n" +
                "      const list = document.getElementById('sent-history-list');\n" +
                "      if (!box || !list) return;\n" +
                "      const items = Array.from(laptopSentFiles).filter(n => !clientDeletedFiles.has(n));\n" +
                "      if (items.length === 0) { box.style.display = 'none'; return; }\n" +
                "      box.style.display = 'block';\n" +
                "      list.innerHTML = items.map(name => `\n" +
                "        <div class=\"sent-item\">\n" +
                "          <div style=\"display:flex;align-items:center;gap:8px;min-width:0;\">\n" +
                "            <span>${getFileIcon(name)}</span>\n" +
                "            <span style=\"font-size:13px;font-weight:500;color:#f8fafc;word-break:break-all;\">${name}</span>\n" +
                "          </div>\n" +
                "          <div style=\"display:flex;align-items:center;gap:8px;flex-shrink:0;\">\n" +
                "            <span style=\"font-size:11.5px;color:var(--green);font-weight:600;\">✓ Saved on Phone</span>\n" +
                "            <button onclick=\"deleteFile('${encodeURIComponent(name)}', '${name.replace(/'/g, \"\\\\'\")}')\" class=\"btn-delete\" title=\"Delete from Phone\" style=\"padding:4px 8px;font-size:11px;\">🗑️ Delete</button>\n" +
                "          </div>\n" +
                "        </div>\n" +
                "      `).join('');\n" +
                "    }\n" +
                "    function clearSentHistory() {\n" +
                "      laptopSentFiles.clear();\n" +
                "      try { localStorage.removeItem('antyshare_laptop_sent'); } catch (e) {}\n" +
                "      renderSentHistory();\n" +
                "      loadFiles();\n" +
                "    }\n" +
                "    function triggerRightDownloadEffect(sourceElement) {}\n" +
                "    window.triggerRightDownloadEffect = triggerRightDownloadEffect;\n" +
                "    window.triggerFlyToDownloadAnimation = triggerRightDownloadEffect;\n" +
                "    function markDownloaded(encodedName, btnEl) {\n" +
                "      try {\n" +
                "        if (btnEl) triggerRightDownloadEffect(btnEl);\n" +
                "        const name = decodeURIComponent(encodedName);\n" +
                "        downloadedFiles.add(name);\n" +
                "        localStorage.setItem('antyshare_downloaded_files', JSON.stringify(Array.from(downloadedFiles)));\n" +
                "        setTimeout(loadFiles, 100);\n" +
                "      } catch (e) {}\n" +
                "    }\n" +
                "    let currentTab = 'storage';\n" +
                "    let userToggledTab = false;\n" +
                "    function switchTab(tab) {\n" +
                "      currentTab = tab;\n" +
                "      userToggledTab = true;\n" +
                "      document.getElementById('tab-btn-session').classList.toggle('active', tab === 'session');\n" +
                "      document.getElementById('tab-btn-storage').classList.toggle('active', tab === 'storage');\n" +
                "      document.getElementById('view-session').style.display = tab === 'session' ? 'block' : 'none';\n" +
                "      document.getElementById('view-storage').style.display = tab === 'storage' ? 'block' : 'none';\n" +
                "    }\n" +
                "    async function loadFiles() {\n" +
                "      try {\n" +
                "        const res = await fetch('/api/files');\n" +
                "        const data = await res.json();\n" +
                "        const rawSession = data.sessionFiles || [];\n" +
                "        const rawStorage = data.storageFiles || [];\n" +
                "        const sessionFiles = rawSession.filter(f => !clientDeletedFiles.has(f.name));\n" +
                "        const storageFiles = rawStorage.filter(f => !clientDeletedFiles.has(f.name));\n" +
                "        document.getElementById('badge-session').innerText = sessionFiles.length;\n" +
                "        document.getElementById('badge-storage').innerText = storageFiles.length;\n" +
                "        if (!userToggledTab) {\n" +
                "          if (sessionFiles.length > 0) {\n" +
                "            currentTab = 'session';\n" +
                "          } else {\n" +
                "            currentTab = 'storage';\n" +
                "          }\n" +
                "          document.getElementById('tab-btn-session').classList.toggle('active', currentTab === 'session');\n" +
                "          document.getElementById('tab-btn-storage').classList.toggle('active', currentTab === 'storage');\n" +
                "          document.getElementById('view-session').style.display = currentTab === 'session' ? 'block' : 'none';\n" +
                "          document.getElementById('view-storage').style.display = currentTab === 'storage' ? 'block' : 'none';\n" +
                "        }\n" +
                "        const sList = document.getElementById('session-list');\n" +
                "        if (sessionFiles.length === 0) {\n" +
                "          sList.innerHTML = '<div class=\"empty-box\"><div class=\"ico\">📱</div><p><b>No files shared by phone in this session.</b></p><p class=\"sub\">Tap <b>\"📁 Choose Files to Share\"</b> in the AntyShare mobile app to send files to this PC.</p></div>';\n" +
                "        } else {\n" +
                "          sList.innerHTML = sessionFiles.map(f => {\n" +
                "            const isDl = downloadedFiles.has(f.name);\n" +
                "            return `\n" +
                "            <div class=\"file-item ${isDl ? 'downloaded' : ''}\">\n" +
                "              <div class=\"file-info\">\n" +
                "                <span class=\"file-icon\">${getFileIcon(f.name)}</span>\n" +
                "                <div class=\"file-text\">\n" +
                "                  <div class=\"file-name\">${f.name}${isDl ? '<span class=\"badge-downloaded\">✓ Downloaded</span>' : ''}</div>\n" +
                "                  <div class=\"file-meta\">${f.sizeFormatted} • ${isDl ? '<span style=\"color:#10b981;font-weight:600;\">Saved on Laptop</span>' : 'Ready to download'}</div>\n" +
                "                </div>\n" +
                "              </div>\n" +
                "              <div class=\"file-actions\">\n" +
                "                <a href=\"/download?file=${encodeURIComponent(f.name)}\" onclick=\"markDownloaded('${encodeURIComponent(f.name)}', this)\" class=\"btn-download ${isDl ? 'is-downloaded' : ''}\">${isDl ? '✓ Downloaded' : '⬇️ Download'}</a>\n" +
                "                <button onclick=\"deleteFile('${encodeURIComponent(f.name)}', '${f.name.replace(/'/g, \"\\\\'\")}')\" class=\"btn-delete\" title=\"Remove\">✕</button>\n" +
                "              </div>\n" +
                "            </div>`;\n" +
                "          }).join('');\n" +
                "        }\n" +
                "        const stList = document.getElementById('storage-list');\n" +
                "        if (storageFiles.length === 0) {\n" +
                "          stList.innerHTML = '<div class=\"empty-box\"><div class=\"ico\">📂</div><p><b>Phone storage is clean and empty.</b></p><p class=\"sub\">Files sent to the phone will be stored here.</p></div>';\n" +
                "        } else {\n" +
                "          stList.innerHTML = storageFiles.map(f => {\n" +
                "            const isSentByLaptop = laptopSentFiles.has(f.name);\n" +
                "            const isDl = downloadedFiles.has(f.name);\n" +
                "            if (isSentByLaptop) {\n" +
                "              return `\n" +
                "              <div class=\"file-item is-sent-by-laptop\">\n" +
                "                <div class=\"file-info\">\n" +
                "                  <span class=\"file-icon\">${getFileIcon(f.name)}</span>\n" +
                "                  <div class=\"file-text\">\n" +
                "                    <div class=\"file-name\">${f.name} <span class=\"badge-sent\">📤 Sent by this PC</span></div>\n" +
                "                    <div class=\"file-meta\">${f.sizeFormatted} • Stored on Phone • Original is on this PC</div>\n" +
                "                  </div>\n" +
                "                </div>\n" +
                "                <div class=\"file-actions\">\n" +
                "                  <span class=\"btn-already-on-pc\" title=\"This file was sent by this PC and is already saved here\">✓ Saved on Phone</span>\n" +
                "                  <button onclick=\"deleteFile('${encodeURIComponent(f.name)}', '${f.name.replace(/'/g, \"\\\\'\")}')\" class=\"btn-delete\" title=\"Delete from Phone\">🗑️ Delete</button>\n" +
                "                </div>\n" +
                "              </div>`;\n" +
                "            }\n" +
                "            return `\n" +
                "            <div class=\"file-item ${isDl ? 'downloaded' : ''}\">\n" +
                "              <div class=\"file-info\">\n" +
                "                <span class=\"file-icon\">${getFileIcon(f.name)}</span>\n" +
                "                <div class=\"file-text\">\n" +
                "                  <div class=\"file-name\">${f.name} ${isDl ? '<span class=\"badge-downloaded\">✓ Downloaded</span>' : '<span class=\"badge-from-phone\">📱 From Phone</span>'}</div>\n" +
                "                  <div class=\"file-meta\">${f.sizeFormatted} • In Downloads/AntyShare ${isDl ? '• <span style=\"color:#10b981;font-weight:600;\">Saved on Laptop</span>' : ''}</div>\n" +
                "                </div>\n" +
                "              </div>\n" +
                "              <div class=\"file-actions\">\n" +
                "                <a href=\"/download?file=${encodeURIComponent(f.name)}\" onclick=\"markDownloaded('${encodeURIComponent(f.name)}', this)\" class=\"btn-download ${isDl ? 'is-downloaded' : ''}\">${isDl ? '✓ Downloaded' : '⬇️ Download'}</a>\n" +
                "              </div>\n" +
                "            </div>`;\n" +
                "          }).join('');\n" +
                "        }\n" +
                "      } catch (e) { console.warn(e); }\n" +
                "    }\n" +
                "    async function deleteFile(encodedName, displayName) {\n" +
                "      try {\n" +
                "        clientDeletedFiles.add(displayName);\n" +
                "        downloadedFiles.delete(displayName);\n" +
                "        laptopSentFiles.delete(displayName);\n" +
                "        try {\n" +
                "          localStorage.setItem('antyshare_client_deleted', JSON.stringify(Array.from(clientDeletedFiles)));\n" +
                "          localStorage.setItem('antyshare_downloaded_files', JSON.stringify(Array.from(downloadedFiles)));\n" +
                "          localStorage.setItem('antyshare_laptop_sent', JSON.stringify(Array.from(laptopSentFiles)));\n" +
                "        } catch (e) {}\n" +
                "        renderSentHistory();\n" +
                "        loadFiles();\n" +
                "        await fetch('/api/delete?file=' + encodedName, { method: 'POST' });\n" +
                "        loadFiles();\n" +
                "      } catch (err) {\n" +
                "        console.warn(err);\n" +
                "        loadFiles();\n" +
                "      }\n" +
                "    }\n" +
                "    async function clearAllFiles() {\n" +
                "      if (!confirm('Delete ALL files from phone\\'s AntyShare folder?\\n\\nThis will permanently remove all old files from phone storage.')) return;\n" +
                "      try {\n" +
                "        document.querySelectorAll('.file-item .file-name').forEach(el => {\n" +
                "          const text = el.innerText.trim();\n" +
                "          const name = text.split('\\n')[0].replace(/✓.*|📤.*|📱.*/g, '').trim();\n" +
                "          if (name) clientDeletedFiles.add(name);\n" +
                "        });\n" +
                "        downloadedFiles.clear();\n" +
                "        laptopSentFiles.clear();\n" +
                "        try {\n" +
                "          localStorage.setItem('antyshare_client_deleted', JSON.stringify(Array.from(clientDeletedFiles)));\n" +
                "          localStorage.removeItem('antyshare_downloaded_files');\n" +
                "          localStorage.removeItem('antyshare_laptop_sent');\n" +
                "        } catch (e) {}\n" +
                "        document.getElementById('storage-list').innerHTML = '<div class=\"empty-box\"><div class=\"ico\">📂</div><p><b>Phone storage is clean and empty.</b></p><p class=\"sub\">Files sent to the phone will be stored here.</p></div>';\n" +
                "        document.getElementById('badge-storage').innerText = '0';\n" +
                "        await fetch('/api/clear-all', { method: 'POST' });\n" +
                "        loadFiles();\n" +
                "      } catch (err) {\n" +
                "        console.warn(err);\n" +
                "        loadFiles();\n" +
                "      }\n" +
                "    }\n" +
                "    async function uploadFiles(files) {\n" +
                "      if (!files || !files.length) return;\n" +
                "      const bar = document.getElementById('prog-bar');\n" +
                "      const fill = document.getElementById('prog-fill');\n" +
                "      const stat = document.getElementById('upload-status');\n" +
                "      bar.style.display = 'block';\n" +
                "      for (let i = 0; i < files.length; i++) {\n" +
                "        const file = files[i];\n" +
                "        stat.style.color = 'var(--teal)';\n" +
                "        stat.innerHTML = `📲 <b>Waiting for permission on Phone</b> for \"<b>${file.name}</b>\" (${formatBytes(file.size)})...<br><span style=\"font-size:12px;color:#94a3b8;\">Please tap <b>Accept</b> on phone screen</span>`;\n" +
                "        fill.style.width = '15%';\n" +
                "        try {\n" +
                "          const reqRes = await fetch('/api/request-transfer?name=' + encodeURIComponent(file.name) + '&size=' + file.size);\n" +
                "          if (reqRes.status !== 200) {\n" +
                "            stat.style.color = '#ef4444';\n" +
                "            stat.innerHTML = `✕ <b>Declined on Phone:</b> Transfer was rejected for \"${file.name}\".`;\n" +
                "            fill.style.width = '0%';\n" +
                "            continue;\n" +
                "          }\n" +
                "          stat.style.color = 'var(--text)';\n" +
                "          stat.innerHTML = `⚡ <b>Sending \"${file.name}\"</b> to Phone...`;\n" +
                "          fill.style.width = '45%';\n" +
                "          const upRes = await fetch('/upload?name=' + encodeURIComponent(file.name), {\n" +
                "            method: 'POST',\n" +
                "            body: file\n" +
                "          });\n" +
                "          if (upRes.ok) {\n" +
                "            fill.style.width = '100%';\n" +
                "            stat.style.color = 'var(--green)';\n" +
                "            stat.innerHTML = `✓ <b>Success:</b> \"${file.name}\" transferred & saved on phone!`;\n" +
                "            clientDeletedFiles.delete(file.name);\n" +
                "            laptopSentFiles.add(file.name);\n" +
                "            try {\n" +
                "              localStorage.setItem('antyshare_client_deleted', JSON.stringify(Array.from(clientDeletedFiles)));\n" +
                "              localStorage.setItem('antyshare_laptop_sent', JSON.stringify(Array.from(laptopSentFiles)));\n" +
                "            } catch (e) {}\n" +
                "            renderSentHistory();\n" +
                "          } else {\n" +
                "            throw new Error('Upload rejected by server');\n" +
                "          }\n" +
                "        } catch (err) {\n" +
                "          stat.style.color = '#ef4444';\n" +
                "          stat.innerHTML = `❌ Transfer error: ${err.message}`;\n" +
                "        }\n" +
                "      }\n" +
                "      setTimeout(() => { bar.style.display = 'none'; loadFiles(); }, 2500);\n" +
                "    }\n" +
                "    const dropzone = document.getElementById('dropzone');\n" +
                "    const fileInput = document.getElementById('file-input');\n" +
                "    fileInput.addEventListener('change', (e) => uploadFiles(e.target.files));\n" +
                "    dropzone.addEventListener('dragover', (e) => {\n" +
                "      e.preventDefault();\n" +
                "      dropzone.style.background = 'rgba(0, 240, 255, 0.12)';\n" +
                "      dropzone.style.borderColor = '#ffffff';\n" +
                "    });\n" +
                "    dropzone.addEventListener('dragleave', (e) => {\n" +
                "      e.preventDefault();\n" +
                "      dropzone.style.background = 'rgba(0, 240, 255, 0.03)';\n" +
                "      dropzone.style.borderColor = 'var(--teal)';\n" +
                "    });\n" +
                "    dropzone.addEventListener('drop', (e) => {\n" +
                "      e.preventDefault();\n" +
                "      dropzone.style.background = 'rgba(0, 240, 255, 0.03)';\n" +
                "      dropzone.style.borderColor = 'var(--teal)';\n" +
                "      if (e.dataTransfer && e.dataTransfer.files.length) {\n" +
                "        uploadFiles(e.dataTransfer.files);\n" +
                "      }\n" +
                "    });\n" +
                "    loadFiles();\n" +
                "    renderSentHistory();\n" +
                "    setInterval(loadFiles, 2500);\n" +
                "  </script>\n" +
                "</body>\n" +
                "</html>\n";
    }
}
