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
import android.content.pm.ResolveInfo;
import android.content.pm.ServiceInfo;
import android.content.ComponentName;
import android.content.Intent;
import android.content.ServiceConnection;
import android.os.IBinder;

import com.getcapacitor.BridgeWebViewClient;
import com.getcapacitor.BridgeActivity;
import com.imin.printer.INeoPrinterCallback;
import com.imin.printer.InitPrinterCallback;
import com.imin.printer.PrinterHelper;

import org.json.JSONObject;
import org.json.JSONArray;

import java.util.Map;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

public class MainActivity extends BridgeActivity {
    private static final String TAG = "IminPrinter";
    private static final String SERVICE_PACKAGE = "com.imin.printerservice";
    private static final String SERVICE_CLASS = "com.imin.printerservice.core.ApiAdapterManager.NeoPrinterService";
    private static final String SERVICE_ACTION = "com.imin.printerservice.NeoPrinterService";
    private static final String CONNECT_TYPE = "sdk-default/unknown";
    private static final long CONNECT_TIMEOUT_MS = 5000L;
    private static final String NAV_TAG = "NavTrace";
    private final AtomicBoolean printerConnected = new AtomicBoolean(false);
    private final AtomicBoolean isInitializing = new AtomicBoolean(false);
    private final ExecutorService printExecutor = Executors.newSingleThreadExecutor();
    private final Map<String, String> recentJobs = new ConcurrentHashMap<>();
    private final Map<String, Long> recentJobTimes = new ConcurrentHashMap<>();
    private final Map<String, Boolean> processingJobs = new ConcurrentHashMap<>();
    private final Set<ServiceConnection> diagnosticConnections = new HashSet<>();
    private final JSONObject diagnosticData = new JSONObject();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private SppPrinter sppPrinter;
    private CountDownLatch connectionLatch;
    private volatile String connectionState = "idle";
    private volatile long connectionAttempt;
    private volatile Boolean bindResult;
    private volatile Boolean servicePackageInstalled;
    private volatile String servicePackageVersion;
    private volatile String diagnosticStage = "idle";
    private volatile String diagnosticErrorClass = "";
    private volatile String diagnosticErrorMessage = "";
    private volatile Integer diagnosticStatusCode;
    private volatile String packageDiagnosticErrorClass = "";
    private volatile String pathUsed = "none";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        sppPrinter = new SppPrinter(this);
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
        scanPackages();
        initPrinterService();
    }

    @Override
    public void onResume() {
        super.onResume();
        if ("idle".equals(connectionState) || "error".equals(connectionState)) initPrinterService();
    }

    @Override
    public void onDestroy() {
        printExecutor.shutdownNow();
        if (sppPrinter != null) sppPrinter.shutdown();
        mainHandler.removeCallbacksAndMessages(null);
        synchronized (diagnosticConnections) {
            for (ServiceConnection connection : diagnosticConnections) {
                try { unbindService(connection); } catch (IllegalArgumentException ignored) { }
            }
            diagnosticConnections.clear();
        }
        stopSdkBinding();
        super.onDestroy();
    }

    private void stopSdkBinding() {
        try { PrinterHelper.getInstance().deInitPrinterService(this); }
        catch (Exception error) { Log.e(TAG, "deinit failed", error); }
    }

    private void initPrinterService() {
        if (!isInitializing.compareAndSet(false, true)) return;
        connectionState = "connecting";
        connectionLatch = new CountDownLatch(1);
        recordDiagnostic("connectStateAt", clock());
        checkServicePackage();
        diagnosticStage = "bind";
        diagnosticErrorClass = "";
        diagnosticErrorMessage = "";
        recordDiagnostic("bindStartedAt", now());
        recordDiagnostic("bindStartedClock", clock());
        recordDiagnostic("connectType", CONNECT_TYPE);
        final long attempt = ++connectionAttempt;
        Log.d(TAG, "bind package=" + SERVICE_PACKAGE + " class=" + SERVICE_CLASS + " action=" + SERVICE_ACTION);
        try {
            bindResult = PrinterHelper.getInstance().initPrinterService(this, new InitPrinterCallback() {
                @Override public void onConnected() {
                    if (attempt != connectionAttempt || !isInitializing.get()) return;
                    try {
                        diagnosticStage = "wait-connect";
                        diagnosticStatusCode = PrinterHelper.getInstance().getPrinterStatus();
                        Log.d(TAG, "onServiceConnected status=" + diagnosticStatusCode + " text=" + statusText(diagnosticStatusCode));
                        printerConnected.set(diagnosticStatusCode != null && diagnosticStatusCode == 0);
                        isInitializing.set(false);
                        connectionState = printerConnected.get() ? "connected" : "error";
                        recordDiagnostic("sdkCallbackAt", now());
                        recordDiagnostic("sdkCallbackClock", clock());
                        recordDiagnostic("sdkCallback", "onConnected");
                        if (!printerConnected.get()) {
                            diagnosticStage = "status";
                            diagnosticErrorClass = "sdk-init-failed";
                            diagnosticErrorMessage = statusText(diagnosticStatusCode);
                        }
                    } catch (Throwable error) {
                        printerConnected.set(false);
                        isInitializing.set(false);
                        connectionState = "error";
                        diagnosticStage = "sdk-init-exception";
                        diagnosticErrorClass = "sdk-init-failed";
                        diagnosticErrorMessage = error.getMessage() == null ? error.toString() : error.getMessage();
                        recordDiagnostic("sdkInitException", exceptionDetails(error));
                    }
                    if (connectionLatch != null) connectionLatch.countDown();
                }
                @Override public void onDisconnected() {
                    printerConnected.set(false); isInitializing.set(false);
                    connectionState = "error";
                    diagnosticStage = "service-disconnected";
                    diagnosticErrorClass = "service-disconnected";
                    diagnosticErrorMessage = "Printer service disconnected";
                    recordDiagnostic("sdkDisconnectedAt", now());
                    if (connectionLatch != null) connectionLatch.countDown();
                    Log.w(TAG, "onServiceDisconnected");
                    new Handler(Looper.getMainLooper()).postDelayed(() -> {
                        if (!printerConnected.get() && !isInitializing.get()) initPrinterService();
                    }, 3000);
                }
            });
            Log.d(TAG, "bind result=" + bindResult);
            if (!Boolean.TRUE.equals(bindResult)) {
                connectionState = "error";
                diagnosticErrorClass = "bind-failed";
                diagnosticErrorMessage = "bindService returned false";
                recordDiagnostic("bindCompletedAt", now());
                isInitializing.set(false);
                connectionLatch.countDown();
            } else {
                mainHandler.postDelayed(() -> {
                    if (attempt != connectionAttempt || !isInitializing.get()) return;
                    printerConnected.set(false);
                    connectionState = "error";
                    diagnosticStage = "bind-timeout";
                    diagnosticErrorClass = "bind-failed";
                    diagnosticErrorMessage = "onServiceConnected tidak datang dalam 5 detik";
                    recordDiagnostic("bindTimeoutAt", now());
                    ++connectionAttempt;
                    isInitializing.set(false);
                    stopSdkBinding();
                    if (connectionLatch != null) connectionLatch.countDown();
                }, CONNECT_TIMEOUT_MS);
            }
        } catch (Throwable error) {
            bindResult = false;
            connectionState = "error";
            diagnosticErrorClass = "sdk-init-failed";
            diagnosticErrorMessage = error.getMessage() == null ? error.toString() : error.getMessage();
            recordDiagnostic("sdkInitException", exceptionDetails(error));
            isInitializing.set(false);
            connectionLatch.countDown();
            Log.e(TAG, "error stage=bind", error);
        }
    }

    private String checkServicePackage() {
        diagnosticStage = "check-package";
        try {
            PackageInfo info = getPackageManager().getPackageInfo(SERVICE_PACKAGE, 0);
            servicePackageInstalled = true;
            servicePackageVersion = info.versionName;
            packageDiagnosticErrorClass = "";
            recordDiagnostic("packageCheckAt", clock());
            Log.d(TAG, "check-package installed=true version=" + servicePackageVersion);
            return result(true, "supported", null, 0);
        } catch (PackageManager.NameNotFoundException error) {
            servicePackageInstalled = false;
            servicePackageVersion = null;
            packageDiagnosticErrorClass = "package-not-found";
            recordDiagnostic("packageCheckAt", clock());
            Log.i(TAG, "info stage=check-package package=" + SERVICE_PACKAGE + " not found");
            return result(true, "diagnostic-only", null, 0);
        } catch (Throwable error) {
            servicePackageInstalled = null;
            servicePackageVersion = null;
            packageDiagnosticErrorClass = error.getClass().getName();
            recordDiagnostic("packageCheckAt", clock());
            Log.i(TAG, "info stage=check-package package lookup failed", error);
            return result(true, "diagnostic-only", null, 0);
        }
    }

    private String bridgeError(String stage, Throwable error) {
        diagnosticStage = stage;
        diagnosticErrorClass = error.getClass().getName();
        diagnosticErrorMessage = error.getMessage() == null ? error.toString() : error.getMessage();
        return result(false, "error", diagnosticErrorMessage, 0);
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
            StringBuilder stack = new StringBuilder();
            StackTraceElement[] trace = error.getStackTrace();
            for (int i = 0; i < Math.min(trace.length, 4); i++) {
                if (i > 0) stack.append(" | ");
                stack.append(trace[i].toString());
            }
            details.put("stacktrace", stack.toString());
        } catch (Exception ignored) { }
        return details;
    }

    private void scanPackages() {
        JSONArray packages = new JSONArray();
        try {
            int flags = PackageManager.GET_SERVICES | PackageManager.GET_META_DATA;
            List<PackageInfo> installed = getPackageManager().getInstalledPackages(flags);
            for (PackageInfo info : installed) {
                String packageName = info.packageName == null ? "" : info.packageName;
                CharSequence labelValue = info.applicationInfo == null ? "" : getPackageManager().getApplicationLabel(info.applicationInfo);
                String label = labelValue == null ? "" : labelValue.toString();
                String searchable = (packageName + " " + label).toLowerCase(java.util.Locale.US);
                if (!searchable.contains("imin") && !searchable.contains("printer")) continue;

                JSONObject packageJson = new JSONObject();
                packageJson.put("packageName", packageName);
                packageJson.put("label", label);
                packageJson.put("versionName", info.versionName == null ? JSONObject.NULL : info.versionName);
                packageJson.put("enabled", info.applicationInfo != null && info.applicationInfo.enabled);
                packageJson.put("isSystemApp", info.applicationInfo != null && (info.applicationInfo.flags & android.content.pm.ApplicationInfo.FLAG_SYSTEM) != 0);
                packageJson.put("services", scanServices(info, packageName));
                packages.put(packageJson);
            }
            synchronized (diagnosticData) {
                diagnosticData.put("packageScanTimestamp", now());
                diagnosticData.put("packageScan", packages);
            }
        } catch (Throwable error) {
            synchronized (diagnosticData) {
                try {
                    diagnosticData.put("packageScanTimestamp", now());
                    diagnosticData.put("packageScanError", error.getClass().getName() + ": " + error.getMessage());
                } catch (Exception ignored) { }
            }
            Log.e(TAG, "package scan failed", error);
        }
    }

    private JSONArray scanServices(PackageInfo packageInfo, String packageName) {
        JSONArray services = new JSONArray();
        if (packageInfo.services == null) return services;
        List<ResolveInfo> resolved = getPackageManager().queryIntentServices(
                new Intent().setPackage(packageName), PackageManager.GET_RESOLVED_FILTER);
        for (ServiceInfo service : packageInfo.services) {
            try {
                JSONObject serviceJson = new JSONObject();
                serviceJson.put("name", service.name);
                serviceJson.put("exported", service.exported);
                JSONArray actions = new JSONArray();
                for (ResolveInfo resolveInfo : resolved) {
                    if (resolveInfo.serviceInfo == null || !service.name.equals(resolveInfo.serviceInfo.name) || resolveInfo.filter == null) continue;
                    for (int i = 0; i < resolveInfo.filter.countActions(); i++) actions.put(resolveInfo.filter.getAction(i));
                }
                serviceJson.put("actions", actions);
                serviceJson.put("bindResult", probeService(packageName, service.name));
                services.put(serviceJson);
            } catch (Throwable error) {
                Log.w(TAG, "service scan failed " + packageName + "/" + service.name, error);
            }
        }
        return services;
    }

    private boolean probeService(String packageName, String serviceName) {
        final ServiceConnection connection = new ServiceConnection() {
            @Override public void onServiceConnected(ComponentName name, IBinder service) { }
            @Override public void onServiceDisconnected(ComponentName name) { }
        };
        Intent intent = new Intent().setComponent(new ComponentName(packageName, serviceName));
        try {
            boolean bound = bindService(intent, connection, BIND_AUTO_CREATE);
            if (bound) {
                synchronized (diagnosticConnections) { diagnosticConnections.add(connection); }
                try { unbindService(connection); } catch (IllegalArgumentException ignored) { }
                synchronized (diagnosticConnections) { diagnosticConnections.remove(connection); }
            }
            return bound;
        } catch (Throwable error) {
            Log.w(TAG, "service probe failed " + packageName + "/" + serviceName, error);
            return false;
        }
    }

    private boolean waitForConnection() throws InterruptedException {
        if (!printerConnected.get()) {
            if (!isInitializing.get() && !"connecting".equals(connectionState)) initPrinterService();
            CountDownLatch latch = connectionLatch;
            if (latch != null) latch.await(CONNECT_TIMEOUT_MS, TimeUnit.MILLISECONDS);
        }
        if (!printerConnected.get() && isInitializing.get()) {
            connectionState = "error";
            diagnosticStage = "bind-timeout";
            diagnosticErrorClass = "bind-failed";
            diagnosticErrorMessage = "onServiceConnected tidak datang dalam 5 detik";
            ++connectionAttempt;
            isInitializing.set(false);
            mainHandler.post(this::stopSdkBinding);
            Log.e(TAG, "error stage=wait-connect " + diagnosticErrorMessage);
        }
        return printerConnected.get();
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
            json.put("userMessage", ok ? JSONObject.NULL : "Printer belum siap. Pastikan printer menyala dan kertas terpasang, lalu coba lagi.");
            json.put("manufacturer", Build.MANUFACTURER);
            json.put("model", Build.MODEL);
            json.put("sdkInt", Build.VERSION.SDK_INT);
            json.put("targetSdk", getApplicationInfo().targetSdkVersion);
            json.put("iminSdkVersion", "V2.0.0.18");
            json.put("timestamp", clock());
            json.put("packageDiagnosticErrorClass", packageDiagnosticErrorClass.isEmpty() ? JSONObject.NULL : packageDiagnosticErrorClass);
            synchronized (diagnosticData) { json.put("diagnostics", new JSONObject(diagnosticData.toString())); }
            return json.toString();
        } catch (Throwable ignored) { return "{\"ok\":false,\"status\":\"failed\",\"error\":\"result error\",\"attempts\":0}"; }
    }

    private final class IMinPrinterBridge {
        @JavascriptInterface public boolean isSupported() {
            try { return true; }
            catch (Throwable error) { bridgeError("bridge", error); return false; }
        }

        @JavascriptInterface public boolean connect() {
            try { if (!printerConnected.get() && !isInitializing.get() && !"connecting".equals(connectionState)) initPrinterService(); return printerConnected.get(); }
            catch (Throwable error) { bridgeError("bind", error); Log.e(TAG, "connect failed", error); return false; }
        }

        @JavascriptInterface public String getDiagnostics() {
            try { return diagnostics(); }
            catch (Throwable error) { Log.e(TAG, "error stage=status", error); return bridgeError("status", error); }
        }

        @JavascriptInterface public String tesCetakSpp(String paperWidth) {
            try {
                pathUsed = "spp";
                JSONObject spp = sppPrinter.printTest("80mm".equals(paperWidth) ? "80mm" : "58mm");
                recordDiagnostic("sppAt", clock());
                recordDiagnostic("spp", spp);
                recordDiagnostic("path", pathUsed);
                return spp.toString();
            } catch (Throwable error) {
                JSONObject failure = new JSONObject();
                try {
                    failure.put("ok", false);
                    failure.put("status", "failed");
                    failure.put("errorClass", "spp-failed");
                    failure.put("error", error.getMessage() == null ? error.toString() : error.getMessage());
                    recordDiagnostic("spp", failure);
                    return failure.toString();
                } catch (Exception ignored) {
                    return "{\"ok\":false,\"errorClass\":\"spp-failed\"}";
                }
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
            try { printerConnected.set(false); } catch (Throwable error) { bridgeError("disconnect", error); Log.e(TAG, "disconnect failed", error); }
        }

        @JavascriptInterface public String printJob(String jobId, String base64Data) {
            try { return printJobInternal(jobId, base64Data); }
            catch (Throwable error) { Log.e(TAG, "job bridge failed", error); return bridgeError("print-job", error); }
        }

        private String printJobInternal(String jobId, String base64Data) {
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
            int attempts = 0;
            pathUsed = "none";
            final byte[] data;
            try {
                data = Base64.decode(base64Data, Base64.DEFAULT);
            } catch (IllegalArgumentException error) {
                return result(false, "failed", "Data struk tidak valid", 0);
            }
            for (int attempt = 1; attempt <= 3; attempt++) {
                attempts = attempt;
                Log.d(TAG, "job=" + jobId + " attempt=" + attempt);
                try {
                    if (!waitForConnection()) {
                        recordDiagnostic("lastFallbackReason", diagnosticErrorClass);
                    } else {
                        CountDownLatch done = new CountDownLatch(1);
                        AtomicBoolean success = new AtomicBoolean(false);
                        AtomicBoolean definiteFailure = new AtomicBoolean(false);
                        PrinterHelper.getInstance().sendRAWData(data, new INeoPrinterCallback() {
                            @Override public void onRunResult(boolean isSuccess) { success.set(isSuccess); definiteFailure.set(!isSuccess); done.countDown(); }
                            @Override public void onRaiseException(int code, String msg) { Log.w(TAG, "job=" + jobId + " exception=" + code + " " + msg); definiteFailure.set(true); done.countDown(); }
                            @Override public void onPrintResult(int code, String msg) { if (code == 1) success.set(true); else definiteFailure.set(true); done.countDown(); }
                            @Override public void onReturnString(String value) { }
                        });
                        if (!done.await(10, TimeUnit.SECONDS)) {
                            diagnosticStage = "sdk-print-timeout";
                            diagnosticErrorClass = "print-timeout";
                            diagnosticErrorMessage = "SDK tidak mengonfirmasi hasil cetak";
                            return result(false, "unknown", "Printer tidak memberi hasil; jangan ulang otomatis", attempts);
                        }
                        if (success.get()) {
                            pathUsed = "sdk";
                            recordDiagnostic("path", "sdk");
                            return result(true, "printed", null, attempts);
                        }
                        if (definiteFailure.get()) {
                            printerConnected.set(false);
                            connectionState = "error";
                            recordDiagnostic("lastSdkPrintFailureAt", clock());
                        }
                    }
                    JSONObject spp = sppPrinter.print(data);
                    recordDiagnostic("sppAt", clock());
                    recordDiagnostic("spp", spp);
                    if (spp.optBoolean("ok", false)) {
                        pathUsed = "spp";
                        recordDiagnostic("path", "spp");
                        return result(true, "printed", null, attempts);
                    }
                    diagnosticErrorClass = spp.optString("errorClass", "spp-failed");
                    diagnosticErrorMessage = spp.optString("error", "SPP gagal mengirim data");
                    if (attempt < 3) Thread.sleep(250L);
                } catch (InterruptedException error) {
                    Thread.currentThread().interrupt();
                    return result(false, "unknown", "Proses cetak terhenti", attempts);
                } catch (Exception error) {
                    Log.e(TAG, "job=" + jobId + " failed", error);
                    diagnosticErrorClass = error.getClass().getName();
                    diagnosticErrorMessage = error.getMessage() == null ? error.toString() : error.getMessage();
                    if (attempt < 3) try { Thread.sleep(250L); } catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); return result(false, "unknown", "Proses cetak terhenti", attempts); }
                }
            }
            return result(false, "failed", "Printer belum siap. Pastikan printer menyala dan kertas terpasang, lalu coba lagi.", attempts);
        }

        @JavascriptInterface public boolean print(String base64Data) {
            try { JSONObject response = new JSONObject(printJob("legacy-" + System.nanoTime(), base64Data)); return response.optBoolean("ok", false); }
            catch (Throwable error) { bridgeError("print", error); Log.e(TAG, "legacy print failed", error); return false; }
        }

        @JavascriptInterface public String getStatus() {
            try {
                if (printerConnected.get()) diagnosticStatusCode = PrinterHelper.getInstance().getPrinterStatus();
                Log.d(TAG, "status code=" + diagnosticStatusCode + " text=" + statusText(diagnosticStatusCode));
                return connectionState;
            }
            catch (Throwable error) { Log.e(TAG, "status failed", error); bridgeError("status", error); return "error"; }
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

    private String diagnostics() {
        if (printerConnected.get()) {
            diagnosticStatusCode = PrinterHelper.getInstance().getPrinterStatus();
            Log.d(TAG, "status code=" + diagnosticStatusCode + " text=" + statusText(diagnosticStatusCode));
        }
        return result(printerConnected.get(), statusText(diagnosticStatusCode), diagnosticErrorMessage.isEmpty() ? null : diagnosticErrorMessage, 0);
    }
}
