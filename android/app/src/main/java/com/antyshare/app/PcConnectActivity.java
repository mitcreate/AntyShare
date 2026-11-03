package com.antyshare.app;

import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.graphics.Bitmap;
import android.os.Bundle;
import android.widget.Button;
import android.widget.ImageButton;
import android.widget.ImageView;
import android.widget.TextView;
import android.widget.Toast;

import android.app.Dialog;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.view.Window;
import android.view.ViewGroup;
import android.widget.CheckBox;
import android.content.Intent;
import androidx.appcompat.app.AppCompatActivity;
import androidx.appcompat.app.AlertDialog;
import androidx.core.content.FileProvider;

import com.antyshare.app.server.EmbeddedHttpServer;
import com.antyshare.app.util.NetworkUtils;
import com.antyshare.app.util.QrUtils;

import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import android.os.Environment;
import java.io.File;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

public class PcConnectActivity extends AppCompatActivity {

    private static EmbeddedHttpServer activeServer;
    private TextView tvUrl;
    private TextView tvStatus;
    private TextView tvIndicator;
    private TextView tvLog;
    private TextView tvSharedCount;
    private ImageView ivQr;
    private Button btnToggle;
    private Button btnViewReceived;
    private String currentUrl = "";
    private boolean alwaysAllowTransfers = false;

    private final List<EmbeddedHttpServer.SharedItem> sharedItems = new ArrayList<>();

    private final ActivityResultLauncher<String> filePickerLauncher =
            registerForActivityResult(new ActivityResultContracts.GetMultipleContents(), uris -> {
                if (uris != null && !uris.isEmpty()) {
                    handleSharedFiles(uris);
                }
            });

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        setContentView(R.layout.activity_pc_connect);

        ImageButton btnBack = findViewById(R.id.btn_back_pc);
        btnBack.setOnClickListener(v -> finish());

        tvUrl = findViewById(R.id.tv_pc_url);
        tvStatus = findViewById(R.id.tv_pc_server_status);
        tvIndicator = findViewById(R.id.tv_pc_server_indicator);
        tvLog = findViewById(R.id.tv_pc_transfer_log);
        tvSharedCount = findViewById(R.id.tv_pc_shared_count);
        ivQr = findViewById(R.id.iv_pc_qr_code);
        btnToggle = findViewById(R.id.btn_toggle_pc_server);
        Button btnCopy = findViewById(R.id.btn_copy_pc_url);
        Button btnPickFiles = findViewById(R.id.btn_pc_pick_files);
        btnViewReceived = findViewById(R.id.btn_view_received_files);

        btnPickFiles.setOnClickListener(v -> filePickerLauncher.launch("*/*"));
        btnViewReceived.setOnClickListener(v -> showReceivedFilesDialog());
        updateReceivedButtonBadge();

        btnCopy.setOnClickListener(v -> {
            if (!currentUrl.isEmpty()) {
                ClipboardManager clipboard = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                ClipData clip = ClipData.newPlainText("AntyShare PC URL", currentUrl);
                clipboard.setPrimaryClip(clip);
                Toast.makeText(this, "📋 URL copied! Paste in Laptop browser", Toast.LENGTH_SHORT).show();
            }
        });

        btnToggle.setOnClickListener(v -> {
            if (activeServer != null && activeServer.isRunning()) {
                stopServer();
            } else {
                startServer();
            }
        });

        startServer();
    }

    @Override
    protected void onResume() {
        super.onResume();
        updateReceivedButtonBadge();
    }

    private void updateReceivedButtonBadge() {
        if (btnViewReceived == null) return;
        File downloads = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
        File dir = new File(downloads, "AntyShare");
        File[] files = activeServer != null ? activeServer.getFileList() : (dir.exists() ? dir.listFiles(f -> f.isFile() && !f.getName().startsWith(".")) : null);
        int count = files != null ? files.length : 0;
        if (count > 0) {
            btnViewReceived.setText("📥 View Received Laptop Files (" + count + ")");
        } else {
            btnViewReceived.setText("📥 View Received Laptop Files");
        }
    }

    private void showReceivedFilesDialog() {
        File downloads = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
        File dir = new File(downloads, "AntyShare");
        File[] files = activeServer != null ? activeServer.getFileList() : (dir.exists() ? dir.listFiles(f -> f.isFile() && !f.getName().startsWith(".")) : null);

        if (files == null || files.length == 0) {
            new AlertDialog.Builder(this, R.style.DarkAlertDialogTheme)
                    .setTitle("📥 Received Files")
                    .setMessage("No files in AntyShare storage yet.\n\nFiles sent from Laptop are safely preserved in:\nInternal Storage > Download > AntyShare")
                    .setPositiveButton("OK", null)
                    .show();
            return;
        }

        String[] names = new String[files.length];
        for (int i = 0; i < files.length; i++) {
            names[i] = files[i].getName() + "\n(" + NetworkUtils.formatBytes(files[i].length()) + ") — Tap to Open";
        }

        new AlertDialog.Builder(this, R.style.DarkAlertDialogTheme)
                .setTitle("📥 Received Laptop Files (" + files.length + ")")
                .setItems(names, (dialog, which) -> {
                    openReceivedFile(files[which]);
                })
                .setNegativeButton("📁 Open Folder", (dialog, which) -> {
                    openDownloadsFolder();
                })
                .setPositiveButton("Close", null)
                .show();
    }

    private void openDownloadsFolder() {
        boolean launched = false;
        try {
            Intent intent = new Intent(android.app.DownloadManager.ACTION_VIEW_DOWNLOADS);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(intent);
            launched = true;
        } catch (Exception ignored) {}

        if (!launched) {
            try {
                File downloads = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                File dir = new File(downloads, "AntyShare");
                if (!dir.exists()) dir.mkdirs();
                Uri uri = FileProvider.getUriForFile(this, getPackageName() + ".provider", dir);
                Intent intent = new Intent(Intent.ACTION_VIEW);
                intent.setDataAndType(uri, "*/*");
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(intent);
                launched = true;
            } catch (Exception ignored) {}
        }

        if (!launched) {
            Toast.makeText(this, "📁 Files saved in: Downloads > AntyShare", Toast.LENGTH_LONG).show();
        }
    }

    private void openReceivedFile(File file) {
        try {
            Uri uri = FileProvider.getUriForFile(this, getPackageName() + ".provider", file);
            Intent intent = new Intent(Intent.ACTION_VIEW);
            String mime = getContentResolver().getType(uri);
            if (mime == null) mime = "*/*";
            intent.setDataAndType(uri, mime);
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            startActivity(intent);
        } catch (Exception e) {
            Toast.makeText(this, "Unable to open file: " + e.getMessage(), Toast.LENGTH_SHORT).show();
        }
    }

    private void handleSharedFiles(List<Uri> uris) {
        sharedItems.clear();
        long totalBytes = 0;
        for (Uri uri : uris) {
            String name = queryFileName(uri);
            long size = queryFileSize(uri);
            sharedItems.add(new EmbeddedHttpServer.SharedItem(name, size, uri));
            totalBytes += size;
        }

        if (activeServer != null) {
            activeServer.setSharedItems(sharedItems, getContentResolver());
        }

        String summary = String.format(Locale.US, "✓ %d file(s) shared (%s) — Ready to download on Laptop!",
                sharedItems.size(), NetworkUtils.formatBytes(totalBytes));
        tvSharedCount.setText(summary);
        Toast.makeText(this, summary, Toast.LENGTH_LONG).show();
    }

    private String queryFileName(Uri uri) {
        String name = "file_" + System.currentTimeMillis();
        try (Cursor cursor = getContentResolver().query(uri, null, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int nameIdx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (nameIdx != -1) name = cursor.getString(nameIdx);
            }
        } catch (Exception ignored) {}
        return name;
    }

    private long queryFileSize(Uri uri) {
        long size = 0;
        try (Cursor cursor = getContentResolver().query(uri, null, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int sizeIdx = cursor.getColumnIndex(OpenableColumns.SIZE);
                if (sizeIdx != -1) size = cursor.getLong(sizeIdx);
            }
        } catch (Exception ignored) {}
        return size;
    }

    private void startServer() {
        try {
            if (activeServer == null) {
                activeServer = new EmbeddedHttpServer();
            }
            activeServer.setContentResolver(getContentResolver());

            activeServer.setListener(new EmbeddedHttpServer.ServerEventListener() {
                @Override
                public void onClientConnected(String clientIp) {
                    runOnUiThread(() -> tvLog.setText("🟢 Connected to Laptop: " + clientIp));
                }

                @Override
                public void onFileReceived(String fileName, long sizeBytes) {
                    runOnUiThread(() -> {
                        String msg = String.format("📥 Received '%s' (%s) saved permanently!", fileName, NetworkUtils.formatBytes(sizeBytes));
                        tvLog.setText(msg);
                        Toast.makeText(PcConnectActivity.this, msg, Toast.LENGTH_LONG).show();
                        updateReceivedButtonBadge();
                    });
                }

                @Override
                public void onError(String message) {
                    runOnUiThread(() -> tvLog.setText("⚠️ " + message));
                }

                @Override
                public boolean onRequestTransfer(String clientIp, String fileName, long sizeBytes) {
                    if (alwaysAllowTransfers) {
                        return true;
                    }

                    final CountDownLatch latch = new CountDownLatch(1);
                    final AtomicBoolean accepted = new AtomicBoolean(false);

                    runOnUiThread(() -> {
                        try {
                            if (isFinishing() || isDestroyed()) {
                                accepted.set(false);
                                latch.countDown();
                                return;
                            }

                            Dialog dialog = new Dialog(PcConnectActivity.this);
                            dialog.requestWindowFeature(Window.FEATURE_NO_TITLE);
                            dialog.setContentView(R.layout.dialog_transfer_confirm);

                            if (dialog.getWindow() != null) {
                                dialog.getWindow().setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));
                                dialog.getWindow().setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
                                dialog.getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_DIM_BEHIND);
                                dialog.getWindow().setDimAmount(0.65f);
                            }

                            TextView tvDeviceInfo = dialog.findViewById(R.id.tv_dialog_device_info);
                            TextView tvFileName = dialog.findViewById(R.id.tv_dialog_file_name);
                            TextView tvFileSize = dialog.findViewById(R.id.tv_dialog_file_size);
                            TextView tvFileIcon = dialog.findViewById(R.id.tv_dialog_file_icon);
                            CheckBox cbAlways = dialog.findViewById(R.id.cb_dialog_always_allow);
                            Button btnDecline = dialog.findViewById(R.id.btn_dialog_decline);
                            Button btnAccept = dialog.findViewById(R.id.btn_dialog_accept);

                            tvDeviceInfo.setText("🟢 Laptop (" + clientIp + ") • Instant Wi-Fi Transfer");
                            tvFileName.setText(fileName);
                            tvFileSize.setText(NetworkUtils.formatBytes(sizeBytes) + " • Downloads/AntyShare");

                            String lower = fileName.toLowerCase();
                            if (lower.endsWith(".png") || lower.endsWith(".jpg") || lower.endsWith(".jpeg") || lower.endsWith(".webp") || lower.endsWith(".gif")) {
                                tvFileIcon.setText("🖼️");
                            } else if (lower.endsWith(".mp4") || lower.endsWith(".mkv") || lower.endsWith(".mov") || lower.endsWith(".webm")) {
                                tvFileIcon.setText("🎬");
                            } else if (lower.endsWith(".mp3") || lower.endsWith(".wav") || lower.endsWith(".aac")) {
                                tvFileIcon.setText("🎵");
                            } else if (lower.endsWith(".zip") || lower.endsWith(".rar") || lower.endsWith(".7z") || lower.endsWith(".tar")) {
                                tvFileIcon.setText("📦");
                            } else if (lower.endsWith(".apk")) {
                                tvFileIcon.setText("🤖");
                            } else if (lower.endsWith(".pdf")) {
                                tvFileIcon.setText("📕");
                            } else {
                                tvFileIcon.setText("📄");
                            }

                            btnAccept.setOnClickListener(v -> {
                                if (cbAlways.isChecked()) {
                                    alwaysAllowTransfers = true;
                                }
                                accepted.set(true);
                                dialog.dismiss();
                                latch.countDown();
                            });

                            btnDecline.setOnClickListener(v -> {
                                accepted.set(false);
                                dialog.dismiss();
                                latch.countDown();
                            });

                            dialog.setOnCancelListener(d -> {
                                accepted.set(false);
                                latch.countDown();
                            });

                            dialog.setCanceledOnTouchOutside(false);
                            dialog.show();
                        } catch (Exception e) {
                            accepted.set(false);
                            latch.countDown();
                        }
                    });

                    try {
                        boolean responded = latch.await(45, TimeUnit.SECONDS);
                        if (!responded) {
                            runOnUiThread(() -> tvLog.setText("⏱️ Request timed out for: " + fileName));
                            return false;
                        }
                    } catch (InterruptedException e) {
                        return false;
                    }

                    runOnUiThread(() -> {
                        if (accepted.get()) {
                            tvLog.setText("✓ Approved transfer: " + fileName);
                        } else {
                            tvLog.setText("✕ Declined transfer: " + fileName);
                        }
                    });

                    return accepted.get();
                }
            });

            if (!activeServer.isRunning()) {
                activeServer.start();
            }

            String ip = NetworkUtils.getLocalIPv4Address();
            currentUrl = "http://" + ip + ":" + EmbeddedHttpServer.PORT;
            tvUrl.setText(currentUrl);

            tvStatus.setText("Web Server Running");
            tvStatus.setTextColor(getColor(R.color.emerald_green));
            tvIndicator.setText("🟢");
            btnToggle.setText("Stop Server");

            // Generate and display QR code
            Bitmap qr = QrUtils.generateQrBitmap(currentUrl, 440, 440);
            if (qr != null) {
                ivQr.setImageBitmap(qr);
            }
        } catch (Exception e) {
            tvStatus.setText("Failed to start server");
            tvStatus.setTextColor(getColor(R.color.amber_warning));
            tvIndicator.setText("🔴");
            tvLog.setText("Error: " + e.getMessage());
        }
    }

    private void stopServer() {
        if (activeServer != null) {
            activeServer.stop();
            activeServer = null;
        }
        tvStatus.setText("Server Stopped");
        tvStatus.setTextColor(getColor(R.color.text_muted));
        tvIndicator.setText("⚪");
        btnToggle.setText("Start Server");
        tvLog.setText("Server stopped. Tap 'Start Server' to resume.");
    }
}
