package id.vianjaya.kasir.cabang1;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/**
 * Width guard for the SPP test receipt: the paper decides how many columns fit, so the receipt
 * must wrap instead of clipping. Runs on a plain JVM because the builder has no Android imports.
 */
public class EscPosReceiptBuilderTest {

    @Test
    public void paperWidthMapsToColumns() {
        assertEquals(32, EscPosReceiptBuilder.columnsForPaperWidth("58mm"));
        assertEquals(48, EscPosReceiptBuilder.columnsForPaperWidth("80mm"));
        assertEquals(48, EscPosReceiptBuilder.columnsForPaperWidth(null));
        assertEquals(48, EscPosReceiptBuilder.columnsForPaperWidth(""));
        assertEquals(58, EscPosReceiptBuilder.paperWidthMm("58mm"));
        assertEquals(80, EscPosReceiptBuilder.paperWidthMm("80mm"));
    }

    @Test
    public void fiftyEightMillimetreReceiptStaysWithin32Columns() {
        assertWithinColumns(32, receiptLines(32));
    }

    @Test
    public void eightyMillimetreReceiptStaysWithin48Columns() {
        assertWithinColumns(48, receiptLines(48));
    }

    @Test
    public void everyWidthReportsItsOwnColumnCount() {
        assertEquals(32, new EscPosReceiptBuilder(32).columns());
        assertEquals(48, new EscPosReceiptBuilder(48).columns());
        assertEquals(48, new EscPosReceiptBuilder(40).columns());
        assertEquals(58, new EscPosReceiptBuilder(32).paperWidthMm());
        assertEquals(80, new EscPosReceiptBuilder(48).paperWidthMm());
    }

    @Test
    public void rulerCoversEveryActiveColumn() {
        for (int width : new int[]{32, 48}) {
            EscPosReceiptBuilder builder = new EscPosReceiptBuilder(width);
            assertEquals(width, builder.ruler().length());
            assertEquals(width, builder.rulerTens().length());
            assertEquals(repeat("1234567890", width), builder.ruler());
            for (int column = 10; column <= width; column += 10) {
                assertEquals("tens mark missing at column " + column,
                        String.valueOf((char) ('0' + (column / 10) % 10)),
                        String.valueOf(builder.rulerTens().charAt(column - 1)));
                assertEquals("ruler digit wrong at column " + column,
                        String.valueOf((char) ('0' + column % 10)),
                        String.valueOf(builder.ruler().charAt(column - 1)));
            }
        }
    }

    @Test
    public void receiptCarriesTheWidthLabelAndRuler() {
        for (int width : new int[]{32, 48}) {
            EscPosReceiptBuilder builder = new EscPosReceiptBuilder(width);
            List<String> lines = receiptLines(builder.buildTestReceipt("Vian Jaya 08", "2026-01-02 03:04:05", "-", "Cash"));
            assertTrue("missing width label for " + width,
                    lines.contains("LEBAR " + builder.paperWidthMm() + " MM / " + width + " KOLOM"));
            assertTrue("missing ruler for " + width, lines.contains(builder.ruler()));
            assertTrue("missing tens ruler for " + width, lines.contains(builder.rulerTens()));
        }
    }

    @Test
    public void longTextIsWrappedNotClipped() {
        String storeName = "Kasir Vian Jaya Cabang Sembilan Belas Kelpayan Nusantara Timur";
        EscPosReceiptBuilder builder = new EscPosReceiptBuilder(48);
        List<String> lines = receiptLines(builder.buildTestReceipt(
                storeName, "2026-01-02 03:04:05", "Meja Ranjang Samping Jendela", "Cash"));
        assertTrue("store name should be wrapped over more than one line", lines.size() > 8);
        assertWithinColumns(48, lines);
        assertTrue("wrapped content must survive wrapping",
                String.join("", lines).contains("Kelpayan Nusantara Timur"));
    }

    private String repeat(String pattern, int length) {
        StringBuilder result = new StringBuilder(length);
        while (result.length() < length) result.append(pattern);
        return result.substring(0, length);
    }

    private List<String> receiptLines(byte[] stream) {
        return textLines(stream);
    }

    private List<String> receiptLines(int columns) {
        return textLines(new EscPosReceiptBuilder(columns)
                .buildTestReceipt("Vian Jaya 08", "2026-01-02 03:04:05", "-", "Cash"));
    }

    private void assertWithinColumns(int columns, List<String> lines) {
        for (String line : lines) {
            assertTrue("line longer than " + columns + " columns: [" + line + "]",
                    line.length() <= columns);
        }
    }

    /** Splits the ESC/POS stream into printable lines, dropping command bytes. */
    private List<String> textLines(byte[] stream) {
        List<String> lines = new ArrayList<>();
        ByteArrayOutputStream current = new ByteArrayOutputStream();
        for (int index = 0; index < stream.length; index++) {
            int value = stream[index] & 0xFF;
            if (value == 0x1B || value == 0x1D) {
                index = skipCommand(stream, index);
                continue;
            }
            if (value == '\n') {
                lines.add(new String(current.toByteArray(), StandardCharsets.ISO_8859_1));
                current.reset();
                continue;
            }
            current.write(value);
        }
        if (current.size() > 0) lines.add(new String(current.toByteArray(), StandardCharsets.ISO_8859_1));
        return lines;
    }

    /** ESC/GS commands here are two or three bytes; the printer ignores the remainder. */
    private int skipCommand(byte[] stream, int index) {
        if (index + 1 >= stream.length) return index;
        int next = stream[index + 1] & 0xFF;
        if (next == 0x21) return index + 2;
        if (next == 0x64) return index + 2;
        if (next == 0x61 || next == 0x45 || next == 0x40 || next == 0x74) return index + 2;
        if (next == 0x56) return index + 3;
        return index + 1;
    }
}
