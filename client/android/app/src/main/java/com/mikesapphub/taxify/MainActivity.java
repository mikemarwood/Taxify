package com.mikesapphub.taxify;

import android.Manifest;
import android.os.Build;
import android.os.Bundle;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    private final ActivityResultLauncher<String> notificationPermissionLauncher =
        registerForActivityResult(new ActivityResultContracts.RequestPermission(), granted -> {});

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // The real build number, appended to the user agent.
        //
        // capacitor.config.json hard-codes TaxifyAndroid/1, so every build ever
        // installed told the server it was version 1 and was offered an update
        // it already had. Taken from BuildConfig, it cannot fall behind the
        // versionCode it is reporting against.
        if (getBridge() != null && getBridge().getWebView() != null) {
            android.webkit.WebSettings settings = getBridge().getWebView().getSettings();
            String ua = settings.getUserAgentString();
            if (ua != null && !ua.contains("TaxifyAndroid/" + BuildConfig.VERSION_CODE)) {
                settings.setUserAgentString(
                    ua.replaceAll("\\s*TaxifyAndroid/\\d+", "") + " TaxifyAndroid/" + BuildConfig.VERSION_CODE
                );
            }
        }

        NotificationHelper.ensureChannel(this);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && !NotificationHelper.hasPermission(this)) {
            notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS);
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        UpdateManager.check(this);
    }
}
