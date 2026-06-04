#include "FaceMeshEngine.h"

#include <algorithm>
#include <array>
#include <atomic>
#include <cmath>
#include <cstring>
#include <limits>
#include <stdexcept>

#if __has_include(<tensorflow/lite/interpreter.h>) && \
    __has_include(<tensorflow/lite/kernels/register.h>) && \
    __has_include(<tensorflow/lite/model.h>) && \
    __has_include(<tensorflow/lite/delegates/xnnpack/xnnpack_delegate.h>)
#define NAYAN_HAS_TFLITE 1
#include <tensorflow/lite/delegates/xnnpack/xnnpack_delegate.h>
#include <tensorflow/lite/interpreter.h>
#include <tensorflow/lite/kernels/register.h>
#include <tensorflow/lite/model.h>
#if defined(__APPLE__) && __has_include(<tensorflow/lite/delegates/coreml/coreml_delegate.h>)
#define NAYAN_HAS_COREML_DELEGATE 1
#include <tensorflow/lite/delegates/coreml/coreml_delegate.h>
#else
#define NAYAN_HAS_COREML_DELEGATE 0
#endif
#if defined(__APPLE__) && __has_include(<tensorflow/lite/delegates/gpu/metal_delegate.h>)
#define NAYAN_HAS_METAL_DELEGATE 1
#include <tensorflow/lite/delegates/gpu/metal_delegate.h>
#else
#define NAYAN_HAS_METAL_DELEGATE 0
#endif
#else
#define NAYAN_HAS_TFLITE 0
#define NAYAN_HAS_COREML_DELEGATE 0
#define NAYAN_HAS_METAL_DELEGATE 0
#endif

namespace offlineface::landmarks {
namespace {

constexpr float kPi = 3.14159265358979323846f;
constexpr float kEpsilon = 1.0e-6f;
constexpr std::array<int, 6> kLeftEye{33, 160, 158, 133, 153, 144};
constexpr std::array<int, 6> kRightEye{362, 385, 387, 263, 373, 380};
constexpr std::array<int, 6> kMouth{13, 312, 87, 178, 82, 311};
constexpr std::array<int, 6> kPoseIndices{1, 152, 33, 263, 61, 291};

struct Vec2 {
  float x{0.0f};
  float y{0.0f};
};

struct Vec3 {
  float x{0.0f};
  float y{0.0f};
  float z{0.0f};
};

using Mat3 = std::array<std::array<float, 3>, 3>;

float Distance2D(const Landmark3D& a, const Landmark3D& b) {
  const float dx = a.x - b.x;
  const float dy = a.y - b.y;
  return std::sqrt((dx * dx) + (dy * dy));
}

float Distance3D(const Landmark3D& a, const Landmark3D& b) {
  const float dx = a.x - b.x;
  const float dy = a.y - b.y;
  const float dz = a.z - b.z;
  return std::sqrt((dx * dx) + (dy * dy) + (dz * dz));
}

float EyeRatio(const FaceLandmarks& points, const std::array<int, 6>& idx) {
  const float horizontal = Distance2D(points[idx[0]], points[idx[3]]);
  if (horizontal <= kEpsilon) {
    return 0.0f;
  }

  const float upperOuter = Distance2D(points[idx[1]], points[idx[5]]);
  const float upperInner = Distance2D(points[idx[2]], points[idx[4]]);
  return (upperOuter + upperInner) / (2.0f * horizontal);
}

CameraIntrinsics MakeIntrinsics(uint32_t width, uint32_t height) {
  const float focal = static_cast<float>(std::max(width, height));
  return {
      focal,
      focal,
      static_cast<float>(width) * 0.5f,
      static_cast<float>(height) * 0.5f,
  };
}

Mat3 Rodrigues(const Vec3& r) {
  const float theta = std::sqrt((r.x * r.x) + (r.y * r.y) + (r.z * r.z));
  Mat3 identity{{{{1.0f, 0.0f, 0.0f}},
                 {{0.0f, 1.0f, 0.0f}},
                 {{0.0f, 0.0f, 1.0f}}}};
  if (theta < 1.0e-8f) {
    return identity;
  }

  const float x = r.x / theta;
  const float y = r.y / theta;
  const float z = r.z / theta;
  const float c = std::cos(theta);
  const float s = std::sin(theta);
  const float oneMinusC = 1.0f - c;

  return Mat3{{{{c + (x * x * oneMinusC),
                 (x * y * oneMinusC) - (z * s),
                 (x * z * oneMinusC) + (y * s)}},
               {{(y * x * oneMinusC) + (z * s),
                 c + (y * y * oneMinusC),
                 (y * z * oneMinusC) - (x * s)}},
               {{(z * x * oneMinusC) - (y * s),
                 (z * y * oneMinusC) + (x * s),
                 c + (z * z * oneMinusC)}}}};
}

Vec3 Transform(const Mat3& r, const Vec3& p, const Vec3& t) {
  return {
      (r[0][0] * p.x) + (r[0][1] * p.y) + (r[0][2] * p.z) + t.x,
      (r[1][0] * p.x) + (r[1][1] * p.y) + (r[1][2] * p.z) + t.y,
      (r[2][0] * p.x) + (r[2][1] * p.y) + (r[2][2] * p.z) + t.z,
  };
}

Vec2 Project(const Vec3& point, const CameraIntrinsics& k) {
  const float z = std::abs(point.z) <= kEpsilon ? kEpsilon : point.z;
  return {
      k.fx * (point.x / z) + k.cx,
      k.fy * (point.y / z) + k.cy,
  };
}

void Residuals(const std::array<Vec3, 6>& objectPoints,
               const std::array<Vec2, 6>& imagePoints,
               const CameraIntrinsics& intrinsics,
               const std::array<float, 6>& params,
               std::array<float, 12>& residuals) {
  const Vec3 r{params[0], params[1], params[2]};
  const Vec3 t{params[3], params[4], params[5]};
  const Mat3 rotation = Rodrigues(r);

  for (std::size_t i = 0; i < objectPoints.size(); ++i) {
    const Vec2 projected =
        Project(Transform(rotation, objectPoints[i], t), intrinsics);
    residuals[i * 2U] = projected.x - imagePoints[i].x;
    residuals[(i * 2U) + 1U] = projected.y - imagePoints[i].y;
  }
}

float SquaredError(const std::array<float, 12>& residuals) {
  float error = 0.0f;
  for (float value : residuals) {
    error += value * value;
  }
  return error;
}

bool SolveLinear6(std::array<std::array<float, 6>, 6> a,
                  std::array<float, 6> b,
                  std::array<float, 6>& x) {
  for (int pivot = 0; pivot < 6; ++pivot) {
    int best = pivot;
    float bestAbs = std::abs(a[pivot][pivot]);
    for (int row = pivot + 1; row < 6; ++row) {
      const float candidate = std::abs(a[row][pivot]);
      if (candidate > bestAbs) {
        best = row;
        bestAbs = candidate;
      }
    }

    if (bestAbs <= 1.0e-9f) {
      return false;
    }

    if (best != pivot) {
      std::swap(a[pivot], a[best]);
      std::swap(b[pivot], b[best]);
    }

    const float diag = a[pivot][pivot];
    for (int col = pivot; col < 6; ++col) {
      a[pivot][col] /= diag;
    }
    b[pivot] /= diag;

    for (int row = 0; row < 6; ++row) {
      if (row == pivot) {
        continue;
      }
      const float factor = a[row][pivot];
      for (int col = pivot; col < 6; ++col) {
        a[row][col] -= factor * a[pivot][col];
      }
      b[row] -= factor * b[pivot];
    }
  }

  x = b;
  return true;
}

HeadPose EulerFromRotation(const Mat3& rotation) {
  const float yaw = std::asin(std::clamp(-rotation[2][0], -1.0f, 1.0f));
  float pitch = std::atan2(rotation[2][1], rotation[2][2]);
  const float roll = std::atan2(rotation[1][0], rotation[0][0]);

  // Adjust pitch to compensate for the 180-degree model coordinate system offset
  if (pitch < 0.0f) {
    pitch += kPi;
  } else {
    pitch -= kPi;
  }

  return {
      yaw * 180.0f / kPi,
      pitch * 180.0f / kPi,
      roll * 180.0f / kPi,
      true,
  };
}

std::array<Vec3, 6> CanonicalFaceModel() {
  return {{
      {0.0f, 0.0f, 0.0f},
      {0.0f, -63.6f, -12.5f},
      {-43.3f, 32.7f, -26.0f},
      {43.3f, 32.7f, -26.0f},
      {-28.9f, -28.9f, -24.1f},
      {28.9f, -28.9f, -24.1f},
  }};
}

std::array<Vec2, 6> PoseImagePoints(const FaceLandmarks& landmarks) {
  std::array<Vec2, 6> image{};
  for (std::size_t i = 0; i < kPoseIndices.size(); ++i) {
    image[i] = {landmarks[kPoseIndices[i]].x, landmarks[kPoseIndices[i]].y};
  }
  return image;
}

std::array<float, 6> InitialPose(const std::array<Vec2, 6>& imagePoints,
                                 const CameraIntrinsics& intrinsics) {
  float minX = imagePoints[0].x;
  float maxX = imagePoints[0].x;
  float minY = imagePoints[0].y;
  float maxY = imagePoints[0].y;
  for (const Vec2& p : imagePoints) {
    minX = std::min(minX, p.x);
    maxX = std::max(maxX, p.x);
    minY = std::min(minY, p.y);
    maxY = std::max(maxY, p.y);
  }

  const float faceWidth = std::max(maxX - minX, 1.0f);
  const float canonicalEyeDistance = 86.6f;
  const float z = intrinsics.fx * canonicalEyeDistance / faceWidth;
  const Vec2 nose = imagePoints[0];
  return {{
      0.0f,
      0.0f,
      0.0f,
      (nose.x - intrinsics.cx) * z / intrinsics.fx,
      (nose.y - intrinsics.cy) * z / intrinsics.fy,
      std::max(z, 50.0f),
  }};
}

HeadPose SolvePnPLevenbergMarquardt(const std::array<Vec3, 6>& objectPoints,
                                    const std::array<Vec2, 6>& imagePoints,
                                    const CameraIntrinsics& intrinsics) {
  std::array<float, 6> params = InitialPose(imagePoints, intrinsics);
  std::array<float, 12> residual{};
  Residuals(objectPoints, imagePoints, intrinsics, params, residual);
  float error = SquaredError(residual);
  float lambda = 1.0e-3f;

  for (int iteration = 0; iteration < 60; ++iteration) {
    std::array<std::array<float, 6>, 12> jacobian{};

    for (int column = 0; column < 6; ++column) {
      std::array<float, 6> shifted = params;
      const float step =
          std::max(1.0e-4f, std::abs(params[column]) * 1.0e-4f);
      shifted[column] += step;
      std::array<float, 12> shiftedResidual{};
      Residuals(objectPoints, imagePoints, intrinsics, shifted, shiftedResidual);
      for (int row = 0; row < 12; ++row) {
        jacobian[row][column] = (shiftedResidual[row] - residual[row]) / step;
      }
    }

    std::array<std::array<float, 6>, 6> normal{};
    std::array<float, 6> gradient{};
    for (int r = 0; r < 6; ++r) {
      for (int c = 0; c < 6; ++c) {
        float sum = 0.0f;
        for (int k = 0; k < 12; ++k) {
          sum += jacobian[k][r] * jacobian[k][c];
        }
        normal[r][c] = sum;
      }

      float g = 0.0f;
      for (int k = 0; k < 12; ++k) {
        g += jacobian[k][r] * residual[k];
      }
      gradient[r] = -g;
    }

    for (int d = 0; d < 6; ++d) {
      normal[d][d] *= (1.0f + lambda);
    }

    std::array<float, 6> delta{};
    if (!SolveLinear6(normal, gradient, delta)) {
      lambda *= 10.0f;
      continue;
    }

    std::array<float, 6> candidate = params;
    float deltaNorm = 0.0f;
    for (int i = 0; i < 6; ++i) {
      candidate[i] += delta[i];
      deltaNorm += delta[i] * delta[i];
    }

    std::array<float, 12> candidateResidual{};
    Residuals(
        objectPoints, imagePoints, intrinsics, candidate, candidateResidual);
    const float candidateError = SquaredError(candidateResidual);

    if (candidateError < error) {
      params = candidate;
      residual = candidateResidual;
      if (std::abs(error - candidateError) < 1.0e-5f ||
          deltaNorm < 1.0e-8f) {
        break;
      }
      error = candidateError;
      lambda = std::max(lambda * 0.25f, 1.0e-7f);
    } else {
      lambda = std::min(lambda * 4.0f, 1.0e7f);
    }
  }

  if (!std::isfinite(error)) {
    return {};
  }

  return EulerFromRotation(Rodrigues({params[0], params[1], params[2]}));
}

bool LooksLikeValidLandmarks(const FaceLandmarks& landmarks) {
  float minX = std::numeric_limits<float>::max();
  float minY = std::numeric_limits<float>::max();
  float maxX = std::numeric_limits<float>::lowest();
  float maxY = std::numeric_limits<float>::lowest();
  for (const Landmark3D& point : landmarks) {
    if (!std::isfinite(point.x) || !std::isfinite(point.y) ||
        !std::isfinite(point.z)) {
      return false;
    }
    minX = std::min(minX, point.x);
    minY = std::min(minY, point.y);
    maxX = std::max(maxX, point.x);
    maxY = std::max(maxY, point.y);
  }

  const float eyeDistance = Distance2D(landmarks[33], landmarks[263]);
  const float faceHeight = Distance2D(landmarks[1], landmarks[152]);
  const float boxWidth = maxX - minX;
  const float boxHeight = maxY - minY;
  const float boxToEye = std::max(boxWidth, boxHeight) /
                         std::max(eyeDistance, 1.0f);
  const float ear =
      (EyeRatio(landmarks, kLeftEye) + EyeRatio(landmarks, kRightEye)) * 0.5f;
  const float marHorizontal = Distance2D(landmarks[kMouth[4]], landmarks[kMouth[5]]);
  const float mar = marHorizontal <= kEpsilon
                        ? 0.0f
                        : (Distance2D(landmarks[kMouth[0]], landmarks[kMouth[3]]) +
                           Distance2D(landmarks[kMouth[1]], landmarks[kMouth[2]])) /
                              (2.0f * marHorizontal);

  const float scale = std::max({std::abs(maxX), std::abs(maxY), boxWidth, boxHeight, 1.0f});
  return std::isfinite(eyeDistance) && std::isfinite(faceHeight) &&
         eyeDistance > scale * 0.015f && faceHeight > scale * 0.025f &&
         boxWidth > scale * 0.035f && boxHeight > scale * 0.035f &&
         boxToEye >= 1.10f && boxToEye <= 5.25f &&
         ear >= 0.005f && ear <= 0.85f && mar >= 0.0f && mar <= 1.60f;
}

}  // namespace

class FaceMeshEngine::Impl {
 public:
  bool LoadModel(const std::string& path) {
    lastError_.clear();
    if (path.empty()) {
      lastError_ = "FaceMesh model path is empty";
      ready_.store(false, std::memory_order_release);
      return false;
    }

#if NAYAN_HAS_TFLITE
    model_ = tflite::FlatBufferModel::BuildFromFile(path.c_str());
    if (!model_) {
      lastError_ = "Failed to load FaceMesh TFLite model";
      ready_.store(false, std::memory_order_release);
      return false;
    }

    tflite::ops::builtin::BuiltinOpResolver resolver;
    tflite::InterpreterBuilder builder(*model_, resolver);
    builder.SetNumThreads(2);
    if (builder(&interpreter_) != kTfLiteOk || !interpreter_) {
      lastError_ = "Failed to create FaceMesh interpreter";
      ready_.store(false, std::memory_order_release);
      return false;
    }

#if NAYAN_HAS_COREML_DELEGATE
    TfLiteCoreMlDelegateOptions coreMlOptions = {};
    coreMlDelegate_.reset(TfLiteCoreMlDelegateCreate(&coreMlOptions));
    if (coreMlDelegate_ &&
        interpreter_->ModifyGraphWithDelegate(coreMlDelegate_.get()) !=
            kTfLiteOk) {
      coreMlDelegate_.reset();
    }
#endif
#if NAYAN_HAS_METAL_DELEGATE
    if (coreMlDelegate_ == nullptr) {
      metalDelegate_.reset(TFLGpuDelegateCreate(nullptr));
      if (metalDelegate_ &&
          interpreter_->ModifyGraphWithDelegate(metalDelegate_.get()) !=
              kTfLiteOk) {
        metalDelegate_.reset();
      }
    }
#endif

    TfLiteXNNPackDelegateOptions options =
        TfLiteXNNPackDelegateOptionsDefault();
    options.num_threads = 2;
    if (coreMlDelegate_ == nullptr && metalDelegate_ == nullptr) {
      xnnpackDelegate_.reset(TfLiteXNNPackDelegateCreate(&options));
    }
    if (xnnpackDelegate_ &&
        interpreter_->ModifyGraphWithDelegate(xnnpackDelegate_.get()) !=
            kTfLiteOk) {
      xnnpackDelegate_.reset();
      lastError_ = "XNNPACK delegate creation failed; using CPU interpreter";
    }

    if (interpreter_->AllocateTensors() != kTfLiteOk) {
      lastError_ = "Failed to allocate FaceMesh tensors";
      ready_.store(false, std::memory_order_release);
      return false;
    }

    ready_.store(true, std::memory_order_release);
    return true;
#else
    lastError_ =
        "TensorFlow Lite headers are not available in this build; use "
        "ComputeFromLandmarks for mocked input";
    ready_.store(false, std::memory_order_release);
    return false;
#endif
  }

  bool IsReady() const { return ready_.load(std::memory_order_acquire); }

  std::string LastError() const { return lastError_; }

  FaceMetrics Run(const ImageFrame& frame) {
#if NAYAN_HAS_TFLITE
    if (!IsReady() || frame.pixels == nullptr || frame.width == 0U ||
        frame.height == 0U || frame.stride < frame.width) {
      return {};
    }

    const int inputIndex = interpreter_->inputs().empty()
                               ? -1
                               : interpreter_->inputs().front();
    if (inputIndex < 0) {
      lastError_ = "FaceMesh interpreter has no input tensor";
      return {};
    }

    TfLiteTensor* input = interpreter_->tensor(inputIndex);
    const std::size_t bytes =
        static_cast<std::size_t>(frame.stride) * frame.height * frame.channels;
    const std::size_t copyBytes =
        std::min(bytes, static_cast<std::size_t>(input->bytes));
    std::memcpy(input->data.raw, frame.pixels, copyBytes);

    std::atomic_thread_fence(std::memory_order_release);
    if (interpreter_->Invoke() != kTfLiteOk) {
      lastError_ = "FaceMesh interpreter Invoke failed";
      return {};
    }
    std::atomic_thread_fence(std::memory_order_acquire);

    for (int tensorIndex : interpreter_->outputs()) {
      const TfLiteTensor* output = interpreter_->tensor(tensorIndex);
      if (output != nullptr && output->type == kTfLiteFloat32 &&
          output->bytes >= 468U * 3U * sizeof(float)) {
        const auto landmarks = FaceMeshEngine::ParseLandmarks(
            output->data.f, output->bytes / sizeof(float));
        return FaceMeshEngine::ComputeMetrics(
            landmarks, frame.width, frame.height);
      }
    }

    lastError_ = "FaceMesh output tensor did not contain 468x3 float data";
    return {};
#else
    (void)frame;
    lastError_ =
        "FaceMesh Run requires TensorFlow Lite headers linked into the build";
    return {};
#endif
  }

 private:
  std::atomic<bool> ready_{false};
  std::string lastError_;
#if NAYAN_HAS_TFLITE
  struct XnnpackDeleter {
    void operator()(TfLiteDelegate* delegate) const {
      if (delegate != nullptr) {
        TfLiteXNNPackDelegateDelete(delegate);
      }
    }
  };

  std::unique_ptr<tflite::FlatBufferModel> model_;
  std::unique_ptr<tflite::Interpreter> interpreter_;
  std::unique_ptr<TfLiteDelegate, XnnpackDeleter> xnnpackDelegate_;
#if NAYAN_HAS_COREML_DELEGATE
  struct CoreMlDeleter {
    void operator()(TfLiteDelegate* delegate) const {
      if (delegate != nullptr) {
        TfLiteCoreMlDelegateDelete(delegate);
      }
    }
  };
  std::unique_ptr<TfLiteDelegate, CoreMlDeleter> coreMlDelegate_;
#else
  std::unique_ptr<TfLiteDelegate> coreMlDelegate_;
#endif
#if NAYAN_HAS_METAL_DELEGATE
  struct MetalDeleter {
    void operator()(TfLiteDelegate* delegate) const {
      if (delegate != nullptr) {
        TFLGpuDelegateDelete(delegate);
      }
    }
  };
  std::unique_ptr<TfLiteDelegate, MetalDeleter> metalDelegate_;
#else
  std::unique_ptr<TfLiteDelegate> metalDelegate_;
#endif
#endif
};

FaceMeshEngine::FaceMeshEngine() : impl_(std::make_unique<Impl>()) {}
FaceMeshEngine::~FaceMeshEngine() = default;
FaceMeshEngine::FaceMeshEngine(FaceMeshEngine&&) noexcept = default;
FaceMeshEngine& FaceMeshEngine::operator=(FaceMeshEngine&&) noexcept = default;

bool FaceMeshEngine::LoadModel(const std::string& modelPath) {
  return impl_->LoadModel(modelPath);
}

bool FaceMeshEngine::IsReady() const {
  return impl_->IsReady();
}

std::string FaceMeshEngine::LastError() const {
  return impl_->LastError();
}

FaceMetrics FaceMeshEngine::Run(const ImageFrame& frame) {
  return impl_->Run(frame);
}

FaceMetrics FaceMeshEngine::ComputeFromLandmarks(
    const FaceLandmarks& landmarks,
    uint32_t frameWidth,
    uint32_t frameHeight) const {
  return ComputeMetrics(landmarks, frameWidth, frameHeight);
}

FaceLandmarks FaceMeshEngine::ParseLandmarks(const float* values,
                                             std::size_t valueCount) {
  if (values == nullptr || valueCount < 468U * 3U) {
    throw std::invalid_argument("FaceMesh output must contain 468 xyz points");
  }

  FaceLandmarks landmarks{};
  for (std::size_t i = 0; i < landmarks.size(); ++i) {
    landmarks[i] = {values[i * 3U], values[(i * 3U) + 1U],
                    values[(i * 3U) + 2U]};
  }
  return landmarks;
}

FaceMetrics FaceMeshEngine::ComputeMetrics(const FaceLandmarks& landmarks,
                                           uint32_t frameWidth,
                                           uint32_t frameHeight) {
  FaceMetrics metrics{};
  metrics.faceDetected = LooksLikeValidLandmarks(landmarks);
  if (!metrics.faceDetected) {
    return metrics;
  }

  metrics.ear = ComputeEAR(landmarks);
  metrics.mar = ComputeMAR(landmarks);
  const HeadPose pose = EstimateHeadPose(landmarks, frameWidth, frameHeight);
  metrics.yaw = pose.yaw;
  metrics.pitch = pose.pitch;
  metrics.roll = pose.roll;
  return metrics;
}

float FaceMeshEngine::ComputeEAR(const FaceLandmarks& landmarks) {
  return (EyeRatio(landmarks, kLeftEye) + EyeRatio(landmarks, kRightEye)) * 0.5f;
}

float FaceMeshEngine::ComputeMAR(const FaceLandmarks& landmarks) {
  const float verticalLeft = Distance2D(landmarks[kMouth[0]], landmarks[kMouth[3]]);
  const float verticalRight =
      Distance2D(landmarks[kMouth[1]], landmarks[kMouth[2]]);
  const float horizontal =
      Distance2D(landmarks[kMouth[4]], landmarks[kMouth[5]]);
  if (horizontal <= kEpsilon) {
    return 0.0f;
  }
  return (verticalLeft + verticalRight) / (2.0f * horizontal);
}

HeadPose FaceMeshEngine::EstimateHeadPose(const FaceLandmarks& landmarks,
                                          uint32_t frameWidth,
                                          uint32_t frameHeight) {
  if (frameWidth == 0U || frameHeight == 0U || !LooksLikeValidLandmarks(landmarks)) {
    return {};
  }

  return SolvePnPLevenbergMarquardt(
      CanonicalFaceModel(), PoseImagePoints(landmarks),
      MakeIntrinsics(frameWidth, frameHeight));
}

}  // namespace offlineface::landmarks
