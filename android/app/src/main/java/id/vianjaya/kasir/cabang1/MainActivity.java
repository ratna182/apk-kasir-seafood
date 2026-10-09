package id.vianjaya.kasir.cabang1;

import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;

import com.getcapacitor.BridgeWebViewClient;
import com.getcapacitor.BridgeActivity;
import com.imin.printer.INeoPrinterCallback;
import com.imin.printer.InitPrinterCallback;
import com.imin.printer.PrinterHelper;

import org.json.JSONObject;

import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

public class MainActivity extends BridgeActivity {
    private static final String TAG = "IMinPrinter";
    private static final String NAV_TAG = "NavTrace";
    private final AtomicBoolean printerConnected = new AtomicBoolean(false);
    private final AtomicBoolean isInitializing = new AtomicBoolean(false);
    private final ExecutorService printExecutor = Executors.newSingleThreadExecutor();
    private final Map<String, String> recentJobs = new ConcurrentHashMap<>();
    private final Map<String, Long> recentJobTimes = new ConcurrentHashMap<>();
    private final Map<String, Boolean> processingJobs = new ConcurrentHashMap<>();
    private CountDownLatch connectionLatch;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WebView webView = getBridge().getWebView();
        webView.addJavascriptInterface(new IMinPrinterBridge(), "IMinPrinter");
        webView.setWebViewClient(new BridgeWebViewClient(getBridge()) {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Log.d(NAV_TAG, "url=" + request.getUrl());
                return super.shouldOverrideUrlLoading(view, request);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                Log.d(NAV_TAG, "page=" + url);
                view.evaluateJavascript("(() => { window.print = () => console.warn('NavTrace: window.print blocked in APK'); window.open = () => { console.warn('NavTrace: window.open blocked in APK'); return null; }; })()", null);
            }
        });
        initPrinterService();
    }

    @Override
    public void onResume() {
        super.onResume();
        if (!printerConnected.get() && !isInitializing.get()) initPrinterService();
    }

    @Override
    public void onDestroy() {
        printExecutor.shutdownNow();
        try { PrinterHelper.getInstance().deInitPrinterService(this); } catch (Exception error) { Log.e(TAG, "deinit failed", error); }
        super.onDestroy();
    }

    private void initPrinterService() {
        if (isInitializing.getAndSet(true)) return;
        connectionLatch = new CountDownLatch(1);
        Log.d(TAG, "Initializing printer service");
        try {
            PrinterHelper.getInstance().initPrinterService(this, new InitPrinterCallback() {
                @Override public void onConnected() {
                    printerConnected.set(true); isInitializing.set(false);
                    if (connectionLatch != null) connectionLatch.countDown();
                    Log.d(TAG, "Printer service connected");
                }
                @Override public void onDisconnected() {
                    printerConnected.set(false); isInitializing.set(false);
                    if (connectionLatch != null) connectionLatch.countDown();
                    Log.d(TAG, "Printer service disconnected");
                    new Handler(Looper.getMainLooper()).postDelayed(() -> {
                        if (!printerConnected.get() && !isInitializing.get()) initPrinterService();
                    }, 3000);
                }
            });
        } catch (Exception error) {
            isInitializing.set(false);
            if (connectionLatch != null) connectionLatch.countDown();
            Log.e(TAG, "Printer init failed", error);
        }
    }

    private boolean waitForConnection() throws InterruptedException {
        if (!printerConnected.get()) {
            if (!isInitializing.get()) initPrinterService();
            CountDownLatch latch = connectionLatch;
            if (latch != null) latch.await(3, TimeUnit.SECONDS);
        }
        return printerConnected.get();
    }

    private String result(boolean ok, String status, String error, int attempts) {
        try {
            JSONObject json = new JSONObject();
            json.put("ok", ok); json.put("status", status); json.put("error", error == null ? JSONObject.NULL : error); json.put("attempts", attempts);
            return json.toString();
        } catch (Exception ignored) { return "{\"ok\":false,\"status\":\"failed\",\"error\":\"result error\",\"attempts\":0}"; }
    }

    private final class IMinPrinterBridge {
        @JavascriptInterface public boolean isSupported() { return true; }

        @JavascriptInterface public boolean connect() {
            try { if (!printerConnected.get() && !isInitializing.get()) initPrinterService(); return printerConnected.get(); }
            catch (Exception error) { Log.e(TAG, "connect failed", error); return false; }
        }

        @JavascriptInterface public void disconnect() {
            try { printerConnected.set(false); } catch (Exception error) { Log.e(TAG, "disconnect failed", error); }
        }

        @JavascriptInterface public String printJob(String jobId, String base64Data) {
            if (jobId == null || jobId.isEmpty()) jobId = UUID.randomUUID().toString();
            final String id = jobId;
            String previous = recentJobs.get(id);
            Long previousAt = recentJobTimes.get(id);
            if (previous != null && previousAt != null && System.currentTimeMillis() - previousAt < 60000) return previous;
            if (processingJobs.putIfAbsent(id, true) != null) return result(false, "unknown", "Job sedang diproses", 0);
            try {
                String response = printExecutor.submit(() -> printOnce(id, base64Data)).get(15, TimeUnit.SECONDS);
                if (response.contains("\"status\":\"printed\"")) {
                    recentJobs.put(id, response); recentJobTimes.put(id, System.currentTimeMillis());
                }
                return response;
            } catch (Exception error) {
                Log.e(TAG, "job failed: " + id, error);
                return result(false, "unknown", "Printer tidak memberi hasil", 1);
            } finally {
                processingJobs.remove(id);
            }
        }

        private String printOnce(String jobId, String base64Data) {
            int attempts = 0;
            for (int attempt = 1; attempt <= 3; attempt++) {
                attempts = attempt;
                Log.d(TAG, "job=" + jobId + " attempt=" + attempt);
                try {
                    if (!waitForConnection()) {
                        if (attempt == 3) return result(false, "failed", "Printer belum terhubung", attempts);
                        continue;
                    }
                    byte[] data = Base64.decode(base64Data, Base64.DEFAULT);
                    CountDownLatch done = new CountDownLatch(1);
                    AtomicBoolean success = new AtomicBoolean(false);
                    AtomicBoolean definiteFailure = new AtomicBoolean(false);
                    PrinterHelper.getInstance().sendRAWData(data, new INeoPrinterCallback() {
                        @Override public void onRunResult(boolean isSuccess) { success.set(isSuccess); definiteFailure.set(!isSuccess); done.countDown(); }
                        @Override public void onRaiseException(int code, String msg) { Log.w(TAG, "job=" + jobId + " exception=" + code + " " + msg); definiteFailure.set(true); done.countDown(); }
                        @Override public void onPrintResult(int code, String msg) { if (code == 1) success.set(true); else definiteFailure.set(true); done.countDown(); }
                        @Override public void onReturnString(String value) { }
                    });
                    if (!done.await(10, TimeUnit.SECONDS)) return result(false, "unknown", "Printer tidak memberi hasil; jangan ulang otomatis", attempts);
                    if (success.get()) return result(true, "printed", null, attempts);
                    if (!definiteFailure.get()) return result(false, "unknown", "Hasil cetak tidak diketahui", attempts);
                    printerConnected.set(false);
                } catch (InterruptedException error) {
                    Thread.currentThread().interrupt();
                    return result(false, "unknown", "Proses cetak terhenti", attempts);
                } catch (IllegalArgumentException error) {
                    return result(false, "failed", "Data struk tidak valid", attempts);
                } catch (Exception error) {
                    Log.e(TAG, "job=" + jobId + " failed", error);
                    if (attempt == 3) return result(false, "failed", "Gagal mengirim data ke printer", attempts);
                }
            }
            return result(false, "failed", "Gagal mencetak", attempts);
        }

        @JavascriptInterface public boolean print(String base64Data) {
            try { JSONObject response = new JSONObject(printJob("legacy-" + System.nanoTime(), base64Data)); return response.optBoolean("ok", false); }
            catch (Exception error) { Log.e(TAG, "legacy print failed", error); return false; }
        }

        @JavascriptInterface public String getStatus() {
            try { return !printerConnected.get() ? "idle" : PrinterHelper.getInstance().getPrinterStatus() == 0 ? "connected" : "error"; }
            catch (Exception error) { Log.e(TAG, "status failed", error); return "error"; }
        }
    }
}
