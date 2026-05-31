#pragma once

#include "FaceMeshEngine.h"

namespace offlineface::landmarks {

class MARCalculator {
 public:
  static float Compute(const FaceLandmarks& landmarks);
};

}  // namespace offlineface::landmarks
