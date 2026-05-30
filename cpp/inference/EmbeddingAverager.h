#pragma once
#include <cstdint>
#include <deque>
#include <mutex>
#include <vector>
namespace offlineface::inference {
class EmbeddingAverager {
 public:
  std::vector<float> PushEmbedding(uint64_t timestampNs, const std::vector<float>& embedding);
 private:
  struct Sample { uint64_t timestampNs{0}; std::vector<float> embedding; };
  void PruneWindow(uint64_t latestTimestampNs);
  std::mutex mutex_; std::deque<Sample> samples_;
};
}
