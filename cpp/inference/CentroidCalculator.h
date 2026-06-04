#pragma once

#include <cstdint>
#include <vector>
#include <string>
#include <mutex>
#include <deque>

namespace offlineface::inference {

struct CentroidResult {
  std::string status; // "PENDING", "SUCCESS", "FAILED"
  std::vector<float> centroid;
};

class CentroidCalculator {
 public:
  CentroidCalculator() = default;
  ~CentroidCalculator() = default;

  void Reset();
  CentroidResult SubmitFrame(uint64_t timestampNs, const float* embedding, std::size_t length);

 private:
  struct Sample {
    uint64_t timestampNs{0};
    std::vector<float> embedding;
  };

  void PruneWindow(uint64_t latestTimestampNs);
  
  std::mutex mutex_;
  std::deque<Sample> samples_;
};

} // namespace offlineface::inference
