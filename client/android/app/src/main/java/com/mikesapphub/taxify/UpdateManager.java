package com.mikesapphub.taxify;

import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import androidx.core.content.FileProvider;
import org.json.JSONObject;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;

public class UpdateManager {

    private static final String VERSION_URL = "https://taxify.mikesapphub.com/api/app/version";

    public static void check(Context context) {
        new Thread(() -> {
            try {
                URL url = new URL(VERSION_URL);
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setConnectTimeout(8000);
                conn.setReadTimeout(8000);
                conn.setRequestProperty("Cache-Control", "no-cache");

                StringBuilder sb = new StringBuilder();
                try (BufferedReader reader = new BufferedReader(new InputStreamReader(conn.getInputStream()))) {
                    String line;
                    while ((line = reader.readLine()) != null) sb.append(line);
                }

                JSONObject json = new JSONObject(sb.toString());
                int remoteVersionCode = json.getInt("versionCode");
                String versionName = json.optString("versionName", "");
                String apkUrl = json.getString("url");

                int localVersionCode = BuildConfig.VERSION_CODE;

                if (remoteVersionCode > localVersionCode) {
                    new Handler(Looper.getMainLooper()).post(() ->
                        promptUpdate(context, apkUrl, versionName));
                }
            } catch (Exception ignored) {
                // No network, or server unreachable — silently skip the check.
            }
        }).start();
    }

    private static void promptUpdate(Context context, String apkUrl, String versionName) {
        NotificationHelper.ensureChannel(context);
        NotificationHelper.notify(
            context,
            context.getString(R.string.update_available_title),
            context.getString(R.string.update_available_message),
            null
        );

        new AlertDialog.Builder(context)
            .setTitle(context.getString(R.string.update_available_title))
            .setMessage(versionName != null && !versionName.isEmpty()
                ? "Taxify " + versionName + " is ready to install."
                : context.getString(R.string.update_available_message))
            .setPositiveButton(R.string.update_action, (dialog, which) -> downloadAndInstall(context, apkUrl))
            .setNegativeButton(R.string.update_later, null)
            .setCancelable(true)
            .show();
    }

    private static void downloadAndInstall(Context context, String apkUrl) {
        String fileName = "taxify-update.apk";
        DownloadManager.Request request = new DownloadManager.Request(Uri.parse(apkUrl));
        request.setTitle("Taxify update");
        request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
        request.setDestinationInExternalFilesDir(context, null, fileName);

        DownloadManager downloadManager = (DownloadManager) context.getSystemService(Context.DOWNLOAD_SERVICE);
        long downloadId = downloadManager.enqueue(request);

        BroadcastReceiver receiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context ctx, Intent intent) {
                long completedId = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1);
                if (completedId != downloadId) return;
                ctx.unregisterReceiver(this);
                installApk(ctx, context.getExternalFilesDir(null) + "/" + fileName);
            }
        };

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            context.registerReceiver(
                receiver,
                new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE),
                Context.RECEIVER_NOT_EXPORTED
            );
        } else {
            context.registerReceiver(receiver, new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE));
        }
    }

    private static void installApk(Context context, String filePath) {
        java.io.File file = new java.io.File(filePath);
        Uri apkUri = FileProvider.getUriForFile(context, context.getPackageName() + ".fileprovider", file);

        Intent installIntent = new Intent(Intent.ACTION_VIEW);
        installIntent.setDataAndType(apkUri, "application/vnd.android.package-archive");
        installIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
        context.startActivity(installIntent);
    }
}
