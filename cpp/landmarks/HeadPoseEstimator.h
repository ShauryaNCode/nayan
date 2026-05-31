#pragma once

#include "FaceMeshEngine.h"

namespace offlineface::landmarks {

class HeadPoseEstimator {
 public:
  static HeadPose Estimate(const FaceLandmarks& landmarks,
                           uint32_t frameWidth,
                           uint32_t frameHeight);
};

}  // namespace offlineface::landmarks
