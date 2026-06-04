#pragma once

#include <array>
#include <cstddef>
#include <cstdint>

namespace offlineface::antispoof {

struct DepthCueResult {
  bool faceDetected{false};
  bool spoofDetected{false};
  float faceBoxToEyeRatio{0.0f};
  float confidence{0.0f};
};

DepthCueResult CheckDepthCueFromLandmarks(const float* landmarkValues,
                                          std::size_t landmarkValueCount,
                                          uint32_t frameWidth,
                                          uint32_t frameHeight);

}  // namespace offlineface::antispoof
