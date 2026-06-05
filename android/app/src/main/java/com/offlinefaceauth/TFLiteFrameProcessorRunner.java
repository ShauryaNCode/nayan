package com.offlinefaceauth;

import android.media.Image;
import android.graphics.Bitmap;
import android.graphics.PointF;
import android.media.FaceDetector;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

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
import java.util.concurrent.locks.ReentrantLock;

final class TFLiteFrameProcessorRunner {
  private static final String TAG = "NayanTFLiteRunner";
  private static final int LANDMARK_FLOAT_COUNT = 468 * 3;
  private static final int EMBEDDING_FLOAT_COUNT = 128;
  private static final int FACE_DETECTOR_MAX_WIDTH = 320;
  private static final float FACE_PRESENCE_HARD_REJECT_THRESHOLD = 0.50f;
  private static final float STRONG_FACE_CANDIDATE_CONFIDENCE = 0.48f;
  private static final Object INIT_LOCK = new Object();
  private static final ReentrantLock INFERENCE_LOCK = new ReentrantLock();

  private static Interpreter faceMeshInterpreter;
  private static Interpreter mobileFaceNetInterpreter;

  private TFLiteFrameProcessorRunner() {}

  static void initialize(String mobileFaceNetPath, String faceMeshPath) {
    synchronized (INIT_LOCK) {
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
    synchronized (INIT_LOCK) {
      return faceMeshInterpreter != null;
    }
  }

  static boolean process(@NonNull Frame frame) {
    if (!INFERENCE_LOCK.tryLock()) {
      return false; // Skip frame — inference still running
    }
    try {
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
        return processBufferInternal(yBuffer, width, height, stride, timestampNs, image);
      } catch (RuntimeException error) {
        return false;
      } finally {
        if (image != null) {
          image.close();
        }
      }
    } finally {
      INFERENCE_LOCK.unlock();
    }
  }

  static boolean processFromCopiedBuffer(
      ByteBuffer yBuffer, int width, int height, int stride, long timestampNs) {
    if (!INFERENCE_LOCK.tryLock()) {
      return false;
    }
    try {
      if (faceMeshInterpreter == null) {
        return false;
      }
      return processBufferInternal(yBuffer, width, height, stride, timestampNs, null);
    } catch (RuntimeException error) {
      return false;
    } finally {
      INFERENCE_LOCK.unlock();
    }
  }

  private static boolean processBufferInternal(
      ByteBuffer yBuffer, int width, int height, int stride, long timestampNs,
      @Nullable Image image) {
    final long inferenceStartedNs = System.nanoTime();

    final FaceCandidate faceCandidate = image != null && image.getPlanes().length >= 3
        ? findFaceCandidate(image, yBuffer, width, height, stride)
        : findFaceCandidateFast(image, yBuffer, width, height, stride);
    if (!faceCandidate.faceLike) {
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
        runFaceMesh(yBuffer, width, height, stride, faceCandidate);
    if (faceMeshOutput == null ||
        (!faceMeshOutput.facePresent &&
            faceCandidate.confidence < STRONG_FACE_CANDIDATE_CONFIDENCE)) {
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
    final float[] landmarks = faceMeshOutput.facePresent
        ? faceMeshOutput.landmarks
        : makeCanonicalFaceLandmarks(faceCandidate, width, height);

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
  }

  private static FaceCandidate findFaceCandidateFast(
      @Nullable Image image, ByteBuffer yBuffer, int width, int height, int stride) {
    // If we have no Image (copied buffer path), use skin-tone only detection
    if (image == null || image.getPlanes().length < 3) {
      if (!frameHasEnoughTexture(yBuffer, width, height, stride)) {
        return FaceCandidate.none();
      }
      // Try the legacy detector across supported frame orientations.
      final FaceCandidate detectorCandidate =
          detectFaceCandidateWithAndroidDetector(yBuffer, width, height, stride);
      if (detectorCandidate.faceLike) {
        return detectorCandidate;
      }
      return FaceCandidate.none();
    }
    // Full path with chroma (single orientation for speed)
    if (!frameHasEnoughTexture(yBuffer, width, height, stride)) {
      return FaceCandidate.none();
    }

    final FaceCandidate detectorCandidate =
        detectFaceCandidateAtOrientation(yBuffer, width, height, stride, 270);
    if (detectorCandidate.faceLike) {
      return detectorCandidate;
    }

    // Fall back to chroma-based detection
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
    final int startX = chromaWidth / 10;
    final int endX = chromaWidth - startX;
    final int startY = chromaHeight / 10;
    final int endY = chromaHeight - Math.max(1, chromaHeight / 18);
    final int stepX = Math.max(1, chromaWidth / 36);
    final int stepY = Math.max(1, chromaHeight / 36);
    int samples = 0;
    int skinLike = 0;
    int minX = width;
    int minY = height;
    int maxX = 0;
    int maxY = 0;

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
        if (isSkinLike(cb, cr)) {
          skinLike++;
          final int fullX = Math.min(width - 1, x * 2);
          final int fullY = Math.min(height - 1, y * 2);
          minX = Math.min(minX, fullX);
          minY = Math.min(minY, fullY);
          maxX = Math.max(maxX, fullX);
          maxY = Math.max(maxY, fullY);
        }
      }
    }

    if (samples <= 0 || skinLike < 8) {
      return FaceCandidate.none();
    }

    final float skinRatio = skinLike / (float) samples;
    if (skinRatio < 0.012f || minX >= maxX || minY >= maxY) {
      return FaceCandidate.none();
    }

    final int boxWidth = maxX - minX;
    final int boxHeight = maxY - minY;
    final float widthRatio = boxWidth / (float) width;
    final float heightRatio = boxHeight / (float) height;
    final float aspect = boxWidth / (float) Math.max(1, boxHeight);
    if (widthRatio < 0.07f || widthRatio > 0.82f ||
        heightRatio < 0.045f || heightRatio > 0.88f ||
        aspect < 0.38f || aspect > 1.55f) {
      return FaceCandidate.none();
    }

    final float centerX = (minX + maxX) * 0.5f;
    final float centerY = (minY + maxY) * 0.5f;
    if (centerX < width * 0.12f || centerX > width * 0.88f ||
        centerY < height * 0.08f || centerY > height * 0.98f) {
      return FaceCandidate.none();
    }

    final FaceDetail detail =
        measureFaceDetail(yBuffer, width, height, stride, minX, minY, maxX, maxY);
    if (!detail.hasFacialContrast) {
      return FaceCandidate.none();
    }

    final int padded = Math.round(Math.max(boxWidth, boxHeight) * 1.55f);
    final int roiSize = Math.max(32, Math.min(Math.max(width, height), padded));
    final int roiLeft = clamp(Math.round(centerX - (roiSize * 0.5f)), 0, Math.max(0, width - roiSize));
    final int roiTop = clamp(Math.round(centerY - (roiSize * 0.48f)), 0, Math.max(0, height - roiSize));
    final int roiRight = Math.min(width, roiLeft + roiSize);
    final int roiBottom = Math.min(height, roiTop + roiSize);
    final float confidence = Math.min(
        1.0f,
        (skinRatio * 4.5f) +
            Math.min(0.28f, detail.darkFeatureRatio * 4.0f) +
            Math.min(0.22f, detail.edgeScore / 42.0f) +
            (widthRatio >= 0.14f && heightRatio >= 0.10f ? 0.16f : 0.0f));

    return new FaceCandidate(
        true, minX, minY, maxX, maxY, roiLeft, roiTop, roiRight, roiBottom, confidence);
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
      ByteBuffer yBuffer, int width, int height, int stride, FaceCandidate candidate) {
    final Tensor inputTensor = faceMeshInterpreter.getInputTensor(0);
    final int[] inputShape = inputTensor.shape();
    if (inputShape.length < 4) {
      return null;
    }

    final ByteBuffer input =
        makeInputBuffer(inputTensor, yBuffer, width, height, stride, candidate);
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
          landmarks = normalizeLandmarkCoordinates(
              values, width, height, inputShape[2], inputShape[1], candidate);
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
    final boolean geometryAllowsFace = landmarksLookLikeFace(landmarks, width, height);
    final boolean facePresent =
        geometryAllowsFace &&
            (confidenceAllowsFace || candidate.confidence >= STRONG_FACE_CANDIDATE_CONFIDENCE);
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
      Tensor inputTensor,
      ByteBuffer yBuffer,
      int width,
      int height,
      int stride) {
    return makeInputBuffer(inputTensor, yBuffer, width, height, stride, null);
  }

  private static ByteBuffer makeInputBuffer(
      Tensor inputTensor,
      ByteBuffer yBuffer,
      int width,
      int height,
      int stride,
      FaceCandidate candidate) {
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
    final int roiLeft = candidate == null ? 0 : candidate.roiLeft;
    final int roiTop = candidate == null ? 0 : candidate.roiTop;
    final int roiWidth = candidate == null ? width : Math.max(1, candidate.roiRight - candidate.roiLeft);
    final int roiHeight = candidate == null ? height : Math.max(1, candidate.roiBottom - candidate.roiTop);

    for (int y = 0; y < inputHeight; y++) {
      for (int x = 0; x < inputWidth; x++) {
        final int srcX = Math.min(
            width - 1,
            Math.max(0, roiLeft + (x * roiWidth / inputWidth)));
        final int srcY = Math.min(
            height - 1,
            Math.max(0, roiTop + (y * roiHeight / inputHeight)));
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

  private static FaceCandidate findFaceCandidate(
      Image image, ByteBuffer yBuffer, int width, int height, int stride) {
    if (image == null || image.getPlanes().length < 3 || yBuffer == null ||
        width <= 0 || height <= 0 || stride < width) {
      return FaceCandidate.none();
    }

    if (!frameHasEnoughTexture(yBuffer, width, height, stride)) {
      return FaceCandidate.none();
    }

    final FaceCandidate detectorCandidate =
        detectFaceCandidateWithAndroidDetector(yBuffer, width, height, stride);
    if (detectorCandidate.faceLike) {
      return detectorCandidate;
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
    final int startX = chromaWidth / 10;
    final int endX = chromaWidth - startX;
    final int startY = chromaHeight / 10;
    final int endY = chromaHeight - Math.max(1, chromaHeight / 18);
    final int stepX = Math.max(1, chromaWidth / 36);
    final int stepY = Math.max(1, chromaHeight / 36);
    int samples = 0;
    int skinLike = 0;
    int minX = width;
    int minY = height;
    int maxX = 0;
    int maxY = 0;

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
        if (isSkinLike(cb, cr)) {
          skinLike++;
          final int fullX = Math.min(width - 1, x * 2);
          final int fullY = Math.min(height - 1, y * 2);
          minX = Math.min(minX, fullX);
          minY = Math.min(minY, fullY);
          maxX = Math.max(maxX, fullX);
          maxY = Math.max(maxY, fullY);
        }
      }
    }

    if (samples <= 0 || skinLike < 8) {
      return FaceCandidate.none();
    }

    final float skinRatio = skinLike / (float) samples;
    if (skinRatio < 0.012f || minX >= maxX || minY >= maxY) {
      return FaceCandidate.none();
    }

    final int boxWidth = maxX - minX;
    final int boxHeight = maxY - minY;
    final float widthRatio = boxWidth / (float) width;
    final float heightRatio = boxHeight / (float) height;
    final float aspect = boxWidth / (float) Math.max(1, boxHeight);
    if (widthRatio < 0.07f || widthRatio > 0.82f ||
        heightRatio < 0.045f || heightRatio > 0.88f ||
        aspect < 0.38f || aspect > 1.55f) {
      return FaceCandidate.none();
    }

    final float centerX = (minX + maxX) * 0.5f;
    final float centerY = (minY + maxY) * 0.5f;
    if (centerX < width * 0.12f || centerX > width * 0.88f ||
        centerY < height * 0.08f || centerY > height * 0.98f) {
      return FaceCandidate.none();
    }

    final FaceDetail detail =
        measureFaceDetail(yBuffer, width, height, stride, minX, minY, maxX, maxY);
    if (!detail.hasFacialContrast) {
      return FaceCandidate.none();
    }

    final int padded = Math.round(Math.max(boxWidth, boxHeight) * 1.55f);
    final int roiSize = Math.max(32, Math.min(Math.max(width, height), padded));
    final int roiLeft = clamp(Math.round(centerX - (roiSize * 0.5f)), 0, Math.max(0, width - roiSize));
    final int roiTop = clamp(Math.round(centerY - (roiSize * 0.48f)), 0, Math.max(0, height - roiSize));
    final int roiRight = Math.min(width, roiLeft + roiSize);
    final int roiBottom = Math.min(height, roiTop + roiSize);
    final float confidence = Math.min(
        1.0f,
        (skinRatio * 4.5f) +
            Math.min(0.28f, detail.darkFeatureRatio * 4.0f) +
            Math.min(0.22f, detail.edgeScore / 42.0f) +
            (widthRatio >= 0.14f && heightRatio >= 0.10f ? 0.16f : 0.0f));

    return new FaceCandidate(
        true, minX, minY, maxX, maxY, roiLeft, roiTop, roiRight, roiBottom, confidence);
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
      float[] raw,
      int width,
      int height,
      int inputWidth,
      int inputHeight,
      FaceCandidate candidate) {
    final float[] values = new float[LANDMARK_FLOAT_COUNT];
    System.arraycopy(raw, 0, values, 0, LANDMARK_FLOAT_COUNT);

    float maxAbsX = 0.0f;
    float maxAbsY = 0.0f;
    for (int i = 0; i < LANDMARK_FLOAT_COUNT; i += 3) {
      maxAbsX = Math.max(maxAbsX, Math.abs(values[i]));
      maxAbsY = Math.max(maxAbsY, Math.abs(values[i + 1]));
    }

    final int roiLeft = candidate == null ? 0 : candidate.roiLeft;
    final int roiTop = candidate == null ? 0 : candidate.roiTop;
    final int roiWidth = candidate == null ? width : Math.max(1, candidate.roiRight - candidate.roiLeft);
    final int roiHeight = candidate == null ? height : Math.max(1, candidate.roiBottom - candidate.roiTop);

    if (maxAbsX <= 2.0f && maxAbsY <= 2.0f) {
      for (int i = 0; i < LANDMARK_FLOAT_COUNT; i += 3) {
        values[i] = roiLeft + (values[i] * roiWidth);
        values[i + 1] = roiTop + (values[i + 1] * roiHeight);
      }
    } else if (candidate != null && maxAbsX <= inputWidth * 1.25f &&
        maxAbsY <= inputHeight * 1.25f) {
      for (int i = 0; i < LANDMARK_FLOAT_COUNT; i += 3) {
        values[i] = roiLeft + ((values[i] / Math.max(1, inputWidth)) * roiWidth);
        values[i + 1] = roiTop + ((values[i + 1] / Math.max(1, inputHeight)) * roiHeight);
      }
    }
    return values;
  }

  private static boolean isSkinLike(int cb, int cr) {
    return (cb >= 70 && cb <= 150 && cr >= 128 && cr <= 210 && cr - cb >= 8) ||
        (cr >= 70 && cr <= 150 && cb >= 128 && cb <= 210 && cb - cr >= 8);
  }

  private static FaceCandidate detectFaceCandidateWithAndroidDetector(
      ByteBuffer yBuffer, int width, int height, int stride) {
    FaceCandidate best = FaceCandidate.none();
    final int[] orientations = {0, 90, 270, 180};
    for (int orientation : orientations) {
      final FaceCandidate candidate =
          detectFaceCandidateAtOrientation(yBuffer, width, height, stride, orientation);
      if (candidate.faceLike && candidate.confidence > best.confidence) {
        best = candidate;
      }
    }
    return best;
  }

  private static FaceCandidate detectFaceCandidateAtOrientation(
      ByteBuffer yBuffer,
      int width,
      int height,
      int stride,
      int orientationDegrees) {
    final int orientedWidth =
        orientationDegrees == 90 || orientationDegrees == 270 ? height : width;
    final int orientedHeight =
        orientationDegrees == 90 || orientationDegrees == 270 ? width : height;
    if (orientedWidth <= 0 || orientedHeight <= 0) {
      return FaceCandidate.none();
    }

    int bitmapWidth = Math.min(FACE_DETECTOR_MAX_WIDTH, orientedWidth);
    if ((bitmapWidth & 1) == 1) {
      bitmapWidth--;
    }
    bitmapWidth = Math.max(2, bitmapWidth);
    int bitmapHeight = Math.max(2, Math.round(bitmapWidth * (orientedHeight / (float) orientedWidth)));
    if ((bitmapHeight & 1) == 1) {
      bitmapHeight++;
    }

    final Bitmap bitmap = Bitmap.createBitmap(bitmapWidth, bitmapHeight, Bitmap.Config.RGB_565);
    final int[] pixels = new int[bitmapWidth * bitmapHeight];
    final ByteBuffer source = yBuffer.duplicate();
    source.position(0);
    for (int by = 0; by < bitmapHeight; by++) {
      for (int bx = 0; bx < bitmapWidth; bx++) {
        final float ox = (bx + 0.5f) * orientedWidth / bitmapWidth;
        final float oy = (by + 0.5f) * orientedHeight / bitmapHeight;
        final int[] src = orientedToSource(ox, oy, width, height, orientationDegrees);
        final int luma = source.get((src[1] * stride) + src[0]) & 0xff;
        pixels[(by * bitmapWidth) + bx] =
            0xff000000 | (luma << 16) | (luma << 8) | luma;
      }
    }
    bitmap.setPixels(pixels, 0, bitmapWidth, 0, 0, bitmapWidth, bitmapHeight);

    final FaceDetector.Face[] faces = new FaceDetector.Face[1];
    final int found = new FaceDetector(bitmapWidth, bitmapHeight, faces.length)
        .findFaces(bitmap, faces);
    bitmap.recycle();
    if (found <= 0 || faces[0] == null || faces[0].eyesDistance() <= 0.0f) {
      return FaceCandidate.none();
    }

    final PointF mid = new PointF();
    faces[0].getMidPoint(mid);
    final float eyeDistance = faces[0].eyesDistance();
    final float orientedMidX = mid.x * orientedWidth / bitmapWidth;
    final float orientedMidY = mid.y * orientedHeight / bitmapHeight;
    final int[] center = orientedToSource(orientedMidX, orientedMidY, width, height, orientationDegrees);
    final float scale = orientationDegrees == 90 || orientationDegrees == 270
        ? height / (float) bitmapWidth
        : width / (float) bitmapWidth;
    final float sourceEyeDistance = Math.max(1.0f, eyeDistance * scale);
    final float boxWidth = sourceEyeDistance * 2.45f;
    final float boxHeight = sourceEyeDistance * 3.05f;
    final int left = clamp(Math.round(center[0] - (boxWidth * 0.5f)), 0, width - 1);
    final int top = clamp(Math.round(center[1] - (boxHeight * 0.42f)), 0, height - 1);
    final int right = clamp(Math.round(center[0] + (boxWidth * 0.5f)), left + 1, width);
    final int bottom = clamp(Math.round(center[1] + (boxHeight * 0.58f)), top + 1, height);
    final float confidence = Math.min(1.0f, 0.58f + (sourceEyeDistance / Math.max(width, height)));
    return makeCandidateFromBox(left, top, right, bottom, width, height, confidence);
  }

  private static int[] orientedToSource(
      float orientedX, float orientedY, int width, int height, int orientationDegrees) {
    final int x;
    final int y;
    if (orientationDegrees == 90) {
      x = Math.round(orientedY);
      y = Math.round(height - 1 - orientedX);
    } else if (orientationDegrees == 270) {
      x = Math.round(width - 1 - orientedY);
      y = Math.round(orientedX);
    } else if (orientationDegrees == 180) {
      x = Math.round(width - 1 - orientedX);
      y = Math.round(height - 1 - orientedY);
    } else {
      x = Math.round(orientedX);
      y = Math.round(orientedY);
    }
    return new int[] {
        clamp(x, 0, width - 1),
        clamp(y, 0, height - 1),
    };
  }

  private static FaceCandidate makeCandidateFromBox(
      int left,
      int top,
      int right,
      int bottom,
      int width,
      int height,
      float confidence) {
    final int boxWidth = Math.max(1, right - left);
    final int boxHeight = Math.max(1, bottom - top);
    final float centerX = (left + right) * 0.5f;
    final float centerY = (top + bottom) * 0.5f;
    final int padded = Math.round(Math.max(boxWidth, boxHeight) * 1.40f);
    final int roiSize = Math.max(32, Math.min(Math.max(width, height), padded));
    final int roiLeft = clamp(Math.round(centerX - (roiSize * 0.5f)), 0, Math.max(0, width - roiSize));
    final int roiTop = clamp(Math.round(centerY - (roiSize * 0.48f)), 0, Math.max(0, height - roiSize));
    final int roiRight = Math.min(width, roiLeft + roiSize);
    final int roiBottom = Math.min(height, roiTop + roiSize);
    return new FaceCandidate(
        true, left, top, right, bottom, roiLeft, roiTop, roiRight, roiBottom, confidence);
  }

  private static FaceDetail measureFaceDetail(
      ByteBuffer yBuffer,
      int width,
      int height,
      int stride,
      int left,
      int top,
      int right,
      int bottom) {
    final ByteBuffer source = yBuffer.duplicate();
    source.position(0);
    final int boxWidth = Math.max(1, right - left);
    final int boxHeight = Math.max(1, bottom - top);
    final int stepX = Math.max(1, boxWidth / 24);
    final int stepY = Math.max(1, boxHeight / 24);
    int samples = 0;
    int darkFeatures = 0;
    double sum = 0.0;
    double edge = 0.0;
    int edgeSamples = 0;

    for (int y = top; y <= bottom; y += stepY) {
      for (int x = left; x <= right; x += stepX) {
        final int cx = Math.min(width - 1, Math.max(0, x));
        final int cy = Math.min(height - 1, Math.max(0, y));
        final int luma = source.get((cy * stride) + cx) & 0xff;
        sum += luma;
        samples++;
      }
    }

    final double mean = samples == 0 ? 0.0 : sum / samples;
    final int upperTop = top + Math.round(boxHeight * 0.12f);
    final int upperBottom = top + Math.round(boxHeight * 0.58f);
    for (int y = upperTop; y <= upperBottom; y += stepY) {
      for (int x = left; x <= right; x += stepX) {
        final int cx = Math.min(width - 2, Math.max(1, x));
        final int cy = Math.min(height - 2, Math.max(1, y));
        final int luma = source.get((cy * stride) + cx) & 0xff;
        if (luma < Math.min(105.0, mean - 18.0)) {
          darkFeatures++;
        }
        final int rightLuma = source.get((cy * stride) + cx + 1) & 0xff;
        final int downLuma = source.get(((cy + 1) * stride) + cx) & 0xff;
        edge += Math.abs(luma - rightLuma) + Math.abs(luma - downLuma);
        edgeSamples += 2;
      }
    }

    final float darkFeatureRatio = samples == 0 ? 0.0f : darkFeatures / (float) samples;
    final float edgeScore = edgeSamples == 0 ? 0.0f : (float) (edge / edgeSamples);
    return new FaceDetail(darkFeatureRatio >= 0.004f && edgeScore >= 2.2f,
        darkFeatureRatio, edgeScore);
  }

  private static float[] makeCanonicalFaceLandmarks(
      FaceCandidate candidate, int width, int height) {
    final float[] landmarks = new float[LANDMARK_FLOAT_COUNT];
    final float cx = (candidate.left + candidate.right) * 0.5f;
    final float cy = (candidate.top + candidate.bottom) * 0.5f;
    final float rx = Math.max(20.0f, (candidate.right - candidate.left) * 0.48f);
    final float ry = Math.max(24.0f, (candidate.bottom - candidate.top) * 0.58f);
    for (int i = 0; i < 468; i++) {
      final double angle = (i * 2.399963229728653) % (Math.PI * 2.0);
      final double radius = Math.sqrt(((i % 89) + 8) / 97.0);
      landmarks[i * 3] = clampFloat((float) (cx + Math.cos(angle) * radius * rx), 0.0f, width - 1.0f);
      landmarks[(i * 3) + 1] = clampFloat((float) (cy + Math.sin(angle) * radius * ry), 0.0f, height - 1.0f);
      landmarks[(i * 3) + 2] = 0.0f;
    }

    setPoint(landmarks, 1, cx, cy - ry * 0.10f);
    setPoint(landmarks, 152, cx, cy + ry * 0.88f);
    setPoint(landmarks, 33, cx - rx * 0.60f, cy - ry * 0.18f);
    setPoint(landmarks, 133, cx - rx * 0.22f, cy - ry * 0.18f);
    setPoint(landmarks, 160, cx - rx * 0.50f, cy - ry * 0.28f);
    setPoint(landmarks, 158, cx - rx * 0.34f, cy - ry * 0.28f);
    setPoint(landmarks, 153, cx - rx * 0.34f, cy - ry * 0.08f);
    setPoint(landmarks, 144, cx - rx * 0.50f, cy - ry * 0.08f);
    setPoint(landmarks, 362, cx + rx * 0.22f, cy - ry * 0.18f);
    setPoint(landmarks, 263, cx + rx * 0.60f, cy - ry * 0.18f);
    setPoint(landmarks, 385, cx + rx * 0.34f, cy - ry * 0.28f);
    setPoint(landmarks, 387, cx + rx * 0.50f, cy - ry * 0.28f);
    setPoint(landmarks, 373, cx + rx * 0.50f, cy - ry * 0.08f);
    setPoint(landmarks, 380, cx + rx * 0.34f, cy - ry * 0.08f);
    setPoint(landmarks, 61, cx - rx * 0.30f, cy + ry * 0.34f);
    setPoint(landmarks, 291, cx + rx * 0.30f, cy + ry * 0.34f);
    setPoint(landmarks, 82, cx - rx * 0.30f, cy + ry * 0.34f);
    setPoint(landmarks, 311, cx + rx * 0.30f, cy + ry * 0.34f);
    setPoint(landmarks, 13, cx, cy + ry * 0.26f);
    setPoint(landmarks, 178, cx, cy + ry * 0.42f);
    setPoint(landmarks, 312, cx + rx * 0.10f, cy + ry * 0.28f);
    setPoint(landmarks, 87, cx + rx * 0.10f, cy + ry * 0.41f);
    return landmarks;
  }

  private static void setPoint(float[] landmarks, int index, float x, float y) {
    landmarks[index * 3] = x;
    landmarks[(index * 3) + 1] = y;
    landmarks[(index * 3) + 2] = 0.0f;
  }

  private static int clamp(int value, int min, int max) {
    return Math.max(min, Math.min(max, value));
  }

  private static float clampFloat(float value, float min, float max) {
    return Math.max(min, Math.min(max, value));
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
        ear >= 0.03f && ear <= 0.85f &&
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

  private static final class FaceCandidate {
    final boolean faceLike;
    final int left;
    final int top;
    final int right;
    final int bottom;
    final int roiLeft;
    final int roiTop;
    final int roiRight;
    final int roiBottom;
    final float confidence;

    FaceCandidate(
        boolean faceLike,
        int left,
        int top,
        int right,
        int bottom,
        int roiLeft,
        int roiTop,
        int roiRight,
        int roiBottom,
        float confidence) {
      this.faceLike = faceLike;
      this.left = left;
      this.top = top;
      this.right = right;
      this.bottom = bottom;
      this.roiLeft = roiLeft;
      this.roiTop = roiTop;
      this.roiRight = roiRight;
      this.roiBottom = roiBottom;
      this.confidence = confidence;
    }

    static FaceCandidate none() {
      return new FaceCandidate(false, 0, 0, 0, 0, 0, 0, 0, 0, 0.0f);
    }
  }

  private static final class FaceDetail {
    final boolean hasFacialContrast;
    final float darkFeatureRatio;
    final float edgeScore;

    FaceDetail(boolean hasFacialContrast, float darkFeatureRatio, float edgeScore) {
      this.hasFacialContrast = hasFacialContrast;
      this.darkFeatureRatio = darkFeatureRatio;
      this.edgeScore = edgeScore;
    }
  }
}
