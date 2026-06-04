#include "DepthCueChecker.h"

#include <algorithm>
#include <cmath>
#include <limits>

namespace offlineface::antispoof {
namespace {

constexpr std::size_t kLandmarkCount = 468U;
constexpr std::size_t kValuesPerLandmark = 3U;
constexpr int kLeftEyeOuter = 33;
constexpr int kRightEyeOuter = 263;
constexpr float kMinInterOcularPixels = 12.0f;
constexpr float kMinBoxPixels = 32.0f;
constexpr float kSuspiciousMinRatio = 1.45f;
constexpr float kSuspiciousMaxRatio = 2.75f;
constexpr float kHardMinRatio = 1.25f;
constexpr float kHardMaxRatio = 3.15f;

struct Point {
  float x{0.0f};
  float y{0.0f};
};

Point ReadPoint(const float* values, int index, uint32_t width, uint32_t height) {
  Point point{values[index * kValuesPerLandmark],
              values[(index * kValuesPerLandmark) + 1U]};
  if (std::abs(point.x) <= 2.0f && std::abs(point.y) <= 2.0f) {
    point.x *= static_cast<float>(width);
    point.y *= static_cast<float>(height);
  }
  return point;
}

float Distance(Point a, Point b) {
  const float dx = a.x - b.x;
  const float dy = a.y - b.y;
  return std::sqrt((dx * dx) + (dy * dy));
}

}  // namespace

DepthCueResult CheckDepthCueFromLandmarks(const float* landmarkValues,
                                          std::size_t landmarkValueCount,
                                          uint32_t frameWidth,
                                          uint32_t frameHeight) {
  DepthCueResult result{};
  if (landmarkValues == nullptr ||
      landmarkValueCount < kLandmarkCount * kValuesPerLandmark ||
      frameWidth == 0U || frameHeight == 0U) {
    return result;
  }

  float minX = std::numeric_limits<float>::max();
  float minY = std::numeric_limits<float>::max();
  float maxX = std::numeric_limits<float>::lowest();
  float maxY = std::numeric_limits<float>::lowest();
  for (std::size_t i = 0; i < kLandmarkCount; ++i) {
    Point point = ReadPoint(
        landmarkValues, static_cast<int>(i), frameWidth, frameHeight);
    if (!std::isfinite(point.x) || !std::isfinite(point.y)) {
      continue;
    }
    minX = std::min(minX, point.x);
    minY = std::min(minY, point.y);
    maxX = std::max(maxX, point.x);
    maxY = std::max(maxY, point.y);
  }

  const float boxWidth = maxX - minX;
  const float boxHeight = maxY - minY;
  const float boxSize = std::max(boxWidth, boxHeight);
  const float interOcular = Distance(
      ReadPoint(landmarkValues, kLeftEyeOuter, frameWidth, frameHeight),
      ReadPoint(landmarkValues, kRightEyeOuter, frameWidth, frameHeight));
  if (boxSize < kMinBoxPixels || interOcular < kMinInterOcularPixels) {
    return result;
  }

  result.faceDetected = true;
  result.faceBoxToEyeRatio = boxSize / interOcular;

  const bool hardFail = result.faceBoxToEyeRatio < kHardMinRatio ||
                        result.faceBoxToEyeRatio > kHardMaxRatio;
  const bool softFail = result.faceBoxToEyeRatio < kSuspiciousMinRatio ||
                        result.faceBoxToEyeRatio > kSuspiciousMaxRatio;
  result.spoofDetected = hardFail || softFail;
  if (result.spoofDetected) {
    const float nearestGood =
        result.faceBoxToEyeRatio < kSuspiciousMinRatio ? kSuspiciousMinRatio
                                                       : kSuspiciousMaxRatio;
    result.confidence = std::clamp(
        std::abs(result.faceBoxToEyeRatio - nearestGood) / 0.75f, 0.25f, 1.0f);
  }
  return result;
}

}  // namespace offlineface::antispoof
