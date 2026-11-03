package com.antyshare.app;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ImageButton;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;

import com.antyshare.app.server.P2pSocketServer;

public class ReceiverActivity extends AppCompatActivity {

    private EditText etManualIp;
    private LinearLayout layoutProgress;
    private TextView tvFileName;
    private ProgressBar pbTransfer;
    private TextView tvSpeed;
    private TextView tvStatus;

    private final ActivityResultLauncher<Intent> qrScanLauncher =
            registerForActivityResult(new ActivityResultContracts.StartActivityForResult(), result -> {
                if (result.getResultCode() == RESULT_OK && result.getData() != null) {
                    String contents = result.getData().getStringExtra("SCAN_RESULT");
                    if (contents != null && !contents.isEmpty()) {
                        handleScannedPayload(contents);
                    }
                }
            });

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_receiver);

        ImageButton btnBack = findViewById(R.id.btn_back_receiver);
        btnBack.setOnClickListener(v -> finish());

        etManualIp = findViewById(R.id.et_manual_ip);
        Button btnScan = findViewById(R.id.btn_scan_camera);
        Button btnConnectManual = findViewById(R.id.btn_connect_manual);

        layoutProgress = findViewById(R.id.layout_receiver_progress);
        tvFileName = findViewById(R.id.tv_receiver_file_name);
        pbTransfer = findViewById(R.id.pb_receiver_transfer);
        tvSpeed = findViewById(R.id.tv_receiver_speed);
        tvStatus = findViewById(R.id.tv_receiver_status);

        btnScan.setOnClickListener(v -> launchCameraScanner());

        btnConnectManual.setOnClickListener(v -> {
            String input = etManualIp.getText().toString().trim();
            if (input.isEmpty()) {
                Toast.makeText(this, "Please enter Sender IP address", Toast.LENGTH_SHORT).show();
                return;
            }
            startReceivingFromIp(input);
        });
    }

    private void launchCameraScanner() {
        Intent intent = new Intent("com.google.zxing.client.android.SCAN");
        intent.putExtra("SCAN_MODE", "QR_CODE_MODE");
        try {
            qrScanLauncher.launch(intent);
        } catch (ActivityNotFoundException e) {
            // ZXing standalone scanner app not present on device: guide user to enter IP manually
            new AlertDialog.Builder(this, R.style.DarkAlertDialogTheme)
                    .setTitle("Camera Scanner")
                    .setMessage("Native camera scanner not found. You can enter the Sender's IP address (shown on Sender screen) directly into Method B below!")
                    .setPositiveButton("Use Manual IP", (dialog, which) -> {
                        etManualIp.requestFocus();
                    })
                    .show();
        }
    }

    private void handleScannedPayload(String payload) {
        // Expected payload format: antyshare://<ip>:8988?pin=...
        try {
            Uri uri = Uri.parse(payload);
            String host = uri.getHost();
            if (host != null && !host.isEmpty()) {
                startReceivingFromIp(host);
            } else {
                Toast.makeText(this, "Invalid AntyShare QR: " + payload, Toast.LENGTH_SHORT).show();
            }
        } catch (Exception e) {
            Toast.makeText(this, "QR parse error: " + e.getMessage(), Toast.LENGTH_SHORT).show();
        }
    }

    private void startReceivingFromIp(String ip) {
        // Strip scheme or port if user typed full URL
        String cleanIp = ip.replace("http://", "").replace("https://", "").replace("antyshare://", "");
        if (cleanIp.contains(":")) {
            cleanIp = cleanIp.split(":")[0];
        }
        if (cleanIp.contains("/")) {
            cleanIp = cleanIp.split("/")[0];
        }

        layoutProgress.setVisibility(View.VISIBLE);
        tvFileName.setText("Connecting to " + cleanIp + "...");
        tvStatus.setText("Pairing...");
        pbTransfer.setProgress(0);

        P2pSocketServer.startReceiverClient(cleanIp, new P2pSocketServer.TransferListener() {
            @Override
            public void onProgress(String fileName, int percent, String speedMBs) {
                runOnUiThread(() -> {
                    tvFileName.setText("Receiving: " + fileName);
                    pbTransfer.setProgress(percent);
                    tvSpeed.setText(speedMBs);
                    tvStatus.setText(percent + "% • Downloads/AntyShare");
                });
            }

            @Override
            public void onFileCompleted(String fileName) {
                runOnUiThread(() -> Toast.makeText(ReceiverActivity.this, "✓ Saved: " + fileName, Toast.LENGTH_SHORT).show());
            }

            @Override
            public void onAllCompleted() {
                runOnUiThread(() -> {
                    tvFileName.setText("🎉 All files received successfully!");
                    tvSpeed.setText("✓ 100% Downloaded");
                    tvStatus.setText("Saved in Downloads/AntyShare");
                    pbTransfer.setProgress(100);
                    Toast.makeText(ReceiverActivity.this, "🎉 Files saved into Downloads/AntyShare!", Toast.LENGTH_LONG).show();
                });
            }

            @Override
            public void onError(String message) {
                runOnUiThread(() -> {
                    tvFileName.setText("⚠️ " + message);
                    Toast.makeText(ReceiverActivity.this, message, Toast.LENGTH_LONG).show();
                });
            }
        });
    }
}
