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

                // The floor below which this build must not go on being used.
                //
                // Absent or zero means every update is optional, which is the
                // right default — forcing people through an installer for a
                // change of wording is contempt for their time. It is set on
                // the release that fixes something the app is actively getting
                // wrong, where carrying on is worse than the interruption.
                int minVersionCode = json.optInt("minVersionCode", 0);

                int localVersionCode = BuildConfig.VERSION_CODE;
                boolean required = localVersionCode < minVersionCode;

                if (remoteVersionCode > localVersionCode) {
                    new Handler(Looper.getMainLooper()).post(() ->
                        promptUpdate(context, apkUrl, versionName, required));
                }
            } catch (Exception ignored) {
                // No network, or server unreachable — silently skip the check.
            }
        }).start();
    }

    private static void promptUpdate(Context context, String apkUrl, String versionName, boolean required) {
        // No notification for a required update. The dialog is already in
        // front of them and cannot be dismissed; a notification about it would
        // be telling somebody something they are currently looking at.
        if (!required) {
            NotificationHelper.ensureChannel(context);
            NotificationHelper.notify(
                context,
                context.getString(R.string.update_available_title),
                context.getString(R.string.update_available_message),
                null
            );
        }

        String named = versionName != null && !versionName.isEmpty() ? "Taxify " + versionName : "A new version";

        AlertDialog.Builder builder = new AlertDialog.Builder(context)
            .setTitle(required
                ? context.getString(R.string.update_required_title)
                : context.getString(R.string.update_available_title))
            .setMessage(required
                ? named + " is needed before you can carry on. This one fixes something the version you have gets"
                    + " wrong, so there is no sensible way to keep using it."
                : named + " is ready to install.")
            .setPositiveButton(R.string.update_action, (dialog, which) -> downloadAndInstall(context, apkUrl));

        if (required) {
            // No Later, no back button, no tapping outside. Every other way out
            // of this dialog leaves somebody using a build we know is wrong.
            builder.setCancelable(false);
        } else {
            builder.setNegativeButton(R.string.update_later, null).setCancelable(true);
        }

        builder.show();
    }

    private static void downloadAndInstall(Context context, String apkUrl) {
        String fileName = "taxify-update.apk";

        // DownloadManager refuses to write over a file that is already there,
        // and every update downloads to this same name. So the first update
        // worked and every one after it failed — which is what "update failed
        // every time" looks like once you have updated once.
        //
        // Clearing it also means a part-finished download from a dropped
        // connection is never left to be mistaken for a complete one.
        java.io.File previous = new java.io.File(context.getExternalFilesDir(null), fileName);
        if (previous.exists() && !previous.delete()) {
            android.util.Log.w("UpdateManager", "Could not remove the previous download at " + previous);
        }

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
