package com.offlinefaceauth;

import android.media.Image;

import androidx.annotation.NonNull;

import com.mrousavy.camera.frameprocessor.Frame;

import org.tensorflow.lite.DataType;
import org.tensorflow.lite.Interpreter;
import org.tensorflow.lite.Tensor;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.MappedByteBuffer;
import java.nio.channels.FileChannel;
import java.util.HashMap;
import java.util.Map;

final class TFLiteFrameProcessorRunner {
  private static final int LANDMARK_FLOAT_COUNT = 468 * 3;
  private static final int EMBEDDING_FLOAT_COUNT = 128;
  private static final Object LOCK = new Object();

  private static Interpreter faceMeshInterpreter;
  private static Interpreter mobileFaceNetInterpreter;

  private TFLiteFrameProcessorRunner() {}

  static void initialize(String mobileFaceNetPath, String faceMeshPath) {
    synchronized (LOCK) {
      closeLocked();
      try {
        faceMeshInterpreter = createInterpreter(faceMeshPath);
      } catch (IOException | RuntimeException ignored) {
        faceMeshInterpreter = null;
      }

      try {
        mobileFaceNetInterpreter = createInterpreter(mobileFaceNetPath);
      } catch (IOException | RuntimeException ignored) {
        mobileFaceNetInterpreter = null;
      }
    }
  }

  static boolean isReady() {
    synchronized (LOCK) {
      return faceMeshInterpreter != null;
    }
  }

  static boolean process(@NonNull Frame frame) {
    synchronized (LOCK) {
      try {
        if (faceMeshInterpreter == null) {
          return false;
        }

        final Image image = frame.getImage();
        if (image == null || image.getPlanes().length == 0) {
          return false;
        }

        final Image.Plane yPlane = image.getPlanes()[0];
        final ByteBuffer yBuffer = yPlane.getBuffer();
        if (yBuffer == null) {
          return false;
        }

        final int width = image.getWidth();
        final int height = image.getHeight();
        final int stride = yPlane.getRowStride();
        final long timestampNs = image.getTimestamp();

        final float[] landmarks =
            runFaceMesh(yBuffer, width, height, stride);
        if (landmarks == null || landmarks.length < LANDMARK_FLOAT_COUNT) {
          return false;
        }

        final float[] embedding = mobileFaceNetInterpreter == null
            ? null
            : runMobileFaceNet(yBuffer, width, height, stride);

        return NativeBridge.nativeSubmitModelResult(
            landmarks, embedding, width, height, timestampNs);
      } catch (RuntimeException error) {
        return false;
      }
    }
  }

  private static Interpreter createInterpreter(String path) throws IOException {
    final File file = new File(path);
    if (!file.exists() || file.length() == 0L) {
      throw new IOException("Missing model: " + path);
    }

    final Interpreter.Options options = new Interpreter.Options();
    options.setNumThreads(detectThreadBudget());
    if (android.os.Build.VERSION.SDK_INT >= 27) {
      options.setUseNNAPI(true);
    }
    return new Interpreter(mapFile(file), options);
  }

  private static int detectThreadBudget() {
    return Runtime.getRuntime().availableProcessors() >= 8 ? 3 : 2;
  }

  private static MappedByteBuffer mapFile(File file) throws IOException {
    try (FileInputStream input = new FileInputStream(file);
         FileChannel channel = input.getChannel()) {
      return channel.map(FileChannel.MapMode.READ_ONLY, 0, channel.size());
    }
  }

  private static float[] runFaceMesh(
      ByteBuffer yBuffer, int width, int height, int stride) {
    final Tensor inputTensor = faceMeshInterpreter.getInputTensor(0);
    final int[] inputShape = inputTensor.shape();
    if (inputShape.length < 4) {
      return null;
    }

    final ByteBuffer input =
        makeInputBuffer(inputTensor, yBuffer, width, height, stride);
    final Map<Integer, Object> outputs = new HashMap<>();
    for (int i = 0; i < faceMeshInterpreter.getOutputTensorCount(); i++) {
      final Tensor outputTensor = faceMeshInterpreter.getOutputTensor(i);
      final int floatCount = countElements(outputTensor.shape());
      if (floatCount >= LANDMARK_FLOAT_COUNT && outputTensor.dataType() == DataType.FLOAT32) {
        outputs.put(i, makeTensorBuffer(outputTensor));
      }
    }

    if (outputs.isEmpty()) {
      return null;
    }

    faceMeshInterpreter.runForMultipleInputsOutputs(new Object[] {input}, outputs);
    for (Object value : outputs.values()) {
      final ByteBuffer output = (ByteBuffer) value;
      final float[] values = readFloatOutput(output, LANDMARK_FLOAT_COUNT);
      if (values.length >= LANDMARK_FLOAT_COUNT) {
        return normalizeLandmarkCoordinates(values, width, height);
      }
    }
    return null;
  }

  private static float[] runMobileFaceNet(
      ByteBuffer yBuffer, int width, int height, int stride) {
    final Tensor inputTensor = mobileFaceNetInterpreter.getInputTensor(0);
    final ByteBuffer input =
        makeInputBuffer(inputTensor, yBuffer, width, height, stride);

    for (int i = 0; i < mobileFaceNetInterpreter.getOutputTensorCount(); i++) {
      final Tensor outputTensor = mobileFaceNetInterpreter.getOutputTensor(i);
      final int count = countElements(outputTensor.shape());
      if (count < EMBEDDING_FLOAT_COUNT) {
        continue;
      }

      final ByteBuffer output = makeTensorBuffer(outputTensor);
      mobileFaceNetInterpreter.run(input, output);
      final float[] embedding = readOutputAsFloat(output, outputTensor, EMBEDDING_FLOAT_COUNT);
      if (embedding.length < EMBEDDING_FLOAT_COUNT) {
        continue;
      }
      normalizeL2(embedding);
      return embedding;
    }
    return null;
  }

  private static ByteBuffer makeInputBuffer(
      Tensor inputTensor, ByteBuffer yBuffer, int width, int height, int stride) {
    final int[] shape = inputTensor.shape();
    final int inputHeight = shape.length > 1 ? shape[1] : 112;
    final int inputWidth = shape.length > 2 ? shape[2] : 112;
    final int channels = shape.length > 3 ? shape[3] : 3;
    final DataType type = inputTensor.dataType();
    final int bytesPerValue = type == DataType.FLOAT32 ? 4 : 1;
    final ByteBuffer input = ByteBuffer.allocateDirect(
        inputHeight * inputWidth * channels * bytesPerValue);
    input.order(ByteOrder.nativeOrder());

    final ByteBuffer source = yBuffer.duplicate();
    source.position(0);

    for (int y = 0; y < inputHeight; y++) {
      for (int x = 0; x < inputWidth; x++) {
        final int srcX = Math.min(width - 1, Math.max(0, x * width / inputWidth));
        final int srcY = Math.min(height - 1, Math.max(0, y * height / inputHeight));
        final int luma = source.get((srcY * stride) + srcX) & 0xff;
        for (int c = 0; c < channels; c++) {
          if (type == DataType.FLOAT32) {
            input.putFloat(luma / 255.0f);
          } else {
            input.put((byte) luma);
          }
        }
      }
    }
    input.rewind();
    return input;
  }

  private static ByteBuffer makeTensorBuffer(Tensor tensor) {
    final ByteBuffer buffer = ByteBuffer.allocateDirect(tensor.numBytes());
    buffer.order(ByteOrder.nativeOrder());
    return buffer;
  }

  private static float[] readFloatOutput(ByteBuffer buffer, int maxCount) {
    buffer.rewind();
    final int count = Math.min(maxCount, buffer.remaining() / 4);
    final float[] values = new float[count];
    for (int i = 0; i < count; i++) {
      values[i] = buffer.getFloat();
    }
    return values;
  }

  private static float[] readOutputAsFloat(
      ByteBuffer buffer, Tensor tensor, int maxCount) {
    buffer.rewind();
    final int count = Math.min(maxCount, countElements(tensor.shape()));
    final float[] values = new float[count];
    if (tensor.dataType() == DataType.FLOAT32) {
      for (int i = 0; i < count; i++) {
        values[i] = buffer.getFloat();
      }
    } else if (tensor.dataType() == DataType.UINT8) {
      for (int i = 0; i < count; i++) {
        values[i] = ((buffer.get() & 0xff) - tensor.quantizationParams().getZeroPoint()) *
            tensor.quantizationParams().getScale();
      }
    }
    return values;
  }

  private static float[] normalizeLandmarkCoordinates(
      float[] raw, int width, int height) {
    final float[] values = new float[LANDMARK_FLOAT_COUNT];
    System.arraycopy(raw, 0, values, 0, LANDMARK_FLOAT_COUNT);

    float maxAbsX = 0.0f;
    float maxAbsY = 0.0f;
    for (int i = 0; i < LANDMARK_FLOAT_COUNT; i += 3) {
      maxAbsX = Math.max(maxAbsX, Math.abs(values[i]));
      maxAbsY = Math.max(maxAbsY, Math.abs(values[i + 1]));
    }

    if (maxAbsX <= 2.0f && maxAbsY <= 2.0f) {
      for (int i = 0; i < LANDMARK_FLOAT_COUNT; i += 3) {
        values[i] *= width;
        values[i + 1] *= height;
      }
    }
    return values;
  }

  private static int countElements(int[] shape) {
    int count = 1;
    for (int dim : shape) {
      count *= Math.max(1, dim);
    }
    return count;
  }

  private static void normalizeL2(float[] values) {
    double sum = 0.0;
    for (float value : values) {
      sum += value * value;
    }
    final double norm = Math.sqrt(sum);
    if (norm <= 1.0e-6) {
      return;
    }
    for (int i = 0; i < values.length; i++) {
      values[i] = (float) (values[i] / norm);
    }
  }

  private static void closeLocked() {
    if (faceMeshInterpreter != null) {
      faceMeshInterpreter.close();
      faceMeshInterpreter = null;
    }
    if (mobileFaceNetInterpreter != null) {
      mobileFaceNetInterpreter.close();
      mobileFaceNetInterpreter = null;
    }
  }
}
