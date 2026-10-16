package id.vianjaya.kasir.cabang1;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.text.NumberFormat;
import java.text.Normalizer;
import java.util.Locale;

/**
 * Builds the ESC/POS byte stream for the SPP test receipt.
 *
 * <p>Pure Java on purpose: no Android imports, so it can be exercised by a plain JVM unit test.
 */
public final class EscPosReceiptBuilder {
    public static final int COLUMNS_58MM = 32;
    public static final int COLUMNS_80MM = 48;

    private static final byte ESC = 0x1B;
    private static final byte GS = 0x1D;
    private final int width;

    public EscPosReceiptBuilder(int width) {
        this.width = width == COLUMNS_58MM ? COLUMNS_58MM : COLUMNS_80MM;
    }

    public static EscPosReceiptBuilder forPaperWidth(String paperWidth) {
        return new EscPosReceiptBuilder(columnsForPaperWidth(paperWidth));
    }

    public static int columnsForPaperWidth(String paperWidth) {
        return "58mm".equalsIgnoreCase(paperWidth) ? COLUMNS_58MM : COLUMNS_80MM;
    }

    public static int paperWidthMm(String paperWidth) {
        return "58mm".equalsIgnoreCase(paperWidth) ? 58 : 80;
    }

    public int columns() {
        return width;
    }

    public int paperWidthMm() {
        return width == COLUMNS_58MM ? 58 : 80;
    }

    public byte[] buildTestReceipt(String storeName, String dateTime, String table, String payment) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        command(out, ESC, 0x40); // initialize
        command(out, ESC, 0x74, 0x00); // PC437
        command(out, ESC, 0x61, 0x01); // center
        command(out, ESC, 0x45, 0x01); // bold
        command(out, GS, 0x21, 0x11); // double width and height
        text(out, storeName, Math.max(1, width / 2));
        command(out, GS, 0x21, 0x00);
        command(out, ESC, 0x45, 0x00);
        text(out, dateTime, width);
        text(out, "LEBAR " + paperWidthMm() + " MM / " + width + " KOLOM", width);
        command(out, ESC, 0x61, 0x00); // left
        text(out, ruler(), width);
        text(out, rulerTens(), width);
        text(out, repeat('-', width), width);
        text(out, "Meja: " + table, width);
        text(out, "Bayar: " + payment, width);
        text(out, repeat('-', width), width);
        item(out, "Nasi Goreng Seafood", 1, 25000);
        item(out, "Es Teh Manis", 2, 5000);
        text(out, repeat('-', width), width);
        text(out, rightAligned("TOTAL", rupiah(35000)), width);
        text(out, "", width);
        command(out, ESC, 0x61, 0x01);
        command(out, ESC, 0x45, 0x01);
        text(out, "TES CETAK OK", width);
        command(out, ESC, 0x45, 0x00);
        command(out, ESC, 0x61, 0x00);
        command(out, ESC, 0x64, 0x04); // feed four lines
        command(out, GS, 0x56, 0x42, 0x00); // cut; devices without cutters ignore it
        return out.toByteArray();
    }

    /** Column ruler: the last digit of every ten-column step, so cut-off edges are obvious. */
    public String ruler() {
        StringBuilder result = new StringBuilder(width);
        for (int column = 1; column <= width; column++) result.append((char) ('0' + column % 10));
        return result.toString();
    }

    /** Tens marks placed on the ruler, every tenth column. */
    public String rulerTens() {
        StringBuilder result = new StringBuilder(width);
        for (int column = 1; column <= width; column++) {
            if (column % 10 == 0) result.append((char) ('0' + (column / 10) % 10));
            else result.append(' ');
        }
        return result.toString();
    }

    private void item(ByteArrayOutputStream out, String name, int quantity, long price) {
        String right = quantity + " x " + rupiah(price);
        int leftWidth = Math.max(1, width - right.length() - 1);
        String cleanName = ascii(name);
        boolean first = true;
        while (!cleanName.isEmpty()) {
            int end = Math.min(leftWidth, cleanName.length());
            String part = cleanName.substring(0, end);
            cleanName = cleanName.substring(end).trim();
            if (first) {
                text(out, padRight(part, leftWidth) + " " + right, width);
                first = false;
            } else {
                text(out, part, width);
            }
        }
    }

    private String rightAligned(String left, String right) {
        int gap = width - left.length() - right.length();
        return left + repeat(' ', Math.max(1, gap)) + right;
    }

    private String rupiah(long amount) {
        return "Rp " + NumberFormat.getIntegerInstance(new Locale("id", "ID")).format(amount);
    }

    private String padRight(String value, int length) {
        return value + repeat(' ', Math.max(0, length - value.length()));
    }

    private String repeat(char value, int count) {
        StringBuilder result = new StringBuilder(Math.max(0, count));
        for (int i = 0; i < count; i++) result.append(value);
        return result.toString();
    }

    /** Writes text wrapped at {@code maxColumns}, so nothing is clipped by the paper edge. */
    private void text(ByteArrayOutputStream out, String value, int maxColumns) {
        int limit = Math.max(1, maxColumns);
        String clean = ascii(value);
        if (clean.isEmpty()) {
            line(out, "");
            return;
        }
        int start = 0;
        while (start < clean.length()) {
            int end = Math.min(start + limit, clean.length());
            line(out, clean.substring(start, end));
            start = end;
        }
    }

    private void line(ByteArrayOutputStream out, String value) {
        byte[] bytes = ascii(value).getBytes(StandardCharsets.ISO_8859_1);
        out.write(bytes, 0, bytes.length);
        out.write('\n');
    }

    private void command(ByteArrayOutputStream out, int... values) {
        for (int value : values) out.write(value & 0xFF);
    }

    private String ascii(String value) {
        if (value == null) return "";
        String normalized = value.replace('\u2018', '\'').replace('\u2019', '\'')
                .replace('\u201c', '"').replace('\u201d', '"')
                .replace('\u2013', '-').replace('\u2014', '-')
                .replace('\u00a0', ' ');
        return Normalizer.normalize(normalized, Normalizer.Form.NFD)
                .replaceAll("\\p{M}", "")
                .replaceAll("[^\\x00-\\x7F]", "?");
    }
}
