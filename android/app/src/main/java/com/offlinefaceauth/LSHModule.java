package com.offlinefaceauth;

import androidx.annotation.NonNull;

import android.util.Base64;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.ReadableArray;
import com.facebook.react.bridge.WritableArray;
import com.facebook.react.module.annotations.ReactModule;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;

@ReactModule(name = LSHModule.NAME)
public final class LSHModule extends ReactContextBaseJavaModule {
  public static final String NAME = "LSHModule";

  private static final int BANDS = 4;
  private static final int PLANES_PER_BAND = 6;
  private static final int DIMS = 128;
  private static final int EMBEDDING_BYTES = DIMS * Float.BYTES;

  static {
    System.loadLibrary("offline_face_auth_jni");
  }

  public LSHModule(ReactApplicationContext reactContext) {
    super(reactContext);
  }

  private static native void nativeLoadHyperplanes(
      float[] values,
      int bands,
      int planesPerBand,
      int dims);

  private static native String[] nativeComputeBucketKeys(
      float[] embedding,
      int dims);

  @NonNull
  @Override
  public String getName() {
    return NAME;
  }

  @ReactMethod
  public void loadHyperplanes(ReadableArray hyperplanes, Promise promise) {
    try {
      final float[] values = flattenHyperplanes(hyperplanes);
      nativeLoadHyperplanes(values, BANDS, PLANES_PER_BAND, DIMS);
      promise.resolve(null);
    } catch (Throwable throwable) {
      promise.reject("E_LSH_LOAD_HYPERPLANES", throwable);
    }
  }

  @ReactMethod
  public void computeBucketKeys(String embeddingBase64, Promise promise) {
    try {
      final float[] embedding = decodeEmbedding(embeddingBase64);
      final String[] keys = nativeComputeBucketKeys(embedding, DIMS);
      final WritableArray result = Arguments.createArray();
      for (String key : keys) {
        result.pushString(key);
      }
      promise.resolve(result);
    } catch (Throwable throwable) {
      promise.reject("E_LSH_COMPUTE_BUCKET_KEYS", throwable);
    }
  }

  private static float[] flattenHyperplanes(ReadableArray hyperplanes) {
    if (hyperplanes == null || hyperplanes.size() != BANDS) {
      throw new IllegalArgumentException("LSH hyperplanes must have 4 bands");
    }

    final float[] values = new float[BANDS * PLANES_PER_BAND * DIMS];
    int offset = 0;
    for (int b = 0; b < BANDS; b++) {
      final ReadableArray band = hyperplanes.getArray(b);
      if (band == null || band.size() != PLANES_PER_BAND) {
        throw new IllegalArgumentException(
            "LSH hyperplanes must have 6 planes per band");
      }

      for (int p = 0; p < PLANES_PER_BAND; p++) {
        final ReadableArray plane = band.getArray(p);
        if (plane == null || plane.size() != DIMS) {
          throw new IllegalArgumentException(
              "LSH hyperplanes must have 128 dimensions per plane");
        }

        for (int d = 0; d < DIMS; d++) {
          values[offset++] = (float) plane.getDouble(d);
        }
      }
    }

    return values;
  }

  private static float[] decodeEmbedding(String embeddingBase64) {
    final byte[] bytes = Base64.decode(embeddingBase64, Base64.NO_WRAP);
    if (bytes.length != EMBEDDING_BYTES) {
      throw new IllegalArgumentException(
          "LSH embedding must decode to 512 bytes");
    }

    final ByteBuffer buffer = ByteBuffer.wrap(bytes).order(ByteOrder.nativeOrder());
    final float[] embedding = new float[DIMS];
    for (int i = 0; i < DIMS; i++) {
      embedding[i] = buffer.getFloat();
    }
    return embedding;
  }
}
