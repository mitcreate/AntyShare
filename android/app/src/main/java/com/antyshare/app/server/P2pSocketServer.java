package com.antyshare.app.server;

import android.content.Context;
import android.net.Uri;
import android.os.Environment;
import android.util.Log;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.ServerSocket;
import java.net.Socket;
import java.util.List;

public class P2pSocketServer {
    private static final String TAG = "AntyShareP2P";
    public static final int P2P_PORT = 8988;
    private static final byte[] MAGIC = new byte[]{'A', 'N', 'T', 'Y'};

    public interface TransferListener {
        void onProgress(String fileName, int percent, String speedMBs);
        void onFileCompleted(String fileName);
        void onAllCompleted();
        void onError(String message);
    }

    /**
     * Sender: streams files to receiver socket.
     */
    public static void startSenderServer(List<Uri> files, List<String> fileNames, List<Long> fileSizes, Context context, TransferListener listener) {
        new Thread(() -> {
            ServerSocket serverSocket = null;
            try {
                serverSocket = new ServerSocket(P2P_PORT);
                Log.d(TAG, "P2P ServerSocket listening on port " + P2P_PORT);
                Socket client = serverSocket.accept();
                Log.d(TAG, "Receiver connected: " + client.getInetAddress());

                DataOutputStream dos = new DataOutputStream(new BufferedOutputStream(client.getOutputStream()));
                dos.write(MAGIC);
                dos.writeInt(files.size());

                byte[] buffer = new byte[64 * 1024];

                for (int i = 0; i < files.size(); i++) {
                    Uri uri = files.get(i);
                    String name = fileNames.get(i);
                    long size = fileSizes.get(i);

                    byte[] nameBytes = name.getBytes("UTF-8");
                    dos.writeShort(nameBytes.length);
                    dos.write(nameBytes);
                    dos.writeLong(size);
                    dos.flush();

                    long sent = 0;
                    long startTime = System.currentTimeMillis();
                    long lastTime = startTime;
                    long lastSent = 0;

                    try (InputStream is = context.getContentResolver().openInputStream(uri)) {
                        if (is != null) {
                            int read;
                            while ((read = is.read(buffer)) != -1) {
                                dos.write(buffer, 0, read);
                                sent += read;

                                long now = System.currentTimeMillis();
                                if (now - lastTime >= 250 || sent == size) {
                                    double diffSec = (now - lastTime) / 1000.0;
                                    double speedMB = diffSec > 0 ? ((sent - lastSent) / (1024.0 * 1024.0)) / diffSec : 0;
                                    int percent = size > 0 ? (int) ((sent * 100) / size) : 50;
                                    String speedStr = String.format(java.util.Locale.US, "⚡ %.1f MB/s", speedMB);
                                    if (listener != null) {
                                        listener.onProgress(name, percent, speedStr);
                                    }
                                    lastTime = now;
                                    lastSent = sent;
                                }
                            }
                        }
                    }
                    dos.flush();
                    if (listener != null) listener.onFileCompleted(name);
                }

                if (listener != null) listener.onAllCompleted();
                client.close();
            } catch (Exception e) {
                Log.e(TAG, "Sender error: " + e.getMessage());
                if (listener != null) listener.onError("Transfer failed: " + e.getMessage());
            } finally {
                if (serverSocket != null) {
                    try { serverSocket.close(); } catch (Exception ignored) {}
                }
            }
        }).start();
    }

    /**
     * Receiver: connects to sender socket and writes files to Downloads/AntyShare.
     */
    public static void startReceiverClient(String senderIp, TransferListener listener) {
        new Thread(() -> {
            try {
                Socket socket = new Socket(senderIp, P2P_PORT);
                DataInputStream dis = new DataInputStream(new BufferedInputStream(socket.getInputStream()));

                byte[] magic = new byte[4];
                dis.readFully(magic);
                if (magic[0] != 'A' || magic[1] != 'N' || magic[2] != 'T' || magic[3] != 'Y') {
                    throw new IOException("Invalid AntyShare handshake");
                }

                int fileCount = dis.readInt();
                File targetDir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "AntyShare");
                if (!targetDir.exists()) targetDir.mkdirs();

                byte[] buffer = new byte[64 * 1024];

                for (int i = 0; i < fileCount; i++) {
                    short nameLen = dis.readShort();
                    byte[] nameBytes = new byte[nameLen];
                    dis.readFully(nameBytes);
                    String fileName = new String(nameBytes, "UTF-8");
                    long fileSize = dis.readLong();

                    File outFile = new File(targetDir, fileName);
                    long received = 0;
                    long startTime = System.currentTimeMillis();
                    long lastTime = startTime;
                    long lastReceived = 0;

                    try (FileOutputStream fos = new FileOutputStream(outFile)) {
                        while (received < fileSize) {
                            int toRead = (int) Math.min(buffer.length, fileSize - received);
                            int read = dis.read(buffer, 0, toRead);
                            if (read == -1) break;
                            fos.write(buffer, 0, read);
                            received += read;

                            long now = System.currentTimeMillis();
                            if (now - lastTime >= 250 || received == fileSize) {
                                double diffSec = (now - lastTime) / 1000.0;
                                double speedMB = diffSec > 0 ? ((received - lastReceived) / (1024.0 * 1024.0)) / diffSec : 0;
                                int percent = fileSize > 0 ? (int) ((received * 100) / fileSize) : 50;
                                String speedStr = String.format(java.util.Locale.US, "⚡ %.1f MB/s", speedMB);
                                if (listener != null) {
                                    listener.onProgress(fileName, percent, speedStr);
                                }
                                lastTime = now;
                                lastReceived = received;
                            }
                        }
                        fos.flush();
                    }

                    if (listener != null) listener.onFileCompleted(fileName);
                }

                if (listener != null) listener.onAllCompleted();
                socket.close();
            } catch (Exception e) {
                Log.e(TAG, "Receiver error: " + e.getMessage());
                if (listener != null) listener.onError("Receive failed: " + e.getMessage());
            }
        }).start();
    }
}
