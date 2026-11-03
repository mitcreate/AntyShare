package com.antyshare.app;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.widget.Button;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.antyshare.app.util.NetworkUtils;

import android.app.AlertDialog;
import android.net.Uri;
import android.os.Environment;
import androidx.core.content.FileProvider;
import java.io.File;
import java.util.ArrayList;
import java.util.List;

public class MainActivity extends AppCompatActivity {

    private static final int PERMISSION_REQ_CODE = 101;

    private TextView tvNetworkStatus;
    private TextView tvNetworkDot;
    private TextView tvDeviceModel;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        tvNetworkStatus = findViewById(R.id.tv_network_status);
        tvNetworkDot = findViewById(R.id.tv_network_dot);
        tvDeviceModel = findViewById(R.id.tv_device_model);

        tvDeviceModel.setText(NetworkUtils.getDeviceModel());

        findViewById(R.id.btn_launch_pc).setOnClickListener(v -> {
            startActivity(new Intent(this, PcConnectActivity.class));
        });

        findViewById(R.id.btn_launch_send).setOnClickListener(v -> {
            startActivity(new Intent(this, SenderActivity.class));
        });

        findViewById(R.id.btn_launch_receive).setOnClickListener(v -> {
            startActivity(new Intent(this, ReceiverActivity.class));
        });

        findViewById(R.id.btn_main_received_files).setOnClickListener(v -> {
            showReceivedFilesDialog();
        });

        findViewById(R.id.btn_refresh_network).setOnClickListener(v -> {
            updateNetworkStatus();
            Toast.makeText(this, "Network refreshed", Toast.LENGTH_SHORT).show();
        });

        checkAndRequestPermissions();
        updateNetworkStatus();
    }

    private void showReceivedFilesDialog() {
        File downloads = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
        File dir = new File(downloads, "AntyShare");
        File[] files = dir.exists() ? dir.listFiles(f -> f.isFile() && !f.getName().startsWith(".")) : null;

        if (files == null || files.length == 0) {
            new AlertDialog.Builder(this, R.style.DarkAlertDialogTheme)
                    .setTitle("📥 Received Files")
                    .setMessage("No files in AntyShare storage yet.\n\nFiles transferred from Laptop or other phones are safely preserved in:\nInternal Storage > Download > AntyShare")
                    .setPositiveButton("OK", null)
                    .show();
            return;
        }

        String[] names = new String[files.length];
        for (int i = 0; i < files.length; i++) {
            names[i] = files[i].getName() + "\n(" + NetworkUtils.formatBytes(files[i].length()) + ") — Tap to Open";
        }

        new AlertDialog.Builder(this, R.style.DarkAlertDialogTheme)
                .setTitle("📥 Received Files (" + files.length + ")")
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

    @Override
    protected void onResume() {
        super.onResume();
        updateNetworkStatus();
    }

    private void updateNetworkStatus() {
        String ip = NetworkUtils.getLocalIPv4Address();
        if (ip.equals("127.0.0.1") || ip.equals("0.0.0.0")) {
            tvNetworkDot.setText("⚪");
            tvNetworkStatus.setText("Offline: Turn on Hotspot or connect Wi-Fi");
        } else {
            tvNetworkDot.setText("🟢");
            tvNetworkStatus.setText("Active Network IP: " + ip);
        }
    }

    private void checkAndRequestPermissions() {
        List<String> needed = new ArrayList<>();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_MEDIA_IMAGES) != PackageManager.PERMISSION_GRANTED) {
                needed.add(Manifest.permission.READ_MEDIA_IMAGES);
            }
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_MEDIA_VIDEO) != PackageManager.PERMISSION_GRANTED) {
                needed.add(Manifest.permission.READ_MEDIA_VIDEO);
            }
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.NEARBY_WIFI_DEVICES) != PackageManager.PERMISSION_GRANTED) {
                needed.add(Manifest.permission.NEARBY_WIFI_DEVICES);
            }
        } else {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
                needed.add(Manifest.permission.READ_EXTERNAL_STORAGE);
            }
        }

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            needed.add(Manifest.permission.CAMERA);
        }

        if (!needed.isEmpty()) {
            ActivityCompat.requestPermissions(this, needed.toArray(new String[0]), PERMISSION_REQ_CODE);
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        updateNetworkStatus();
    }
}
