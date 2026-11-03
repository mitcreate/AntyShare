package com.antyshare.app;

import android.database.Cursor;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Bundle;
import android.provider.OpenableColumns;
import android.view.View;
import android.widget.Button;
import android.widget.ImageButton;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.appcompat.app.AppCompatActivity;

import com.antyshare.app.server.P2pSocketServer;
import com.antyshare.app.util.NetworkUtils;
import com.antyshare.app.util.QrUtils;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Random;

public class SenderActivity extends AppCompatActivity {

    private TextView tvSelectedFiles;
    private TextView tvTotalSize;
    private LinearLayout layoutQrContainer;
    private ImageView ivQr;
    private TextView tvPin;

    private LinearLayout layoutProgress;
    private TextView tvCurrentFile;
    private ProgressBar pbTransfer;
    private TextView tvSpeed;
    private TextView tvPercent;

    private final List<Uri> selectedUris = new ArrayList<>();
    private final List<String> fileNames = new ArrayList<>();
    private final List<Long> fileSizes = new ArrayList<>();
    private int generatedPin = 1000;

    private final ActivityResultLauncher<String> filePickerLauncher =
            registerForActivityResult(new ActivityResultContracts.GetMultipleContents(), uris -> {
                if (uris != null && !uris.isEmpty()) {
                    handleSelectedFiles(uris);
                }
            });

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_sender);

        ImageButton btnBack = findViewById(R.id.btn_back_sender);
        btnBack.setOnClickListener(v -> finish());

        tvSelectedFiles = findViewById(R.id.tv_sender_selected_files);
        tvTotalSize = findViewById(R.id.tv_sender_total_size);
        Button btnChoose = findViewById(R.id.btn_choose_files);

        layoutQrContainer = findViewById(R.id.layout_sender_qr_container);
        ivQr = findViewById(R.id.iv_sender_qr);
        tvPin = findViewById(R.id.tv_sender_pin);

        layoutProgress = findViewById(R.id.layout_sender_progress);
        tvCurrentFile = findViewById(R.id.tv_sender_current_file);
        pbTransfer = findViewById(R.id.pb_sender_transfer);
        tvSpeed = findViewById(R.id.tv_sender_speed);
        tvPercent = findViewById(R.id.tv_sender_percent);

        btnChoose.setOnClickListener(v -> filePickerLauncher.launch("*/*"));

        generatedPin = 1000 + new Random().nextInt(9000);
        tvPin.setText(String.format(Locale.US, "PIN: %d • IP: %s", generatedPin, NetworkUtils.getLocalIPv4Address()));
    }

    private void handleSelectedFiles(List<Uri> uris) {
        selectedUris.clear();
        fileNames.clear();
        fileSizes.clear();

        long totalBytes = 0;
        for (Uri uri : uris) {
            String name = queryFileName(uri);
            long size = queryFileSize(uri);
            selectedUris.add(uri);
            fileNames.add(name);
            fileSizes.add(size);
            totalBytes += size;
        }

        tvSelectedFiles.setText(String.format(Locale.US, "%d file(s) selected", selectedUris.size()));
        tvTotalSize.setText(String.format(Locale.US, "Total payload: %s • Ready to beam!", NetworkUtils.formatBytes(totalBytes)));

        // Show QR and start socket server
        layoutQrContainer.setVisibility(View.VISIBLE);
        String ip = NetworkUtils.getLocalIPv4Address();
        String payload = String.format(Locale.US, "antyshare://%s:%d?pin=%d", ip, P2pSocketServer.P2P_PORT, generatedPin);
        
        Bitmap qr = QrUtils.generateQrBitmap(payload, 440, 440);
        if (qr != null) {
            ivQr.setImageBitmap(qr);
        }

        startServerStreaming();
    }

    private void startServerStreaming() {
        P2pSocketServer.startSenderServer(selectedUris, fileNames, fileSizes, this, new P2pSocketServer.TransferListener() {
            @Override
            public void onProgress(String fileName, int percent, String speedMBs) {
                runOnUiThread(() -> {
                    layoutProgress.setVisibility(View.VISIBLE);
                    tvCurrentFile.setText("Streaming: " + fileName);
                    pbTransfer.setProgress(percent);
                    tvSpeed.setText(speedMBs);
                    tvPercent.setText(percent + "%");
                });
            }

            @Override
            public void onFileCompleted(String fileName) {
                runOnUiThread(() -> Toast.makeText(SenderActivity.this, "✓ Beamed: " + fileName, Toast.LENGTH_SHORT).show());
            }

            @Override
            public void onAllCompleted() {
                runOnUiThread(() -> {
                    tvCurrentFile.setText("🎉 All files sent successfully!");
                    tvSpeed.setText("✓ 100% Completed");
                    pbTransfer.setProgress(100);
                    Toast.makeText(SenderActivity.this, "🎉 Transfer completed at full speed!", Toast.LENGTH_LONG).show();
                });
            }

            @Override
            public void onError(String message) {
                runOnUiThread(() -> Toast.makeText(SenderActivity.this, "⚠️ " + message, Toast.LENGTH_LONG).show());
            }
        });
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
}
