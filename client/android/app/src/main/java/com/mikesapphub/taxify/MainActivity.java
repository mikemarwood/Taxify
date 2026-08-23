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

        // Downloads. Without this, every one of them silently does nothing.
        //
        // A webview has no download manager of its own. When a navigation comes
        // back as Content-Disposition: attachment — which is every receipt,
        // every export and every archive — the webview cannot render it, so it
        // hands the URL to a DownloadListener. With none set, that is the end of
        // it: no file, no error, nothing in the log. Pressing Download in the
        // app did nothing whatsoever, which is why it looked like a dead button.
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().setDownloadListener(this::downloadThroughSystem);
        }

        NotificationHelper.ensureChannel(this);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && !NotificationHelper.hasPermission(this)) {
            notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS);
        }

        openLink(getIntent());
    }

    /**
     * Hand a download to Android's own download manager.
     *
     * Two things matter here beyond enqueuing it.
     *
     * The cookie. Every one of these files is behind a login, and the download
     * manager makes its own request from outside the webview with none of its
     * state — so without the session cookie copied across, the server answers
     * every download with a sign-in page and the user gets an HTML file called
     * receipt.pdf.
     *
     * And where it lands. The public Downloads folder is where somebody will
     * look for it, but writing there needs a permission on Android 9 and below.
     * Rather than ask for storage access on a modern phone that does not need
     * it, the public folder is tried and the app's own downloads folder catches
     * the fall — a file in an awkward place beats no file.
     */
    private void downloadThroughSystem(
        String url,
        String userAgent,
        String contentDisposition,
        String mimeType,
        long contentLength
    ) {
        if (url == null || !(url.startsWith("http://") || url.startsWith("https://"))) {
            // blob: and data: cannot be fetched by the download manager, which
            // has no access to the page that made them. The web side keeps those
            // off this path — see useYearArchive.js.
            android.widget.Toast.makeText(this, "That file could not be saved", android.widget.Toast.LENGTH_SHORT).show();
            return;
        }

        final String name = android.webkit.URLUtil.guessFileName(url, contentDisposition, mimeType);

        try {
            android.app.DownloadManager.Request request = new android.app.DownloadManager.Request(Uri.parse(url));

            String cookie = android.webkit.CookieManager.getInstance().getCookie(url);
            if (cookie != null) request.addRequestHeader("Cookie", cookie);
            if (userAgent != null) request.addRequestHeader("User-Agent", userAgent);

            request.setTitle(name);
            request.setDescription("Taxify");
            if (mimeType != null) request.setMimeType(mimeType);
            request.setNotificationVisibility(
                android.app.DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED
            );

            try {
                request.setDestinationInExternalPublicDir(android.os.Environment.DIRECTORY_DOWNLOADS, name);
            } catch (Exception outside) {
                request.setDestinationInExternalFilesDir(this, android.os.Environment.DIRECTORY_DOWNLOADS, name);
            }

            android.app.DownloadManager manager =
                (android.app.DownloadManager) getSystemService(android.content.Context.DOWNLOAD_SERVICE);
            if (manager == null) throw new IllegalStateException("no download manager on this device");
            manager.enqueue(request);

            android.widget.Toast.makeText(this, "Saving " + name, android.widget.Toast.LENGTH_SHORT).show();
        } catch (Exception err) {
            android.util.Log.e("Taxify", "Could not download " + name, err);
            android.widget.Toast.makeText(this, "Could not save " + name, android.widget.Toast.LENGTH_LONG).show();
        }
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
