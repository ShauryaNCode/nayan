package com.offlinefaceauth;

import java.util.Arrays;

final class CryptoUtils {
  private CryptoUtils() {}

  static void requirePersonnelId(String personnelId) {
    if (personnelId == null || personnelId.trim().isEmpty()) {
      throw new IllegalArgumentException("personnelId must not be empty");
    }
  }

  static byte[] hexToBytes(String hex, int expectedLengthBytes) {
    if (hex == null) {
      throw new IllegalArgumentException("hex must not be null");
    }

    final String normalized = hex.trim();
    if ((normalized.length() % 2) != 0) {
      throw new IllegalArgumentException("hex length must be even");
    }

    final byte[] bytes = new byte[normalized.length() / 2];
    for (int i = 0; i < normalized.length(); i += 2) {
      final int high = Character.digit(normalized.charAt(i), 16);
      final int low = Character.digit(normalized.charAt(i + 1), 16);
      if (high < 0 || low < 0) {
        Arrays.fill(bytes, (byte) 0);
        throw new IllegalArgumentException("hex contains a non-hex character");
      }
      bytes[i / 2] = (byte) ((high << 4) + low);
    }

    if (bytes.length != expectedLengthBytes) {
      Arrays.fill(bytes, (byte) 0);
      throw new IllegalArgumentException(
          "expected " + expectedLengthBytes + " bytes, got " + bytes.length);
    }

    return bytes;
  }

  static String bytesToHex(byte[] bytes) {
    final StringBuilder builder = new StringBuilder(bytes.length * 2);
    for (byte value : bytes) {
      builder.append(String.format("%02x", value & 0xff));
    }
    return builder.toString();
  }

  static byte[] concat(byte[] first, byte[] second) {
    final byte[] output = new byte[first.length + second.length];
    System.arraycopy(first, 0, output, 0, first.length);
    System.arraycopy(second, 0, output, first.length, second.length);
    return output;
  }

  static void wipe(byte[] bytes) {
    if (bytes != null) {
      Arrays.fill(bytes, (byte) 0);
    }
  }
}
