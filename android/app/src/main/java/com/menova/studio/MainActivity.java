package com.menova.studio;

import android.animation.ObjectAnimator;
import android.animation.ValueAnimator;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.res.ColorStateList;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.os.Environment;
import android.util.Base64;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.CookieManager;
import android.webkit.SslErrorHandler;
import android.net.http.SslError;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import java.io.OutputStream;

public final class MainActivity extends Activity {
    private static final int PICK_MODEL = 100;
    private static final int SAVE_RENDER = 101;
    private static final int BACKGROUND = Color.rgb(16, 20, 21);
    private static final int GOLD = Color.rgb(54, 191, 166);
    private final Handler handler = new Handler(Looper.getMainLooper());
    private WebView webView;
    private ScrollView loading;
    private TextView loadingTitle;
    private TextView loadingMessage;
    private ProgressBar spinner;
    private Button retry;
    private ObjectAnimator pulse;
    private ValueCallback<Uri[]> fileCallback;
    private String pendingRender;
    private String lastInternalUrl = BuildConfig.SITE_URL;
    private boolean failed;
    private boolean loadingPage;
    private long loadStarted;
    private final Runnable timeout = () -> {
        if (loadingPage) {
            showError();
            webView.stopLoading();
        }
    };
    private final Runnable revealPage = () -> {
        if (!failed && !loadingPage) {
            loading.setVisibility(View.GONE);
            webView.setVisibility(View.VISIBLE);
            pulse.cancel();
        }
    };

    @Override
    @SuppressLint("SetJavaScriptEnabled")
    public void onCreate(Bundle state) {
        super.onCreate(state);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(BACKGROUND);
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            if (android.os.Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets bars = insets.getInsets(
                        WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout()
                                | WindowInsets.Type.ime());
                view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
                return WindowInsets.CONSUMED;
            } else {
                view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                        insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
                return insets.consumeSystemWindowInsets();
            }
        });

        FrameLayout content = new FrameLayout(this);
        root.addView(content, new LinearLayout.LayoutParams(-1, 0, 1));
        webView = new WebView(this);
        webView.setBackgroundColor(BACKGROUND);
        content.addView(webView, new FrameLayout.LayoutParams(-1, -1));
        createLoadingScreen(content);
        setContentView(root);

        WebSettings settings = webView.getSettings();
        settings.setUserAgentString(settings.getUserAgentString() + " ArchvizAndroid/" + BuildConfig.VERSION_NAME);
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSupportMultipleWindows(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, false);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String url = request.getUrl().toString();
                if (NavigationPolicy.isInternal(url)
                        && "1".equals(request.getUrl().getQueryParameter("archvizOpenBrowser"))) {
                    if (request.isForMainFrame() && request.hasGesture()) {
                        Uri.Builder browserUrl = request.getUrl().buildUpon().clearQuery();
                        for (String key : request.getUrl().getQueryParameterNames()) {
                            if ("archvizOpenBrowser".equals(key)) continue;
                            for (String value : request.getUrl().getQueryParameters(key)) {
                                browserUrl.appendQueryParameter(key, value);
                            }
                        }
                        openExternal(browserUrl.build().toString());
                    }
                    return true;
                }
                if (NavigationPolicy.isInternal(url)) return false;
                if (request.isForMainFrame() && request.hasGesture()) openExternal(url);
                return true;
            }

            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                if (!NavigationPolicy.isInternal(url)) {
                    view.stopLoading();
                    showError();
                    return;
                }
                lastInternalUrl = url;
                showLoading();
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                if (failed) return;
                loadingPage = false;
                handler.removeCallbacks(timeout);
                CookieManager.getInstance().flush();
                handler.postDelayed(revealPage, Math.max(0, 650 - (SystemClock.uptimeMillis() - loadStarted)));
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) showError();
            }

            @Override
            public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
                if (request.isForMainFrame()) showError();
            }

            @Override
            public void onReceivedSslError(WebView view, SslErrorHandler sslHandler, SslError error) {
                sslHandler.cancel();
                showError();
            }

            @Override
            public void doUpdateVisitedHistory(WebView view, String url, boolean isReload) {
                if (NavigationPolicy.isInternal(url)) lastInternalUrl = url;
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                    FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                Intent picker = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                picker.addCategory(Intent.CATEGORY_OPENABLE);
                picker.setType("*/*");
                picker.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
                try {
                    startActivityForResult(Intent.createChooser(picker, getString(R.string.choose_model)), PICK_MODEL);
                } catch (ActivityNotFoundException exception) {
                    fileCallback.onReceiveValue(null);
                    fileCallback = null;
                    toast(R.string.no_handler);
                }
                return true;
            }
        });
        webView.setDownloadListener(this::download);
        showLoading();
        if (state == null || webView.restoreState(state) == null) {
            webView.loadUrl(lastInternalUrl);
        } else {
            String restoredUrl = webView.getUrl();
            if (NavigationPolicy.isInternal(restoredUrl)) lastInternalUrl = restoredUrl;
            webView.loadUrl(lastInternalUrl);
        }
    }

    private void createLoadingScreen(FrameLayout content) {
        loading = new ScrollView(this);
        loading.setFillViewport(true);
        loading.setBackgroundColor(BACKGROUND);
        LinearLayout loadingContent = new LinearLayout(this);
        loadingContent.setOrientation(LinearLayout.VERTICAL);
        loadingContent.setGravity(Gravity.CENTER);
        loadingContent.setPadding(dp(24), dp(24), dp(24), dp(24));
        loading.addView(loadingContent, new ScrollView.LayoutParams(-1, -2));
        ImageView mark = new ImageView(this);
        mark.setImageResource(R.drawable.menova_mark);
        mark.setContentDescription(getString(R.string.app_name));
        mark.setScaleType(ImageView.ScaleType.FIT_CENTER);
        loadingContent.addView(mark, new LinearLayout.LayoutParams(dp(104), dp(104)));
        TextView productName = new TextView(this);
        productName.setText(R.string.app_name);
        productName.setTextColor(Color.WHITE);
        productName.setTextSize(40);
        productName.setGravity(Gravity.CENTER);
        productName.setTypeface(android.graphics.Typeface.create("sans-serif-medium", android.graphics.Typeface.NORMAL));
        productName.setPadding(0, dp(20), 0, dp(8));
        loadingContent.addView(productName);
        TextView company = new TextView(this);
        company.setText(R.string.powered_by);
        company.setTextColor(Color.LTGRAY);
        company.setTextSize(12);
        company.setGravity(Gravity.CENTER);
        loadingContent.addView(company);
        spinner = new ProgressBar(this);
        spinner.setIndeterminateTintList(ColorStateList.valueOf(GOLD));
        LinearLayout.LayoutParams spinnerParams = new LinearLayout.LayoutParams(dp(28), dp(28));
        spinnerParams.topMargin = dp(28);
        loadingContent.addView(spinner, spinnerParams);
        loadingTitle = new TextView(this);
        loadingTitle.setTextColor(Color.WHITE);
        loadingTitle.setTextSize(17);
        loadingTitle.setGravity(Gravity.CENTER);
        loadingTitle.setPadding(0, dp(20), 0, dp(8));
        loadingTitle.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
        loadingContent.addView(loadingTitle);
        loadingMessage = new TextView(this);
        loadingMessage.setText(R.string.connection_message);
        loadingMessage.setTextColor(Color.LTGRAY);
        loadingMessage.setGravity(Gravity.CENTER);
        loadingContent.addView(loadingMessage);
        retry = new Button(this);
        retry.setText(R.string.retry);
        retry.setTextColor(Color.WHITE);
        retry.setOnClickListener(view -> webView.loadUrl(lastInternalUrl));
        loadingContent.addView(retry);
        content.addView(loading, new FrameLayout.LayoutParams(-1, -1));
        pulse = ObjectAnimator.ofFloat(mark, View.ALPHA, 0.45f, 1f);
        pulse.setDuration(850);
        pulse.setRepeatMode(ValueAnimator.REVERSE);
        pulse.setRepeatCount(ValueAnimator.INFINITE);
    }

    private void showLoading() {
        handler.removeCallbacks(timeout);
        handler.removeCallbacks(revealPage);
        failed = false;
        loadingPage = true;
        loadStarted = SystemClock.uptimeMillis();
        loading.setVisibility(View.VISIBLE);
        webView.setVisibility(View.INVISIBLE);
        loadingTitle.setText(R.string.loading);
        loadingMessage.setVisibility(View.GONE);
        retry.setVisibility(View.GONE);
        spinner.setVisibility(View.VISIBLE);
        if (!pulse.isStarted()) pulse.start();
        handler.postDelayed(timeout, 30000);
    }

    private void showError() {
        handler.removeCallbacks(timeout);
        handler.removeCallbacks(revealPage);
        failed = true;
        loadingPage = false;
        pulse.end();
        loading.setVisibility(View.VISIBLE);
        webView.setVisibility(View.INVISIBLE);
        spinner.setVisibility(View.GONE);
        loadingTitle.setText(R.string.connection_error);
        loadingMessage.setVisibility(View.VISIBLE);
        retry.setVisibility(View.VISIBLE);
    }

    private void openExternal(String url) {
        if (!NavigationPolicy.isExternalAllowed(url)) return;
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
        } catch (ActivityNotFoundException exception) {
            toast(R.string.no_handler);
        }
    }

    private void download(String url, String userAgent, String disposition, String mimeType, long size) {
        if (url.startsWith("data:image/png;base64,") && url.length() <= 64 * 1024 * 1024) {
            if (pendingRender != null) return;
            pendingRender = url.substring(url.indexOf(',') + 1);
            Intent save = new Intent(Intent.ACTION_CREATE_DOCUMENT);
            save.addCategory(Intent.CATEGORY_OPENABLE);
            save.setType("image/png");
            save.putExtra(Intent.EXTRA_TITLE, "archviz-render-" + System.currentTimeMillis() + ".png");
            try {
                startActivityForResult(save, SAVE_RENDER);
            } catch (ActivityNotFoundException exception) {
                pendingRender = null;
                toast(R.string.download_failed);
            }
            return;
        }
        if (!URLUtil.isHttpsUrl(url)) {
            toast(R.string.download_failed);
            return;
        }
        try {
            String filename = URLUtil.guessFileName(url, disposition, mimeType);
            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
            request.setTitle(filename);
            request.setMimeType(mimeType);
            request.addRequestHeader("User-Agent", userAgent);
            String cookies = CookieManager.getInstance().getCookie(url);
            if (cookies != null) request.addRequestHeader("Cookie", cookies);
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            request.setDestinationInExternalFilesDir(this, Environment.DIRECTORY_DOWNLOADS, filename);
            getSystemService(DownloadManager.class).enqueue(request);
            toast(R.string.download_started);
        } catch (IllegalArgumentException | SecurityException exception) {
            toast(R.string.download_failed);
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == PICK_MODEL && fileCallback != null) {
            Uri[] selected = null;
            if (resultCode == RESULT_OK && data != null) {
                if (data.getClipData() != null) {
                    int count = data.getClipData().getItemCount();
                    selected = new Uri[count];
                    for (int index = 0; index < count; index++) {
                        selected[index] = data.getClipData().getItemAt(index).getUri();
                    }
                } else if (data.getData() != null) {
                    selected = new Uri[]{data.getData()};
                }
            }
            fileCallback.onReceiveValue(selected);
            fileCallback = null;
        }
        if (requestCode == SAVE_RENDER) {
            String render = pendingRender;
            pendingRender = null;
            if (resultCode != RESULT_OK || data == null || data.getData() == null) return;
            if (render == null) {
                toast(R.string.download_failed);
                return;
            }
            Uri destination = data.getData();
            new Thread(() -> {
                try (OutputStream output = getContentResolver().openOutputStream(destination)) {
                    if (output == null) throw new java.io.IOException("No output stream");
                    output.write(Base64.decode(render, Base64.DEFAULT));
                    runOnUiThread(() -> toast(R.string.download_saved));
                } catch (java.io.IOException | IllegalArgumentException | SecurityException exception) {
                    runOnUiThread(() -> toast(R.string.download_failed));
                }
            }, "menova-save-render").start();
        }
    }

    private void goBack() {
        if (webView.canGoBack()) webView.goBack();
        else finish();
    }

    @Override
    public void onBackPressed() {
        goBack();
    }

    @Override
    protected void onSaveInstanceState(Bundle state) {
        webView.saveState(state);
        super.onSaveInstanceState(state);
    }

    @Override
    protected void onPause() {
        webView.onPause();
        pulse.pause();
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        webView.onResume();
        pulse.resume();
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        pulse.cancel();
        if (fileCallback != null) fileCallback.onReceiveValue(null);
        webView.destroy();
        super.onDestroy();
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private void toast(int message) {
        Toast.makeText(this, message, Toast.LENGTH_LONG).show();
    }
}