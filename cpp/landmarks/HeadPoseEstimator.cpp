#include "HeadPoseEstimator.h"

namespace offlineface::landmarks {

HeadPose HeadPoseEstimator::Estimate(const FaceLandmarks& landmarks,
                                     uint32_t frameWidth,
                                     uint32_t frameHeight) {
  return FaceMeshEngine::EstimateHeadPose(landmarks, frameWidth, frameHeight);
}

}  // namespace offlineface::landmarks
