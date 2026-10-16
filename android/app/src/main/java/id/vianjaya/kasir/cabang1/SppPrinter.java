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
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Iterator;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

/**
 * Bluetooth SPP transport for the built-in printer.
 *
 * <p>One socket at a time: every socket operation runs inside {@link #socketMutex} and waits
 * {@link #SOCKET_GAP_MS} after closing, so the printer is never hit while it is still busy.
 */
public final class SppPrinter {
    private static final String DEFAULT_MAC = "00:11:22:33:44:55";
    private static final String DEFAULT_NAME = "BluetoothPrinter";
    private static final String SAVED_MAC = "spp_success_mac";
    private static final String DEFAULT_PAPER_WIDTH = "80mm";
    private static final String BLUETOOTH_OFF_MESSAGE = "Bluetooth perangkat mati. Nyalakan Bluetooth lalu coba lagi.";
    private static final String NOT_READY_MESSAGE = "Printer belum siap. Pastikan printer menyala dan kertas terpasang, lalu coba lagi.";
    private static final UUID SPP_UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");
    private static final long ATTEMPT_TIMEOUT_MS = 4000L;
    private static final long JOB_TIMEOUT_MS = 10000L;
    private static final long SOCKET_GAP_MS = 300L;
    private static final int WRITE_CHUNK_BYTES = 512;
    private static final long WRITE_CHUNK_GAP_MS = 5L;

    private final Context context;
    private final ExecutorService jobExecutor = Executors.newSingleThreadExecutor();
    private final ExecutorService attemptExecutor = Executors.newCachedThreadPool();
    private final Object socketMutex = new Object();
    private volatile BluetoothSocket activeSocket;
    private volatile String connectionState = "idle";
    private volatile long lastConnectAt;
    private volatile String selectedMac = "";
    private volatile String selectedName = "";
    private volatile String selectionReason = "none";
    private volatile String lastConnectResult = "";

    public SppPrinter(Context context) {
        this.context = context.getApplicationContext();
    }

    public static String normalizePaperWidth(String paperWidth) {
        if (paperWidth == null || paperWidth.trim().isEmpty()) return DEFAULT_PAPER_WIDTH;
        String value = paperWidth.trim().toLowerCase(Locale.US);
        return value.startsWith("58") || value.startsWith("32") ? "58mm" : "80mm";
    }

    public String connectionState() {
        return connectionState;
    }

    public long lastConnectAt() {
        return lastConnectAt;
    }

    public String selectedMac() {
        return selectedMac;
    }

    public String selectionReason() {
        return selectionReason;
    }

    public boolean bluetoothEnabled() {
        BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
        return adapter != null && adapter.isEnabled();
    }

    /** Opens and closes an RFCOMM socket so the printer is known to be ready, without printing. */
    public JSONObject probeConnect() {
        PrintState state = new PrintState();
        Future<JSONObject> probe = attemptExecutor.submit(() -> withSocket(state, () -> {
            BluetoothAdapter adapter = requireAdapter();
            if (adapter == null) return bluetoothOff();
            Selection selection = selectDevice(adapter.getBondedDevices());
            if (selection.device == null) return noDevice(adapter);
            return openSocketAndReport(adapter, selection, state, null);
        }));
        return await(probe, "spp-connect-failed", state);
    }

    public JSONObject print(byte[] data, String paperWidth) {
        PrintState state = new PrintState();
        Future<JSONObject> job = jobExecutor.submit(() -> withSocket(state, () -> {
            BluetoothAdapter adapter = requireAdapter();
            if (adapter == null) return bluetoothOff();
            Selection selection = selectDevice(adapter.getBondedDevices());
            if (selection.device == null) return noDevice(adapter);
            return send(adapter, selection, data, state);
        }));
        return await(job, "spp-connect-failed", state);
    }

    public JSONObject printTest(String paperWidth) {
        String width = normalizePaperWidth(paperWidth);
        byte[] data = EscPosReceiptBuilder.forPaperWidth(width)
                .buildTestReceipt("Vian Jaya 08",
                        new SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US).format(new Date()),
                        "-", "Cash");
        return print(data, width);
    }

    /** Refreshes the cached device selection from the bonded list; never opens a socket. */
    public JSONObject refreshState() {
        try {
            BluetoothAdapter adapter = requireAdapter();
            if (adapter != null) {
                Selection selection = selectDevice(adapter.getBondedDevices());
                selectedMac = selection.device == null ? "" : selection.device.getAddress();
                selectedName = selection.device == null || selection.device.getName() == null ? "" : selection.device.getName();
                selectionReason = selection.reason;
            }
            return snapshot();
        } catch (Throwable error) {
            return snapshot();
        }
    }

    public JSONObject snapshot() {
        JSONObject result = new JSONObject();
        try {
            result.put("bluetoothEnabled", bluetoothEnabled());
            result.put("connectionState", connectionState);
            result.put("lastConnectAt", lastConnectAt);
            result.put("selectedMac", selectedMac);
            result.put("selectedName", selectedName);
            result.put("selectionReason", selectionReason);
            result.put("connectResult", lastConnectResult);
        } catch (Exception ignored) { }
        return result;
    }

    /** Bonded devices for diagnostics; no socket, no state change. */
    public JSONArray bondedDevices() {
        try {
            BluetoothAdapter adapter = requireAdapter();
            if (adapter == null) return new JSONArray();
            return bondedDevices(adapter.getBondedDevices());
        } catch (Throwable error) {
            return new JSONArray();
        }
    }

    public void shutdown() {
        closeActiveSocket();
        jobExecutor.shutdownNow();
        attemptExecutor.shutdownNow();
    }

    public void forgetConnection() {
        connectionState = "idle";
    }

    private JSONObject await(Future<JSONObject> future, String errorClass, PrintState state) {
        try {
            return future.get(JOB_TIMEOUT_MS, TimeUnit.MILLISECONDS);
        } catch (TimeoutException error) {
            closeActiveSocket();
            future.cancel(true);
            return settled(errorClass, error, state);
        } catch (InterruptedException error) {
            closeActiveSocket();
            future.cancel(true);
            Thread.currentThread().interrupt();
            return settled(errorClass, error, state);
        } catch (ExecutionException error) {
            Throwable cause = error.getCause() == null ? error : error.getCause();
            return settled(errorClass, cause, state);
        } catch (Exception error) {
            return settled(errorClass, error, state);
        }
    }

    /** Bytes that were flushed make a finished job: never resend them, whatever close() says. */
    private JSONObject settled(String errorClass, Throwable error, PrintState state) {
        if (state.flushed) return success(state, state.bytes);
        return failure(errorClass, error);
    }

    private JSONObject withSocket(PrintState state, SocketAction action) {
        synchronized (socketMutex) {
            try {
                return action.run();
            } catch (Throwable error) {
                if (state.flushed) return success(state, state.bytes);
                return failure("spp-connect-failed", error);
            } finally {
                closeActiveSocket();
                try { Thread.sleep(SOCKET_GAP_MS); }
                catch (InterruptedException error) { Thread.currentThread().interrupt(); }
            }
        }
    }

    private JSONObject openSocketAndReport(BluetoothAdapter adapter, Selection selection, PrintState state, byte[] data) {
        BluetoothSocket socket = null;
        try {
            socket = openSocket(adapter, selection.device, false, state);
            markConnected(selection);
            if (data == null) return success(state, 0);
            JSONObject written = write(socket, data, state);
            if (written.optBoolean("ok", false)) markConnected(selection);
            return written;
        } catch (Throwable error) {
            if (state.flushed) {
                markConnected(selection);
                return success(state, state.bytes);
            }
            return failure("spp-connect-failed", error);
        } finally {
            closeQuietly(socket);
        }
    }

    private JSONObject send(BluetoothAdapter adapter, Selection selection, byte[] data, PrintState state) {
        BluetoothSocket socket = null;
        try {
            socket = openSocket(adapter, selection.device, false, state);
            JSONObject written = write(socket, data, state);
            if (written.optBoolean("ok", false)) markConnected(selection);
            if (written.optBoolean("ok", false)) return written;
        } catch (Throwable error) {
            if (state.flushed) {
                markConnected(selection);
                return success(state, state.bytes);
            }
        } finally {
            closeQuietly(socket);
        }

        try {
            socket = openSocket(adapter, selection.device, true, state);
            JSONObject written = write(socket, data, state);
            if (written.optBoolean("ok", false)) markConnected(selection);
            return written;
        } catch (Throwable error) {
            if (state.flushed) {
                markConnected(selection);
                return success(state, state.bytes);
            }
            return failure("spp-connect-failed", error);
        } finally {
            closeQuietly(socket);
        }
    }

    private BluetoothSocket openSocket(BluetoothAdapter adapter, BluetoothDevice device, boolean reflection, PrintState state) throws Exception {
        final BluetoothSocket socket = reflection ? reflectionSocket(device) : device.createRfcommSocketToServiceRecord(SPP_UUID);
        activeSocket = socket;
        state.method = reflection ? "reflection-channel-1" : "uuid";
        lastConnectResult = state.method;
        Future<Boolean> connected = attemptExecutor.submit(() -> {
            socket.connect();
            return true;
        });
        try {
            connected.get(ATTEMPT_TIMEOUT_MS, TimeUnit.MILLISECONDS);
        } catch (TimeoutException error) {
            closeQuietly(socket);
            connected.cancel(true);
            throw error;
        } catch (ExecutionException error) {
            Throwable cause = error.getCause() == null ? error : error.getCause();
            if (cause instanceof Exception) throw (Exception) cause;
            throw new IllegalStateException(cause == null ? error : cause);
        } catch (InterruptedException error) {
            closeQuietly(socket);
            connected.cancel(true);
            Thread.currentThread().interrupt();
            throw error;
        }
        return socket;
    }

    private JSONObject write(BluetoothSocket socket, byte[] data, PrintState state) {
        OutputStream output = null;
        try {
            output = socket.getOutputStream();
            // A logo makes the stream several KB; the printer buffer is happier with steady chunks.
            for (int offset = 0; offset < data.length; offset += WRITE_CHUNK_BYTES) {
                int length = Math.min(WRITE_CHUNK_BYTES, data.length - offset);
                output.write(data, offset, length);
                output.flush();
                if (offset + length < data.length) {
                    try { Thread.sleep(WRITE_CHUNK_GAP_MS); }
                    catch (InterruptedException error) { Thread.currentThread().interrupt(); return failure("spp-write-failed", error); }
                }
            }
            state.flushed = true;
            state.bytes = data.length;
            try { Thread.sleep(150L); }
            catch (InterruptedException error) { Thread.currentThread().interrupt(); }
            return success(state, data.length);
        } catch (Throwable error) {
            if (state.flushed) return success(state, state.bytes);
            return failure("spp-write-failed", error);
        } finally {
            try { if (output != null) output.close(); } catch (Exception ignored) { }
        }
    }

    private BluetoothSocket reflectionSocket(BluetoothDevice device) throws Exception {
        Method method = device.getClass().getMethod("createRfcommSocket", int.class);
        method.setAccessible(true);
        return (BluetoothSocket) method.invoke(device, 1);
    }

    private BluetoothAdapter requireAdapter() {
        BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
        if (adapter == null) return null;
        if (!adapter.isEnabled()) return null;
        if (Build.VERSION.SDK_INT >= 31 && context.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) {
            throw new SecurityException("Izin BLUETOOTH_CONNECT belum diberikan");
        }
        return adapter;
    }

    private Selection selectDevice(Set<BluetoothDevice> bonded) {
        String saved = context.getSharedPreferences("printer_diagnostics", Context.MODE_PRIVATE).getString(SAVED_MAC, "");
        for (BluetoothDevice device : bonded) if (saved.equalsIgnoreCase(device.getAddress())) return new Selection(device, "tersimpan");
        for (BluetoothDevice device : bonded) if (DEFAULT_MAC.equalsIgnoreCase(device.getAddress())) return new Selection(device, "default");
        for (BluetoothDevice device : bonded) if (DEFAULT_NAME.equalsIgnoreCase(device.getName())) return new Selection(device, "nama");
        return new Selection(null, "none");
    }

    private void markConnected(Selection selection) {
        connectionState = "connected";
        lastConnectAt = System.currentTimeMillis();
        selectedMac = selection.device.getAddress();
        selectedName = selection.device.getName() == null ? "" : selection.device.getName();
        selectionReason = selection.reason;
        context.getSharedPreferences("printer_diagnostics", Context.MODE_PRIVATE)
                .edit().putString(SAVED_MAC, selection.device.getAddress()).apply();
    }

    private JSONObject bluetoothOff() {
        connectionState = "idle";
        try {
            JSONObject result = new JSONObject();
            result.put("ok", false);
            result.put("status", "failed");
            result.put("errorClass", "spp-bluetooth-off");
            result.put("error", BLUETOOTH_OFF_MESSAGE);
            result.put("userMessage", BLUETOOTH_OFF_MESSAGE);
            return result;
        } catch (Exception error) {
            return new JSONObject();
        }
    }

    private JSONObject noDevice(BluetoothAdapter adapter) {
        connectionState = "idle";
        try {
            JSONObject result = new JSONObject();
            result.put("ok", false);
            result.put("status", "failed");
            result.put("errorClass", "spp-no-device");
            result.put("error", "Tidak ada bonded device yang cocok");
            result.put("userMessage", "Printer tidak ditemukan. Pasangkan printer lewat Bluetooth lalu coba lagi.");
            result.put("bondedDevices", bondedDevices(adapter == null ? null : adapter.getBondedDevices()));
            return result;
        } catch (Exception error) {
            return new JSONObject();
        }
    }

    private JSONArray bondedDevices(Set<BluetoothDevice> bonded) throws Exception {
        JSONArray devices = new JSONArray();
        if (bonded == null) return devices;
        for (BluetoothDevice device : bonded) {
            JSONObject entry = new JSONObject();
            entry.put("name", device.getName() == null ? "" : device.getName());
            entry.put("mac", device.getAddress());
            devices.put(entry);
        }
        return devices;
    }

    private JSONObject success(PrintState state, int bytesSent) {
        try {
            JSONObject result = new JSONObject();
            result.put("ok", true);
            result.put("status", "printed");
            result.put("connectResult", state.method);
            result.put("bytesSent", bytesSent);
            return result;
        } catch (Exception error) {
            return new JSONObject();
        }
    }

    private JSONObject failure(String errorClass, Throwable error) {
        boolean permissionMissing = "spp-permission".equals(errorClass) || error instanceof SecurityException;
        if (!permissionMissing) connectionState = "error";
        try {
            JSONObject result = new JSONObject();
            result.put("ok", false);
            result.put("status", "failed");
            result.put("errorClass", permissionMissing ? "spp-permission" : errorClass);
            result.put("error", error.getMessage() == null ? error.toString() : error.getMessage());
            result.put("userMessage", permissionMissing
                    ? "Izin Bluetooth belum diberikan. Beri izin Bluetooth lalu coba lagi."
                    : NOT_READY_MESSAGE);
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

    /** Merges printer state into a diagnostics payload without dropping what the caller recorded. */
    public JSONObject mergeState(JSONObject diagnostics) {
        JSONObject snapshot = snapshot();
        try {
            Iterator<String> keys = snapshot.keys();
            while (keys.hasNext()) {
                String key = keys.next();
                if (diagnostics != null && diagnostics.has(key)) continue;
                diagnostics.put(key, snapshot.get(key));
            }
        } catch (Exception ignored) { }
        return diagnostics;
    }

    private void closeQuietly(BluetoothSocket socket) {
        if (socket == null) return;
        try { socket.close(); } catch (Exception ignored) { }
    }

    private void closeActiveSocket() {
        BluetoothSocket socket = activeSocket;
        if (socket != null) try { socket.close(); } catch (Exception ignored) { }
        activeSocket = null;
    }

    private interface SocketAction {
        JSONObject run() throws Exception;
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
        volatile boolean flushed;
        volatile int bytes;
        volatile String method = "unknown";
    }
}
