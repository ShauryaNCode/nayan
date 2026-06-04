#include "CentroidCalculator.h"
#include <algorithm>
#include <cmath>

#if defined(__ARM_NEON) || defined(__ARM_NEON__)
#include <arm_neon.h>
#endif

namespace offlineface::inference {

namespace {

bool HasNeonSupport() {
#if defined(__aarch64__) || defined(_M_ARM64)
  return true;
#elif defined(__ARM_NEON) || defined(__ARM_NEON__)
  return true;
#else
  return false;
#endif
}

float EuclideanDistanceScalar(const float* lhs, const float* rhs, std::size_t length) {
  float total = 0.0f;
  for (std::size_t i = 0; i < length; ++i) {
    const float d = lhs[i] - rhs[i];
    total += d * d;
  }
  return std::sqrt(std::max(0.0f, total));
}

#if defined(__ARM_NEON) || defined(__ARM_NEON__)
float EuclideanDistanceNeon8(const float* lhs, const float* rhs, std::size_t length) {
  float32x4_t acc0 = vdupq_n_f32(0.0f);
  float32x4_t acc1 = vdupq_n_f32(0.0f);
  std::size_t i = 0;
  for (; i + 8U <= length; i += 8U) {
    const float32x4x2_t a = vld1q_f32_x2(lhs + i);
    const float32x4x2_t b = vld1q_f32_x2(rhs + i);
    const float32x4_t d0 = vsubq_f32(a.val[0], b.val[0]);
    const float32x4_t d1 = vsubq_f32(a.val[1], b.val[1]);
    acc0 = vmlaq_f32(acc0, d0, d0);
    acc1 = vmlaq_f32(acc1, d1, d1);
  }
  
  float32x4_t reduced4 = vaddq_f32(acc0, acc1);
  float32x2_t low = vget_low_f32(reduced4);
  float32x2_t high = vget_high_f32(reduced4);
  float32x2_t pair = vpadd_f32(low, high);
  float32x2_t reduced2 = vpadd_f32(pair, pair);
  float total = vget_lane_f32(reduced2, 0);
  
  for (; i < length; ++i) {
    const float d = lhs[i] - rhs[i];
    total += d * d;
  }
  return std::sqrt(std::max(0.0f, total));
}
#endif

} // namespace

void CentroidCalculator::Reset() {
  std::lock_guard<std::mutex> lock(mutex_);
  samples_.clear();
}

CentroidResult CentroidCalculator::SubmitFrame(uint64_t timestampNs, const float* embedding, std::size_t length) {
  std::lock_guard<std::mutex> lock(mutex_);
  
  if (embedding == nullptr || length != 128U) {
    return { "FAILED", {} };
  }
  
  samples_.push_back(Sample{timestampNs, std::vector<float>(embedding, embedding + length)});
  PruneWindow(timestampNs);
  
  while (samples_.size() > 5U) {
    samples_.pop_front();
  }
  
  if (samples_.size() < 5U) {
    return { "PENDING", {} };
  }
  
  // Compute pairwise Euclidean distances (10 unique pairs)
  float d[5][5] = {0.0f};
  for (int i = 0; i < 5; ++i) {
    for (int j = i + 1; j < 5; ++j) {
      float dist = 0.0f;
#if defined(__ARM_NEON) || defined(__ARM_NEON__)
      if (HasNeonSupport()) {
        dist = EuclideanDistanceNeon8(samples_[i].embedding.data(), samples_[j].embedding.data(), 128U);
      } else {
        dist = EuclideanDistanceScalar(samples_[i].embedding.data(), samples_[j].embedding.data(), 128U);
      }
#else
      dist = EuclideanDistanceScalar(samples_[i].embedding.data(), samples_[j].embedding.data(), 128U);
#endif
      d[i][j] = dist;
      d[j][i] = dist;
    }
  }
  
  float dists[10];
  int k = 0;
  for (int i = 0; i < 5; ++i) {
    for (int j = i + 1; j < 5; ++j) {
      dists[k++] = d[i][j];
    }
  }
  
  float sum = 0.0f;
  for (float val : dists) {
    sum += val;
  }
  float mean = sum / 10.0f;
  
  float sq_sum = 0.0f;
  for (float val : dists) {
    float diff = val - mean;
    sq_sum += diff * diff;
  }
  float variance = sq_sum / 10.0f;
  float stddev = std::sqrt(std::max(0.0f, variance));
  
  // Discard vector whose distance from the mean exceeds 1.5 * stddev
  float threshold = mean + 1.5f * stddev;
  
  std::vector<std::vector<float>> accepted;
  accepted.reserve(5);
  for (int i = 0; i < 5; ++i) {
    float sum_i = 0.0f;
    for (int j = 0; j < 5; ++j) {
      if (i == j) continue;
      sum_i += d[i][j];
    }
    float mean_i = sum_i / 4.0f;
    if (mean_i <= threshold) {
      accepted.push_back(samples_[i].embedding);
    }
  }
  
  if (accepted.size() < 3U) {
    return { "FAILED", {} };
  }
  
  // Compute final centroid vector
  std::vector<float> centroid(128U, 0.0f);
#if defined(__ARM_NEON) || defined(__ARM_NEON__)
  if (HasNeonSupport()) {
    float32x4_t sum0 = vdupq_n_f32(0.0f);
    float32x4_t sum1 = vdupq_n_f32(0.0f);
    float scale = 1.0f / static_cast<float>(accepted.size());
    float32x4_t scale_v = vdupq_n_f32(scale);
    
    for (std::size_t offset = 0; offset < 128U; offset += 8) {
      sum0 = vdupq_n_f32(0.0f);
      sum1 = vdupq_n_f32(0.0f);
      for (const auto& vec : accepted) {
        float32x4x2_t v = vld1q_f32_x2(vec.data() + offset);
        sum0 = vaddq_f32(sum0, v.val[0]);
        sum1 = vaddq_f32(sum1, v.val[1]);
      }
      float32x4x2_t res;
      res.val[0] = vmulq_f32(sum0, scale_v);
      res.val[1] = vmulq_f32(sum1, scale_v);
      vst1q_f32_x2(centroid.data() + offset, res);
    }
  } else {
    for (const auto& vec : accepted) {
      for (std::size_t i = 0; i < 128U; ++i) {
        centroid[i] += vec[i];
      }
    }
    float scale = 1.0f / static_cast<float>(accepted.size());
    for (std::size_t i = 0; i < 128U; ++i) {
      centroid[i] *= scale;
    }
  }
#else
  for (const auto& vec : accepted) {
    for (std::size_t i = 0; i < 128U; ++i) {
      centroid[i] += vec[i];
    }
  }
  float scale = 1.0f / static_cast<float>(accepted.size());
  for (std::size_t i = 0; i < 128U; ++i) {
    centroid[i] *= scale;
  }
#endif

  // L2 Normalization
  float norm = 0.0f;
#if defined(__ARM_NEON) || defined(__ARM_NEON__)
  if (HasNeonSupport()) {
    float32x4_t norm0 = vdupq_n_f32(0.0f);
    float32x4_t norm1 = vdupq_n_f32(0.0f);
    for (std::size_t i = 0; i < 128U; i += 8) {
      float32x4x2_t c = vld1q_f32_x2(centroid.data() + i);
      norm0 = vmlaq_f32(norm0, c.val[0], c.val[0]);
      norm1 = vmlaq_f32(norm1, c.val[1], c.val[1]);
    }
    float32x4_t reduced4 = vaddq_f32(norm0, norm1);
    float32x2_t low = vget_low_f32(reduced4);
    float32x2_t high = vget_high_f32(reduced4);
    float32x2_t pair = vpadd_f32(low, high);
    float32x2_t reduced2 = vpadd_f32(pair, pair);
    norm = vget_lane_f32(reduced2, 0);
  } else {
    for (std::size_t i = 0; i < 128U; ++i) {
      norm += centroid[i] * centroid[i];
    }
  }
#else
  for (std::size_t i = 0; i < 128U; ++i) {
    norm += centroid[i] * centroid[i];
  }
#endif
  
  norm = std::sqrt(std::max(0.0f, norm));
  
  if (norm > 1e-6f) {
#if defined(__ARM_NEON) || defined(__ARM_NEON__)
    if (HasNeonSupport()) {
      float32x4_t inv_norm_v = vdupq_n_f32(1.0f / norm);
      for (std::size_t i = 0; i < 128U; i += 8) {
        float32x4x2_t c = vld1q_f32_x2(centroid.data() + i);
        float32x4x2_t res;
        res.val[0] = vmulq_f32(c.val[0], inv_norm_v);
        res.val[1] = vmulq_f32(c.val[1], inv_norm_v);
        vst1q_f32_x2(centroid.data() + i, res);
      }
    } else {
      float inv_norm = 1.0f / norm;
      for (std::size_t i = 0; i < 128U; ++i) {
        centroid[i] *= inv_norm;
      }
    }
#else
    float inv_norm = 1.0f / norm;
    for (std::size_t i = 0; i < 128U; ++i) {
      centroid[i] *= inv_norm;
    }
#endif
  }
  
  return { "SUCCESS", centroid };
}

void CentroidCalculator::PruneWindow(uint64_t latestTimestampNs) {
  constexpr uint64_t kWindowNs = 500000000ULL; // 500ms
  while (!samples_.empty() && latestTimestampNs > samples_.front().timestampNs &&
         (latestTimestampNs - samples_.front().timestampNs) > kWindowNs) {
    samples_.pop_front();
  }
}

} // namespace offlineface::inference
