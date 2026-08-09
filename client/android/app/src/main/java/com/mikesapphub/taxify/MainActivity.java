package com.mikesapphub.taxify;

import android.Manifest;
import android.content.Intent;
import android.net.Uri;
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

        openLink(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        // launchMode is singleTask, so a second link while the app is already
        // running arrives here rather than through onCreate. Stored as well as
        // handled, or getIntent() keeps returning whatever started the app.
        setIntent(intent);
        openLink(intent);
    }

    /**
     * Go to the page an emailed link asked for.
     *
     * The app loads taxify.mikesapphub.com in a webview, and Android now hands
     * us links to that host (see the intent filter in AndroidManifest.xml). It
     * hands us the URL and nothing else — without this the app would open on
     * whatever page it was last on, which for a password reset or an
     * accountant invitation is the wrong page and no way to reach the right
     * one.
     *
     * The host is checked again here rather than trusted from the filter. An
     * intent can be sent by any app on the device, and this method turns one
     * into a page load inside a signed-in session.
     */
    private void openLink(Intent intent) {
        if (intent == null || !Intent.ACTION_VIEW.equals(intent.getAction())) return;

        final Uri data = intent.getData();
        if (data == null) return;
        if (!"https".equalsIgnoreCase(data.getScheme())) return;
        if (!"taxify.mikesapphub.com".equalsIgnoreCase(data.getHost())) return;

        if (getBridge() == null || getBridge().getWebView() == null) return;
        final android.webkit.WebView view = getBridge().getWebView();

        // Posted rather than called straight out. In onCreate the bridge has
        // only just been told to load the start URL; loading a second one in
        // the same tick races it, and which of the two wins is a coin toss.
        // The delay is enough for that first load to have been issued — this
        // one then replaces it, which is what was wanted either way.
        view.postDelayed(() -> view.loadUrl(data.toString()), 350);
    }

    @Override
    public void onResume() {
        super.onResume();
        UpdateManager.check(this);
    }
}
