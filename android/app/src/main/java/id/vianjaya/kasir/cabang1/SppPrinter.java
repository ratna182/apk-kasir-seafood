package id.vianjaya.kasir.cabang1;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothSocket;
import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.OutputStream;
import java.lang.reflect.Method;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

public final class SppPrinter {
    private static final String DEFAULT_MAC = "00:11:22:33:44:55";
    private static final String DEFAULT_NAME = "BluetoothPrinter";
    private static final String SAVED_MAC = "spp_success_mac";
    private static final UUID SPP_UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");
    private final Context context;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final ExecutorService socketExecutor = Executors.newCachedThreadPool();
    private volatile BluetoothSocket activeSocket;

    public SppPrinter(Context context) {
        this.context = context.getApplicationContext();
    }

    public JSONObject printTest(String paperWidth) {
        byte[] data = new EscPosReceiptBuilder("80mm".equals(paperWidth) ? 48 : 32)
                .buildTestReceipt("Vian Jaya 08", new java.text.SimpleDateFormat("yyyy-MM-dd HH:mm:ss", java.util.Locale.US).format(new java.util.Date()), "-", "Cash");
        return print(data);
    }

    public JSONObject print(byte[] data) {
        PrintState state = new PrintState();
        Future<JSONObject> job = executor.submit(() -> printOnWorker(data, state));
        try {
            return job.get(5, TimeUnit.SECONDS);
        } catch (TimeoutException error) {
            closeActiveSocket();
            job.cancel(true);
            if (state.flushed) return flushedResult(state);
            return failure("spp-timeout", error);
        } catch (Exception error) {
            return failure("spp-failed", error);
        }
    }

    public void shutdown() {
        closeActiveSocket();
        executor.shutdownNow();
        socketExecutor.shutdownNow();
    }

    private JSONObject printOnWorker(byte[] data, PrintState state) {
        JSONObject diagnostic = new JSONObject();
        try {
            if (Build.VERSION.SDK_INT >= 31 && context.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) {
                return failure("spp-permission", new SecurityException("BLUETOOTH_CONNECT belum diberikan"));
            }
            BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
            if (adapter == null) return failure("spp-no-adapter", new IllegalStateException("Bluetooth adapter tidak tersedia"));
            Set<BluetoothDevice> bonded = adapter.getBondedDevices();
            JSONArray bondedDevices = new JSONArray();
            for (BluetoothDevice device : bonded) {
                JSONObject entry = new JSONObject();
                entry.put("name", device.getName() == null ? "" : device.getName());
                entry.put("mac", device.getAddress());
                bondedDevices.put(entry);
            }
            diagnostic.put("bondedDevices", bondedDevices);

            Selection selection = selectDevice(bonded);
            if (selection.device == null) {
                diagnostic.put("selectionReason", "none");
                diagnostic.put("errorClass", "spp-no-device");
                diagnostic.put("error", "Tidak ada bonded device yang cocok");
                diagnostic.put("ok", false);
                diagnostic.put("status", "failed");
                return diagnostic;
            }
            diagnostic.put("selectedMac", selection.device.getAddress());
            diagnostic.put("selectedName", selection.device.getName() == null ? "" : selection.device.getName());
            diagnostic.put("selectionReason", selection.reason);

            Throwable firstError = null;
            try {
                int bytes = runAttempt(adapter, selection.device, data, false, state);
                diagnostic.put("connectResult", "uuid");
                diagnostic.put("bytesSent", bytes);
                saveSuccessfulMac(selection.device.getAddress());
                return success(diagnostic);
            } catch (Throwable error) {
                firstError = error;
                diagnostic.put("uuidError", errorDetails(error));
            }
            try {
                int bytes = runAttempt(adapter, selection.device, data, true, state);
                diagnostic.put("connectResult", "reflection-channel-1");
                diagnostic.put("bytesSent", bytes);
                diagnostic.put("fallbackResult", "success");
                saveSuccessfulMac(selection.device.getAddress());
                return success(diagnostic);
            } catch (Throwable error) {
                diagnostic.put("fallbackResult", "failed");
                diagnostic.put("fallbackError", errorDetails(error));
                diagnostic.put("errorClass", "spp-connect-failed");
                diagnostic.put("error", firstError == null ? error.getMessage() : firstError.getMessage());
                return diagnostic;
            }
        } catch (Throwable error) {
            return failure("spp-failed", error);
        }
    }

    private int runAttempt(BluetoothAdapter adapter, BluetoothDevice device, byte[] data, boolean reflection, PrintState state) throws Exception {
        Future<Integer> attempt = socketExecutor.submit(() -> connectAndWrite(adapter, device, data, reflection, state));
        try {
            return attempt.get(2200L, TimeUnit.MILLISECONDS);
        } catch (TimeoutException error) {
            closeActiveSocket();
            attempt.cancel(true);
            if (state.flushed) return state.bytes;
            throw error;
        } catch (InterruptedException error) {
            closeActiveSocket();
            attempt.cancel(true);
            Thread.currentThread().interrupt();
            throw error;
        }
    }

    private int connectAndWrite(BluetoothAdapter adapter, BluetoothDevice device, byte[] data, boolean reflection, PrintState state) throws Exception {
        BluetoothSocket socket = null;
        OutputStream output = null;
        try {
            adapter.cancelDiscovery();
            socket = reflection ? reflectionSocket(device) : device.createRfcommSocketToServiceRecord(SPP_UUID);
            activeSocket = socket;
            state.method = reflection ? "reflection-channel-1" : "uuid";
            socket.connect();
            output = socket.getOutputStream();
            output.write(data);
            output.flush();
            state.flushed = true;
            state.bytes = data.length;
            try { Thread.sleep(150L); }
            catch (InterruptedException error) { Thread.currentThread().interrupt(); }
            return data.length;
        } finally {
            try { if (output != null) output.close(); } catch (Exception ignored) { }
            try { if (socket != null) socket.close(); } catch (Exception ignored) { }
            activeSocket = null;
        }
    }

    private BluetoothSocket reflectionSocket(BluetoothDevice device) throws Exception {
        Method method = device.getClass().getMethod("createRfcommSocket", int.class);
        method.setAccessible(true);
        return (BluetoothSocket) method.invoke(device, 1);
    }

    private Selection selectDevice(Set<BluetoothDevice> bonded) {
        String saved = context.getSharedPreferences("printer_diagnostics", Context.MODE_PRIVATE).getString(SAVED_MAC, "");
        for (BluetoothDevice device : bonded) if (saved.equalsIgnoreCase(device.getAddress())) return new Selection(device, "tersimpan");
        for (BluetoothDevice device : bonded) if (DEFAULT_MAC.equalsIgnoreCase(device.getAddress())) return new Selection(device, "default");
        for (BluetoothDevice device : bonded) if (DEFAULT_NAME.equalsIgnoreCase(device.getName())) return new Selection(device, "nama");
        return new Selection(null, "none");
    }

    private void saveSuccessfulMac(String mac) {
        context.getSharedPreferences("printer_diagnostics", Context.MODE_PRIVATE).edit().putString(SAVED_MAC, mac).apply();
    }

    private void closeActiveSocket() {
        BluetoothSocket socket = activeSocket;
        if (socket != null) try { socket.close(); } catch (Exception ignored) { }
    }

    private JSONObject success(JSONObject diagnostic) throws Exception {
        diagnostic.put("ok", true);
        diagnostic.put("status", "printed");
        return diagnostic;
    }

    private JSONObject flushedResult(PrintState state) {
        try {
            JSONObject result = new JSONObject();
            result.put("ok", true);
            result.put("status", "printed");
            result.put("connectResult", state.method);
            result.put("bytesSent", state.bytes);
            return result;
        } catch (Exception ignored) {
            return new JSONObject();
        }
    }

    private JSONObject failure(String errorClass, Throwable error) {
        try {
            JSONObject result = new JSONObject();
            result.put("ok", false);
            result.put("status", "failed");
            result.put("errorClass", errorClass);
            result.put("error", error.getMessage() == null ? error.toString() : error.getMessage());
            result.put("exception", errorDetails(error));
            return result;
        } catch (Exception ignored) {
            return new JSONObject();
        }
    }

    private JSONObject errorDetails(Throwable error) throws Exception {
        JSONObject result = new JSONObject();
        result.put("class", error.getClass().getName());
        result.put("message", error.getMessage() == null ? error.toString() : error.getMessage());
        return result;
    }

    private static final class Selection {
        final BluetoothDevice device;
        final String reason;

        Selection(BluetoothDevice device, String reason) {
            this.device = device;
            this.reason = reason;
        }
    }

    private static final class PrintState {
        boolean flushed;
        int bytes;
        String method = "unknown";
    }
}
