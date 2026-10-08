package id.vianjaya.kasir.cabang1;

import android.os.Bundle;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.util.Log;

import com.getcapacitor.BridgeActivity;
import com.imin.printer.INeoPrinterCallback;
import com.imin.printer.InitPrinterCallback;
import com.imin.printer.PrinterHelper;

import java.util.concurrent.atomic.AtomicBoolean;

public class MainActivity extends BridgeActivity {
    private final AtomicBoolean printerConnected = new AtomicBoolean(false);
    private final AtomicBoolean isInitializing = new AtomicBoolean(false);
    private static final String TAG = "IMinPrinter";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getBridge().getWebView().addJavascriptInterface(new IMinPrinterBridge(), "IMinPrinter");
        initPrinterService();
    }

    @Override
    protected void onResume() {
        super.onResume();
        // Reconnect printer service on resume (after sleep/wake)
        if (!printerConnected.get() && !isInitializing.get()) {
            initPrinterService();
        }
    }

    @Override
    public void onDestroy() {
        PrinterHelper.getInstance().deInitPrinterService(this);
        super.onDestroy();
    }

    private void initPrinterService() {
        if (isInitializing.getAndSet(true)) return;
        
        Log.d(TAG, "Initializing printer service...");
        PrinterHelper.getInstance().initPrinterService(this, new InitPrinterCallback() {
            @Override
            public void onConnected() {
                Log.d(TAG, "Printer service connected");
                printerConnected.set(true);
                isInitializing.set(false);
            }

            @Override
            public void onDisconnected() {
                Log.d(TAG, "Printer service disconnected");
                printerConnected.set(false);
                isInitializing.set(false);
                // Auto-retry after 3 seconds
                new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(() -> {
                    if (!printerConnected.get() && !isInitializing.get()) {
                        initPrinterService();
                    }
                }, 3000);
            }
        });
    }

    private final class IMinPrinterBridge {
        @JavascriptInterface
        public boolean isSupported() {
            return true;
        }

        @JavascriptInterface
        public boolean connect() {
            if (!printerConnected.get() && !isInitializing.get()) {
                initPrinterService();
            }
            return printerConnected.get();
        }

        @JavascriptInterface
        public void disconnect() {
            printerConnected.set(false);
        }

        @JavascriptInterface
        public boolean print(String base64Data) {
            if (!printerConnected.get()) {
                // Try to reconnect before giving up
                if (!isInitializing.get()) {
                    initPrinterService();
                }
                return false;
            }

            try {
                byte[] data = Base64.decode(base64Data, Base64.DEFAULT);
                PrinterHelper.getInstance().sendRAWData(data, new INeoPrinterCallback() {
                    @Override
                    public void onRunResult(boolean isSuccess) {
                        if (!isSuccess) {
                            Log.w(TAG, "Print run failed");
                            printerConnected.set(false);
                        }
                    }

                    @Override
                    public void onRaiseException(int code, String msg) {
                        Log.w(TAG, "Print exception: " + code + " - " + msg);
                        printerConnected.set(false);
                    }

                    @Override
                    public void onPrintResult(int code, String msg) {
                        if (code != 1) {
                            Log.w(TAG, "Print result error: " + code + " - " + msg);
                            printerConnected.set(false);
                        }
                    }

                    @Override
                    public void onReturnString(String result) {
                    }
                });
                return true;
            } catch (IllegalArgumentException error) {
                Log.e(TAG, "Base64 decode error", error);
                return false;
            }
        }

        @JavascriptInterface
        public String getStatus() {
            if (!printerConnected.get()) {
                return "idle";
            }

            return PrinterHelper.getInstance().getPrinterStatus() == 0 ? "connected" : "error";
        }
    }
}
