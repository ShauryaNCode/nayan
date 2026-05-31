#include "EARCalculator.h"

namespace offlineface::landmarks {

float EARCalculator::Compute(const FaceLandmarks& landmarks) {
  return FaceMeshEngine::ComputeEAR(landmarks);
}

}  // namespace offlineface::landmarks
