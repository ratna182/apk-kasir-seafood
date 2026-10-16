package id.vianjaya.kasir.cabang1;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.text.NumberFormat;
import java.text.Normalizer;
import java.util.Locale;

public final class EscPosReceiptBuilder {
    private static final byte ESC = 0x1B;
    private static final byte GS = 0x1D;
    private final int width;

    public EscPosReceiptBuilder(int width) {
        this.width = width == 48 ? 48 : 32;
    }

    public byte[] buildTestReceipt(String storeName, String dateTime, String table, String payment) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        command(out, ESC, 0x40); // initialize
        command(out, ESC, 0x74, 0x00); // PC437
        command(out, ESC, 0x61, 0x01); // center
        command(out, ESC, 0x45, 0x01); // bold
        command(out, GS, 0x21, 0x11); // double width and height
        line(out, storeName);
        command(out, GS, 0x21, 0x00);
        command(out, ESC, 0x45, 0x00);
        line(out, dateTime);
        command(out, ESC, 0x61, 0x00); // left
        line(out, repeat('-', width));
        line(out, "Meja: " + table);
        line(out, "Bayar: " + payment);
        line(out, repeat('-', width));
        item(out, "Nasi Goreng Seafood", 1, 25000);
        item(out, "Es Teh Manis", 2, 5000);
        line(out, repeat('-', width));
        line(out, rightAligned("TOTAL", rupiah(35000)));
        line(out, "");
        command(out, ESC, 0x61, 0x01);
        command(out, ESC, 0x45, 0x01);
        line(out, "TES CETAK OK");
        command(out, ESC, 0x45, 0x00);
        command(out, ESC, 0x61, 0x00);
        command(out, ESC, 0x64, 0x04); // feed four lines
        try {
            command(out, GS, 0x56, 0x42, 0x00); // cut; devices without cutters ignore it
        } catch (RuntimeException ignored) {
            // A cutter is optional for this SPP path.
        }
        return out.toByteArray();
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
                line(out, padRight(part, leftWidth) + " " + right);
                first = false;
            } else {
                line(out, part);
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
