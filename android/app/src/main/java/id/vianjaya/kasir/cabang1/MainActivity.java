package id.vianjaya.kasir.cabang1;

import android.os.Bundle;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;
import com.imin.printer.INeoPrinterCallback;
import com.imin.printer.InitPrinterCallback;
import com.imin.printer.PrinterHelper;

import java.util.concurrent.atomic.AtomicBoolean;

public class MainActivity extends BridgeActivity {
    private final AtomicBoolean printerConnected = new AtomicBoolean(false);

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getBridge().getWebView().addJavascriptInterface(new IMinPrinterBridge(), "IMinPrinter");
        PrinterHelper.getInstance().initPrinterService(this, new InitPrinterCallback() {
            @Override
            public void onConnected() {
                printerConnected.set(true);
            }

            @Override
            public void onDisconnected() {
                printerConnected.set(false);
            }
        });
    }

    @Override
    public void onDestroy() {
        PrinterHelper.getInstance().deInitPrinterService(this);
        super.onDestroy();
    }

    private final class IMinPrinterBridge {
        @JavascriptInterface
        public boolean isSupported() {
            return true;
        }

        @JavascriptInterface
        public boolean connect() {
            return printerConnected.get();
        }

        @JavascriptInterface
        public void disconnect() {
            printerConnected.set(false);
        }

        @JavascriptInterface
        public boolean print(String base64Data) {
            if (!printerConnected.get()) {
                return false;
            }

            try {
                byte[] data = Base64.decode(base64Data, Base64.DEFAULT);
                PrinterHelper.getInstance().sendRAWData(data, new INeoPrinterCallback() {
                    @Override
                    public void onRunResult(boolean isSuccess) {
                        if (!isSuccess) {
                            printerConnected.set(false);
                        }
                    }

                    @Override
                    public void onRaiseException(int code, String msg) {
                        printerConnected.set(false);
                    }

                    @Override
                    public void onPrintResult(int code, String msg) {
                        if (code != 1) {
                            printerConnected.set(false);
                        }
                    }

                    @Override
                    public void onReturnString(String result) {
                    }
                });
                return true;
            } catch (IllegalArgumentException error) {
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
