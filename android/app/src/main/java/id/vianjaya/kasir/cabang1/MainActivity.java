package id.vianjaya.kasir.cabang1;

import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.Build;
import android.util.Base64;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;

import com.getcapacitor.BridgeWebViewClient;
import com.getcapacitor.BridgeActivity;
import com.imin.printer.INeoPrinterCallback;
import com.imin.printer.InitPrinterCallback;
import com.imin.printer.PrinterHelper;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

public class MainActivity extends BridgeActivity {
    private static final String TAG = "IminPrinter";
    private static final String NAV_TAG = "NavTrace";
    /**
     * The iMin SDK path is parked, not deleted: this firmware has no com.imin.printerservice,
     * only com.imin.printerPlugin with a different AIDL. Flip the flag back if a matching SDK ships.
     */
    private static final boolean USE_IMIN_SDK = false;
    private static final String SERVICE_PACKAGE = "com.imin.printerservice";
    private static final String SERVICE_CLASS = "com.imin.printerservice.core.ApiAdapterManager.NeoPrinterService";
    private static final String SERVICE_ACTION = "com.imin.printerservice.NeoPrinterService";
    private static final String CONNECT_TYPE = "sdk-default/unknown";
    private static final String PATH_SPP = "spp";
    private static final long CONNECT_TIMEOUT_MS = 5000L;
    private static final int MAX_PRINT_ATTEMPTS = 3;
    private static final long RETRY_GAP_MS = 250L;

    private final AtomicBoolean isInitializing = new AtomicBoolean(false);
    private final ExecutorService printExecutor = Executors.newSingleThreadExecutor();
    private final Map<String, String> recentJobs = new ConcurrentHashMap<>();
    private final Map<String, Long> recentJobTimes = new ConcurrentHashMap<>();
    private final Map<String, Boolean> processingJobs = new ConcurrentHashMap<>();
    private final JSONObject diagnosticData = new JSONObject();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    private SppPrinter sppPrinter;
    private volatile String connectionState = "idle";
    private volatile long connectionAttempt;
    private volatile Boolean bindResult;
    private volatile Boolean servicePackageInstalled;
    private volatile String servicePackageVersion;
    private volatile String diagnosticStage = "idle";
    private volatile String diagnosticErrorClass = "";
    private volatile String diagnosticErrorMessage = "";
    private volatile String diagnosticUserMessage = "";
    private volatile Integer diagnosticStatusCode;
    private volatile String packageDiagnosticErrorClass = "";
    private volatile String pathUsed = PATH_SPP;
    private volatile String paperWidth = SppPrinter.normalizePaperWidth(null);
    private volatile int bytesSent;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        sppPrinter = new SppPrinter(this);
        sppPrinter.refreshState();
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
    }

    @Override
    public void onResume() {
        super.onResume();
        // Cached state only: no socket, no SDK bind.
        if (sppPrinter != null) {
            sppPrinter.refreshState();
            connectionState = sppPrinter.connectionState();
        }
    }

    @Override
    public void onDestroy() {
        printExecutor.shutdownNow();
        if (sppPrinter != null) sppPrinter.shutdown();
        mainHandler.removeCallbacksAndMessages(null);
        super.onDestroy();
    }

    private String now() {
        return new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSZ", java.util.Locale.US).format(new java.util.Date());
    }

    private String clock() {
        return new java.text.SimpleDateFormat("HH.mm.ss", java.util.Locale.US).format(new java.util.Date());
    }

    private void recordDiagnostic(String key, Object value) {
        synchronized (diagnosticData) {
            try { diagnosticData.put(key, value == null ? JSONObject.NULL : value); } catch (Exception ignored) { }
        }
    }

    private JSONObject exceptionDetails(Throwable error) {
        JSONObject details = new JSONObject();
        try {
            details.put("class", error.getClass().getName());
            details.put("message", error.getMessage() == null ? error.toString() : error.getMessage());
        } catch (Exception ignored) { }
        return details;
    }

    private JSONObject diagnosticsSnapshot() {
        JSONObject snapshot = new JSONObject();
        try {
            snapshot.put("manufacturer", Build.MANUFACTURER);
            snapshot.put("model", Build.MODEL);
            snapshot.put("sdkInt", Build.VERSION.SDK_INT);
            snapshot.put("targetSdk", getApplicationInfo().targetSdkVersion);
            snapshot.put("appVersion", appVersionJson());
            snapshot.put("bluetoothEnabled", sppPrinter != null && sppPrinter.bluetoothEnabled());
            snapshot.put("sdkEnabled", USE_IMIN_SDK);
            snapshot.put("bondedDevices", sppPrinter == null ? new JSONArray() : sppPrinter.bondedDevices());
            snapshot.put("selectedMac", sppPrinter == null ? "" : sppPrinter.selectedMac());
            snapshot.put("selectionReason", sppPrinter == null ? "none" : sppPrinter.selectionReason());
            snapshot.put("connectResult", diagnosticStage);
            snapshot.put("bytesSent", bytesSent);
            snapshot.put("connectionState", connectionState);
            snapshot.put("lastConnectAt", sppPrinter == null ? 0L : sppPrinter.lastConnectAt());
            synchronized (diagnosticData) {
                java.util.Iterator<String> keys = diagnosticData.keys();
                while (keys.hasNext()) {
                    String key = keys.next();
                    snapshot.put(key, diagnosticData.get(key));
                }
            }
        } catch (Exception ignored) { }
        return snapshot;
    }

    private String appVersionJson() {
        try {
            PackageInfo info = getPackageManager().getPackageInfo(getPackageName(), 0);
            JSONObject json = new JSONObject();
            json.put("versionName", info.versionName);
            json.put("versionCode", info.versionCode);
            return json.toString();
        } catch (Exception error) {
            return "unknown";
        }
    }

    private String statusText(Integer status) {
        if (status == null) return "unknown";
        switch (status) {
            case 0: return "normal";
            case -1:
            case 1: return "tidak terhubung/mati";
            case 3: return "print head terbuka";
            case 7: return "kertas habis";
            case 8: return "kertas hampir habis";
            default: return "error lain";
        }
    }

    private String result(boolean ok, String status, String error, int attempts) {
        try {
            JSONObject json = new JSONObject();
            json.put("ok", ok); json.put("status", status); json.put("error", error == null ? JSONObject.NULL : error); json.put("attempts", attempts);
            json.put("stage", diagnosticStage);
            json.put("errorClass", error == null ? diagnosticErrorClass : (diagnosticErrorClass.isEmpty() ? "printer-error" : diagnosticErrorClass));
            json.put("errorMessage", error == null ? diagnosticErrorMessage : error);
            json.put("bindResult", bindResult == null ? JSONObject.NULL : bindResult);
            json.put("servicePackageInstalled", servicePackageInstalled == null ? JSONObject.NULL : servicePackageInstalled);
            json.put("servicePackageVersion", servicePackageVersion == null ? JSONObject.NULL : servicePackageVersion);
            json.put("statusCode", diagnosticStatusCode == null ? JSONObject.NULL : diagnosticStatusCode);
            json.put("statusText", statusText(diagnosticStatusCode));
            json.put("connectionState", connectionState);
            json.put("connectType", CONNECT_TYPE);
            json.put("path", pathUsed);
            json.put("userMessage", ok ? JSONObject.NULL : userMessage());
            json.put("manufacturer", Build.MANUFACTURER);
            json.put("model", Build.MODEL);
            json.put("sdkInt", Build.VERSION.SDK_INT);
            json.put("targetSdk", getApplicationInfo().targetSdkVersion);
            json.put("iminSdkVersion", "V2.0.0.18");
            json.put("timestamp", clock());
            json.put("packageDiagnosticErrorClass", packageDiagnosticErrorClass.isEmpty() ? JSONObject.NULL : packageDiagnosticErrorClass);
            json.put("paperWidthMm", EscPosReceiptBuilder.paperWidthMm(paperWidth));
            json.put("columns", EscPosReceiptBuilder.columnsForPaperWidth(paperWidth));
            json.put("bluetoothEnabled", sppPrinter != null && sppPrinter.bluetoothEnabled());
            json.put("sdkEnabled", USE_IMIN_SDK);
            json.put("diagnostics", diagnosticsSnapshot());
            return json.toString();
        } catch (Throwable ignored) { return "{\"ok\":false,\"status\":\"failed\",\"error\":\"result error\",\"attempts\":0}"; }
    }

    private String userMessage() {
        if (!diagnosticUserMessage.isEmpty()) return diagnosticUserMessage;
        return "Printer belum siap. Pastikan printer menyala dan kertas terpasang, lalu coba lagi.";
    }

    /** Copies the outcome of an SPP call into diagnostics and the cached error fields. */
    private void absorbSpp(JSONObject spp) {
        try {
            if (spp.has("bondedDevices")) recordDiagnostic("bondedDevices", spp.get("bondedDevices"));
            if (spp.has("connectResult")) recordDiagnostic("connectResult", spp.get("connectResult"));
            if (spp.has("bytesSent")) {
                bytesSent = spp.optInt("bytesSent", 0);
                recordDiagnostic("bytesSent", bytesSent);
            }
        } catch (Exception ignored) { }
        boolean ok = spp.optBoolean("ok", false);
        if (ok) {
            diagnosticErrorClass = "";
            diagnosticErrorMessage = "";
            diagnosticUserMessage = "";
        } else {
            diagnosticErrorClass = spp.optString("errorClass", "spp-failed");
            diagnosticErrorMessage = spp.optString("error", "SPP gagal mengirim data");
            diagnosticUserMessage = spp.optString("userMessage", "");
        }
    }

    private void setSppPaperWidth(String requested) {
        paperWidth = SppPrinter.normalizePaperWidth(requested);
    }

    private final class IMinPrinterBridge {
        @JavascriptInterface public boolean isSupported() {
            return true;
        }

        @JavascriptInterface public boolean connect() {
            try {
                if (USE_IMIN_SDK) return connectThroughSdk();
                if (sppPrinter == null) return false;
                diagnosticStage = "spp-connect";
                diagnosticErrorClass = "";
                diagnosticErrorMessage = "";
                diagnosticUserMessage = "";
                JSONObject probe = sppPrinter.probeConnect();
                absorbSpp(probe);
                connectionState = sppPrinter.connectionState();
                recordDiagnostic("connectAt", clock());
                recordDiagnostic("connectResult", probe.optString("connectResult", ""));
                recordDiagnostic("connectionState", connectionState);
                Log.d(TAG, "spp connect state=" + connectionState + " mac=" + sppPrinter.selectedMac());
                return probe.optBoolean("ok", false);
            } catch (Throwable error) {
                connectionState = "error";
                diagnosticStage = "spp-connect";
                diagnosticErrorClass = "spp-connect-failed";
                diagnosticErrorMessage = error.getMessage() == null ? error.toString() : error.getMessage();
                Log.e(TAG, "connect failed", error);
                return false;
            }
        }

        @JavascriptInterface public String getDiagnostics() {
            try {
                diagnosticStage = "status";
                connectionState = sppPrinter == null ? connectionState : sppPrinter.connectionState();
                return result(connectionState.equals("connected"), statusText(diagnosticStatusCode), null, 0);
            } catch (Throwable error) {
                Log.e(TAG, "error stage=status", error);
                return bridgeError("status", error);
            }
        }

        @JavascriptInterface public String tesCetakSpp(String requestedPaperWidth) {
            try {
                setSppPaperWidth(requestedPaperWidth);
                diagnosticStage = "spp-test";
                JSONObject spp = sppPrinter.printTest(paperWidth);
                absorbSpp(spp);
                connectionState = sppPrinter.connectionState();
                pathUsed = PATH_SPP;
                recordDiagnostic("sppAt", clock());
                recordDiagnostic("path", pathUsed);
                recordDiagnostic("paperWidth", paperWidth);
                return spp.toString();
            } catch (Throwable error) {
                return failure("spp-failed", error).toString();
            }
        }

        @JavascriptInterface public String getAppVersion() {
            try {
                PackageInfo info = getPackageManager().getPackageInfo(getPackageName(), 0);
                JSONObject json = new JSONObject();
                json.put("versionName", info.versionName);
                json.put("versionCode", info.versionCode);
                return json.toString();
            } catch (Throwable error) {
                Log.e(TAG, "app version failed", error);
                return bridgeError("app-version", error);
            }
        }

        @JavascriptInterface public void disconnect() {
            try {
                if (sppPrinter != null) {
                    sppPrinter.forgetConnection();
                    connectionState = sppPrinter.connectionState();
                }
                recordDiagnostic("disconnectAt", clock());
            } catch (Throwable error) {
                Log.e(TAG, "disconnect failed", error);
            }
        }

        @JavascriptInterface public String printJob(String jobId, String base64Data) {
            try { return printJobInternal(jobId, base64Data); }
            catch (Throwable error) { Log.e(TAG, "job bridge failed", error); return bridgeError("print-job", error); }
        }

        @JavascriptInterface public boolean print(String base64Data) {
            try { JSONObject response = new JSONObject(printJob("legacy-" + System.nanoTime(), base64Data)); return response.optBoolean("ok", false); }
            catch (Throwable error) { bridgeError("print", error); Log.e(TAG, "legacy print failed", error); return false; }
        }

        @JavascriptInterface public String getStatus() {
            try {
                connectionState = sppPrinter == null ? connectionState : sppPrinter.connectionState();
                Log.d(TAG, "status state=" + connectionState);
                return connectionState;
            } catch (Throwable error) { Log.e(TAG, "status failed", error); bridgeError("status", error); return "error"; }
        }
    }

    private String printJobInternal(String jobId, String base64Data) {
        setSppPaperWidth(null);
        if (jobId == null || jobId.isEmpty()) jobId = UUID.randomUUID().toString();
        final String id = jobId;
        String previous = recentJobs.get(id);
        Long previousAt = recentJobTimes.get(id);
        if (previous != null && previousAt != null && System.currentTimeMillis() - previousAt < 60000) return previous;
        if (processingJobs.putIfAbsent(id, true) != null) return result(false, "unknown", "Job sedang diproses", 0);
        try {
            String response = printExecutor.submit(() -> printOnce(id, base64Data)).get(60, TimeUnit.SECONDS);
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
        final byte[] data;
        try {
            data = Base64.decode(base64Data, Base64.DEFAULT);
        } catch (IllegalArgumentException error) {
            diagnosticErrorClass = "invalid-data";
            return result(false, "failed", "Data struk tidak valid", 0);
        }
        int attempts = 0;
        pathUsed = PATH_SPP;
        if (USE_IMIN_SDK) {
            String sdkResult = printThroughSdk(jobId, data);
            if (sdkResult != null) return sdkResult;
        }
        for (int attempt = 1; attempt <= MAX_PRINT_ATTEMPTS; attempt++) {
            attempts = attempt;
            diagnosticStage = "spp-print";
            Log.d(TAG, "job=" + jobId + " attempt=" + attempt + " paper=" + paperWidth);
            try {
                JSONObject spp = sppPrinter.print(data, paperWidth);
                absorbSpp(spp);
                connectionState = sppPrinter.connectionState();
                recordDiagnostic("sppAt", clock());
                recordDiagnostic("path", pathUsed);
                recordDiagnostic("paperWidth", paperWidth);
                if (spp.optBoolean("ok", false)) {
                    return result(true, "printed", null, attempts);
                }
            } catch (Throwable error) {
                Log.e(TAG, "job=" + jobId + " failed", error);
                diagnosticErrorClass = error.getClass().getName();
                diagnosticErrorMessage = error.getMessage() == null ? error.toString() : error.getMessage();
            }
            if (attempt < MAX_PRINT_ATTEMPTS) {
                try { Thread.sleep(RETRY_GAP_MS); }
                catch (InterruptedException error) {
                    Thread.currentThread().interrupt();
                    return result(false, "unknown", "Proses cetak terhenti", attempts);
                }
            }
        }
        return result(false, "failed", diagnosticUserMessage.isEmpty() ? diagnosticErrorMessage : diagnosticUserMessage, attempts);
    }

    private JSONObject failure(String errorClass, Throwable error) {
        try {
            JSONObject json = new JSONObject();
            json.put("ok", false);
            json.put("status", "failed");
            json.put("errorClass", errorClass);
            json.put("error", error.getMessage() == null ? error.toString() : error.getMessage());
            json.put("exception", exceptionDetails(error));
            recordDiagnostic("exception", exceptionDetails(error));
            return json;
        } catch (Exception ignored) {
            return new JSONObject();
        }
    }

    private String bridgeError(String stage, Throwable error) {
        diagnosticStage = stage;
        diagnosticErrorClass = error.getClass().getName();
        diagnosticErrorMessage = error.getMessage() == null ? error.toString() : error.getMessage();
        return result(false, "error", diagnosticErrorMessage, 0);
    }

    // iMin SDK path, kept for a future firmware with a matching AIDL. Never reached while USE_IMIN_SDK is false.
    private boolean connectThroughSdk() {
        if (!isInitializing.compareAndSet(false, true)) return false;
        connectionState = "connecting";
        diagnosticStage = "bind";
        diagnosticErrorClass = "";
        diagnosticErrorMessage = "";
        checkServicePackage();
        recordDiagnostic("bindStartedAt", clock());
        recordDiagnostic("connectType", CONNECT_TYPE);
        final long attempt = ++connectionAttempt;
        Log.d(TAG, "bind package=" + SERVICE_PACKAGE + " class=" + SERVICE_CLASS + " action=" + SERVICE_ACTION);
        try {
            bindResult = PrinterHelper.getInstance().initPrinterService(this, new InitPrinterCallback() {
                @Override public void onConnected() {
                    try {
                        diagnosticStatusCode = PrinterHelper.getInstance().getPrinterStatus();
                        isInitializing.set(false);
                        connectionState = diagnosticStatusCode != null && diagnosticStatusCode == 0 ? "connected" : "error";
                        recordDiagnostic("sdkCallback", "onConnected");
                    } catch (Throwable error) {
                        isInitializing.set(false);
                        connectionState = "error";
                        diagnosticErrorClass = "sdk-init-failed";
                        diagnosticErrorMessage = error.getMessage() == null ? error.toString() : error.getMessage();
                    }
                }
                @Override public void onDisconnected() {
                    isInitializing.set(false);
                    connectionState = "error";
                    diagnosticStage = "service-disconnected";
                    diagnosticErrorClass = "service-disconnected";
                    diagnosticErrorMessage = "Printer service disconnected";
                }
            });
            if (!Boolean.TRUE.equals(bindResult)) {
                connectionState = "error";
                diagnosticErrorClass = "bind-failed";
                diagnosticErrorMessage = "bindService returned false";
                isInitializing.set(false);
                return false;
            }
            mainHandler.postDelayed(() -> {
                if (attempt != connectionAttempt || !isInitializing.get()) return;
                connectionState = "error";
                diagnosticStage = "bind-timeout";
                diagnosticErrorClass = "bind-failed";
                diagnosticErrorMessage = "onServiceConnected tidak datang dalam 5 detik";
                ++connectionAttempt;
                isInitializing.set(false);
                stopSdkBinding();
            }, CONNECT_TIMEOUT_MS);
            return false;
        } catch (Throwable error) {
            bindResult = false;
            connectionState = "error";
            diagnosticErrorClass = "sdk-init-failed";
            diagnosticErrorMessage = error.getMessage() == null ? error.toString() : error.getMessage();
            isInitializing.set(false);
            Log.e(TAG, "error stage=bind", error);
            return false;
        }
    }

    private String printThroughSdk(String jobId, byte[] data) {
        if (!connectionState.equals("connected")) return null;
        try {
            java.util.concurrent.CountDownLatch done = new java.util.concurrent.CountDownLatch(1);
            AtomicBoolean success = new AtomicBoolean(false);
            PrinterHelper.getInstance().sendRAWData(data, new INeoPrinterCallback() {
                @Override public void onRunResult(boolean isSuccess) { success.set(isSuccess); done.countDown(); }
                @Override public void onRaiseException(int code, String msg) { done.countDown(); }
                @Override public void onPrintResult(int code, String msg) { if (code == 1) success.set(true); done.countDown(); }
                @Override public void onReturnString(String value) { }
            });
            if (!done.await(10, TimeUnit.SECONDS)) {
                diagnosticStage = "sdk-print-timeout";
                diagnosticErrorClass = "print-timeout";
                return null;
            }
            if (success.get()) {
                pathUsed = "sdk";
                return result(true, "printed", null, 0);
            }
            diagnosticErrorClass = "sdk-print-failed";
        } catch (Throwable error) {
            diagnosticErrorClass = error.getClass().getName();
            diagnosticErrorMessage = error.getMessage() == null ? error.toString() : error.getMessage();
        }
        return null;
    }

    private void stopSdkBinding() {
        try { PrinterHelper.getInstance().deInitPrinterService(this); }
        catch (Throwable error) { Log.e(TAG, "deinit failed", error); }
    }

    private void checkServicePackage() {
        try {
            PackageInfo info = getPackageManager().getPackageInfo(SERVICE_PACKAGE, 0);
            servicePackageInstalled = true;
            servicePackageVersion = info.versionName;
            packageDiagnosticErrorClass = "";
        } catch (PackageManager.NameNotFoundException error) {
            servicePackageInstalled = false;
            servicePackageVersion = null;
            packageDiagnosticErrorClass = "package-not-found";
        } catch (Throwable error) {
            servicePackageInstalled = null;
            servicePackageVersion = null;
            packageDiagnosticErrorClass = error.getClass().getName();
        }
    }
}
