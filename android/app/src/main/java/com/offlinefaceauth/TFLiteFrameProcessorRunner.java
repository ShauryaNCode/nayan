package com.offlinefaceauth;

import android.media.Image;
import android.util.Log;

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
  private static final String TAG = "NayanTFLiteRunner";
  private static final int LANDMARK_FLOAT_COUNT = 468 * 3;
  private static final int EMBEDDING_FLOAT_COUNT = 128;
  private static final float FACE_PRESENCE_HARD_REJECT_THRESHOLD = 0.50f;
  private static final Object LOCK = new Object();

  private static Interpreter faceMeshInterpreter;
  private static Interpreter mobileFaceNetInterpreter;

  private TFLiteFrameProcessorRunner() {}

  static void initialize(String mobileFaceNetPath, String faceMeshPath) {
    synchronized (LOCK) {
      closeLocked();
      try {
        faceMeshInterpreter = createInterpreter(faceMeshPath);
      } catch (IOException | RuntimeException error) {
        Log.w(TAG, "FaceMesh interpreter failed to initialize", error);
        faceMeshInterpreter = null;
      }

      try {
        mobileFaceNetInterpreter = createInterpreter(mobileFaceNetPath);
      } catch (IOException | RuntimeException error) {
        Log.w(TAG, "MobileFaceNet interpreter failed to initialize", error);
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
      Image image = null;
      try {
        if (faceMeshInterpreter == null) {
          return false;
        }

        image = frame.getImage();
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
        final long inferenceStartedNs = System.nanoTime();

        if (!frameLooksLikeFaceCandidate(image, yBuffer, width, height, stride)) {
          final float inferenceMs =
              (System.nanoTime() - inferenceStartedNs) / 1_000_000.0f;
          return NativeBridge.nativeSubmitModelResult(
              new float[LANDMARK_FLOAT_COUNT],
              null,
              width,
              height,
              timestampNs,
              inferenceMs);
        }

        final FaceMeshOutput faceMeshOutput =
            runFaceMesh(yBuffer, width, height, stride);
        if (faceMeshOutput == null) {
          return false;
        }
        if (!faceMeshOutput.facePresent) {
          final float inferenceMs =
              (System.nanoTime() - inferenceStartedNs) / 1_000_000.0f;
          return NativeBridge.nativeSubmitModelResult(
              new float[LANDMARK_FLOAT_COUNT],
              null,
              width,
              height,
              timestampNs,
              inferenceMs);
        }
        final float[] landmarks = faceMeshOutput.landmarks;

        float[] embedding = mobileFaceNetInterpreter == null
            ? null
            : runMobileFaceNet(yBuffer, width, height, stride);
        if (embedding == null) {
          embedding = runDeterministicEmbedding(yBuffer, width, height, stride);
        }
        final float inferenceMs =
            (System.nanoTime() - inferenceStartedNs) / 1_000_000.0f;

        return NativeBridge.nativeSubmitModelResult(
            landmarks, embedding, width, height, timestampNs, inferenceMs);
      } catch (RuntimeException error) {
        return false;
      } finally {
        if (image != null) {
          image.close();
        }
      }
    }
  }

  private static Interpreter createInterpreter(String path) throws IOException {
    final File file = new File(path);
    if (!file.exists() || file.length() == 0L) {
      throw new IOException("Missing model: " + path);
    }

    if (android.os.Build.VERSION.SDK_INT >= 27) {
      try {
        return createInterpreterWithOptions(file, true);
      } catch (RuntimeException error) {
        Log.w(TAG, "NNAPI interpreter creation failed; retrying CPU", error);
      }
    }
    return createInterpreterWithOptions(file, false);
  }

  private static Interpreter createInterpreterWithOptions(File file, boolean useNnapi)
      throws IOException {
    final Interpreter.Options options = new Interpreter.Options();
    options.setNumThreads(detectThreadBudget());
    options.setUseNNAPI(useNnapi);
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

  private static FaceMeshOutput runFaceMesh(
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
      if (outputTensor.dataType() == DataType.FLOAT32) {
        outputs.put(i, makeTensorBuffer(outputTensor));
      }
    }

    if (outputs.isEmpty()) {
      return null;
    }

    faceMeshInterpreter.runForMultipleInputsOutputs(new Object[] {input}, outputs);
    float[] landmarks = null;
    boolean hasPresenceScore = false;
    float presenceScore = 0.0f;

    for (Map.Entry<Integer, Object> entry : outputs.entrySet()) {
      final Tensor tensor = faceMeshInterpreter.getOutputTensor(entry.getKey());
      final ByteBuffer output = (ByteBuffer) entry.getValue();
      final int valueCount = countElements(tensor.shape());
      if (valueCount >= LANDMARK_FLOAT_COUNT) {
        final float[] values = readFloatOutput(output, LANDMARK_FLOAT_COUNT);
        if (values.length >= LANDMARK_FLOAT_COUNT) {
          landmarks = normalizeLandmarkCoordinates(values, width, height);
        }
      } else if (valueCount == 1) {
        final float[] values = readFloatOutput(output, valueCount);
        for (float value : values) {
          if (Float.isFinite(value)) {
            presenceScore = Math.max(presenceScore, sigmoidIfNeeded(value));
            hasPresenceScore = true;
          }
        }
      }
    }

    if (landmarks == null) {
      return null;
    }
    final boolean confidenceAllowsFace =
        !hasPresenceScore || presenceScore >= FACE_PRESENCE_HARD_REJECT_THRESHOLD;
    final boolean facePresent =
        confidenceAllowsFace && landmarksLookLikeFace(landmarks, width, height);
    return new FaceMeshOutput(landmarks, facePresent, presenceScore);
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

  private static float[] runDeterministicEmbedding(
      ByteBuffer yBuffer, int width, int height, int stride) {
    if (yBuffer == null || width <= 0 || height <= 0 || stride < width) {
      return null;
    }

    final ByteBuffer source = yBuffer.duplicate();
    source.position(0);
    final float[] embedding = new float[EMBEDDING_FLOAT_COUNT];
    final int cells = 16;
    final int bins = 8;
    for (int cy = 0; cy < cells; cy++) {
      for (int cx = 0; cx < cells; cx++) {
        int count = 0;
        int sum = 0;
        final int startX = cx * width / cells;
        final int endX = Math.max(startX + 1, (cx + 1) * width / cells);
        final int startY = cy * height / cells;
        final int endY = Math.max(startY + 1, (cy + 1) * height / cells);
        final int stepX = Math.max(1, (endX - startX) / 4);
        final int stepY = Math.max(1, (endY - startY) / 4);
        for (int y = startY; y < endY; y += stepY) {
          for (int x = startX; x < endX; x += stepX) {
            sum += source.get((Math.min(height - 1, y) * stride) + Math.min(width - 1, x)) & 0xff;
            count++;
          }
        }
        final float value = count == 0 ? 0.0f : (sum / (float) count) / 255.0f;
        final int slot = ((cy * cells) + cx) % EMBEDDING_FLOAT_COUNT;
        final int bin = Math.min(bins - 1, Math.max(0, (int) (value * bins)));
        embedding[slot] += value + (bin * 0.015625f);
      }
    }
    normalizeL2(embedding);
    return embedding;
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
          } else if (type == DataType.INT8) {
            final float scale = inputTensor.quantizationParams().getScale();
            final int zeroPoint = inputTensor.quantizationParams().getZeroPoint();
            final int quantized = scale <= 0.0f
                ? luma - 128
                : Math.round((luma / 255.0f) / scale) + zeroPoint;
            input.put((byte) Math.max(-128, Math.min(127, quantized)));
          } else {
            final float scale = inputTensor.quantizationParams().getScale();
            final int zeroPoint = inputTensor.quantizationParams().getZeroPoint();
            final int quantized = scale <= 0.0f
                ? luma
                : Math.round((luma / 255.0f) / scale) + zeroPoint;
            input.put((byte) Math.max(0, Math.min(255, quantized)));
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

  private static boolean frameLooksLikeFaceCandidate(
      Image image, ByteBuffer yBuffer, int width, int height, int stride) {
    return frameHasEnoughTexture(yBuffer, width, height, stride) &&
        frameHasSkinLikeChroma(image, width, height);
  }

  private static boolean frameHasEnoughTexture(
      ByteBuffer yBuffer, int width, int height, int stride) {
    if (yBuffer == null || width <= 0 || height <= 0 || stride < width) {
      return false;
    }

    final ByteBuffer source = yBuffer.duplicate();
    source.position(0);
    final int stepX = Math.max(1, width / 24);
    final int stepY = Math.max(1, height / 24);
    int count = 0;
    double sum = 0.0;
    double sumSquares = 0.0;
    double gradientSum = 0.0;
    int gradientCount = 0;

    for (int y = stepY; y < height - stepY; y += stepY) {
      for (int x = stepX; x < width - stepX; x += stepX) {
        final int luma = source.get((y * stride) + x) & 0xff;
        sum += luma;
        sumSquares += luma * luma;
        count++;

        final int right = source.get((y * stride) + Math.min(width - 1, x + stepX)) & 0xff;
        final int down = source.get((Math.min(height - 1, y + stepY) * stride) + x) & 0xff;
        gradientSum += Math.abs(luma - right) + Math.abs(luma - down);
        gradientCount += 2;
      }
    }

    if (count < 16 || gradientCount == 0) {
      return false;
    }

    final double mean = sum / count;
    final double variance = Math.max(0.0, (sumSquares / count) - (mean * mean));
    final double stddev = Math.sqrt(variance);
    final double averageGradient = gradientSum / gradientCount;
    return stddev >= 11.0 || averageGradient >= 5.5;
  }

  private static boolean frameHasSkinLikeChroma(Image image, int width, int height) {
    if (image == null || image.getPlanes().length < 3 || width <= 0 || height <= 0) {
      return true;
    }

    final Image.Plane uPlane = image.getPlanes()[1];
    final Image.Plane vPlane = image.getPlanes()[2];
    final ByteBuffer u = uPlane.getBuffer().duplicate();
    final ByteBuffer v = vPlane.getBuffer().duplicate();
    final int uRowStride = uPlane.getRowStride();
    final int vRowStride = vPlane.getRowStride();
    final int uPixelStride = uPlane.getPixelStride();
    final int vPixelStride = vPlane.getPixelStride();
    final int chromaWidth = Math.max(1, width / 2);
    final int chromaHeight = Math.max(1, height / 2);
    final int startX = chromaWidth / 5;
    final int endX = chromaWidth - startX;
    final int startY = chromaHeight / 6;
    final int endY = chromaHeight - startY;
    final int stepX = Math.max(1, chromaWidth / 24);
    final int stepY = Math.max(1, chromaHeight / 24);
    int samples = 0;
    int skinLike = 0;

    for (int y = startY; y < endY; y += stepY) {
      for (int x = startX; x < endX; x += stepX) {
        final int uIndex = (y * uRowStride) + (x * uPixelStride);
        final int vIndex = (y * vRowStride) + (x * vPixelStride);
        if (uIndex < 0 || uIndex >= u.capacity() || vIndex < 0 || vIndex >= v.capacity()) {
          continue;
        }
        final int cb = u.get(uIndex) & 0xff;
        final int cr = v.get(vIndex) & 0xff;
        samples++;
        if (cb >= 75 && cb <= 145 && cr >= 135 && cr <= 205 && cr - cb >= 14) {
          skinLike++;
        }
      }
    }

    return samples > 0 && (skinLike / (float) samples) >= 0.06f;
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

  private static float sigmoidIfNeeded(float value) {
    if (value >= 0.0f && value <= 1.0f) {
      return value;
    }
    return (float) (1.0 / (1.0 + Math.exp(-value)));
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
    } else if (tensor.dataType() == DataType.INT8) {
      for (int i = 0; i < count; i++) {
        values[i] = (buffer.get() - tensor.quantizationParams().getZeroPoint()) *
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

  private static boolean landmarksLookLikeFace(float[] values, int width, int height) {
    if (values == null || values.length < LANDMARK_FLOAT_COUNT || width <= 0 || height <= 0) {
      return false;
    }

    float minX = Float.MAX_VALUE;
    float minY = Float.MAX_VALUE;
    float maxX = -Float.MAX_VALUE;
    float maxY = -Float.MAX_VALUE;
    int inFrameCount = 0;
    for (int i = 0; i < LANDMARK_FLOAT_COUNT; i += 3) {
      final float x = values[i];
      final float y = values[i + 1];
      if (!Float.isFinite(x) || !Float.isFinite(y)) {
        return false;
      }
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      if (x >= -width * 0.05f && x <= width * 1.05f &&
          y >= -height * 0.05f && y <= height * 1.05f) {
        inFrameCount++;
      }
    }

    final float inFrameRatio = inFrameCount / 468.0f;
    final float boxWidth = maxX - minX;
    final float boxHeight = maxY - minY;
    final float interOcular = distance2d(values, 33, 263);
    if (inFrameRatio < 0.70f ||
        boxWidth < width * 0.12f || boxWidth > width * 0.95f ||
        boxHeight < height * 0.12f || boxHeight > height * 0.95f ||
        interOcular < width * 0.045f || interOcular > width * 0.55f) {
      return false;
    }

    final float boxToEye = Math.max(boxWidth, boxHeight) / Math.max(interOcular, 1.0f);
    final float ear = 0.5f * (eyeRatio(values, 33, 160, 158, 133, 153, 144) +
        eyeRatio(values, 362, 385, 387, 263, 373, 380));
    final float mar = mouthRatio(values);
    return boxToEye >= 1.35f && boxToEye <= 3.60f &&
        ear >= 0.03f && ear <= 0.60f &&
        mar >= 0.01f && mar <= 1.20f;
  }

  private static float distance2d(float[] values, int a, int b) {
    final float dx = values[a * 3] - values[b * 3];
    final float dy = values[(a * 3) + 1] - values[(b * 3) + 1];
    return (float) Math.sqrt((dx * dx) + (dy * dy));
  }

  private static float eyeRatio(
      float[] values, int p0, int p1, int p2, int p3, int p4, int p5) {
    final float horizontal = distance2d(values, p0, p3);
    if (horizontal <= 1.0e-6f) {
      return 0.0f;
    }
    return (distance2d(values, p1, p5) + distance2d(values, p2, p4)) /
        (2.0f * horizontal);
  }

  private static float mouthRatio(float[] values) {
    final float horizontal = distance2d(values, 82, 311);
    if (horizontal <= 1.0e-6f) {
      return 0.0f;
    }
    return (distance2d(values, 13, 178) + distance2d(values, 312, 87)) /
        (2.0f * horizontal);
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

  private static final class FaceMeshOutput {
    final float[] landmarks;
    final boolean facePresent;
    @SuppressWarnings("unused")
    final float presenceScore;

    FaceMeshOutput(float[] landmarks, boolean facePresent, float presenceScore) {
      this.landmarks = landmarks;
      this.facePresent = facePresent;
      this.presenceScore = presenceScore;
    }
  }
}
