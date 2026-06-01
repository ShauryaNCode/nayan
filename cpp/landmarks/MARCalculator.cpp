#include "MARCalculator.h"

namespace offlineface::landmarks {

float MARCalculator::Compute(const FaceLandmarks& landmarks) {
  return FaceMeshEngine::ComputeMAR(landmarks);
}

}  // namespace offlineface::landmarks
