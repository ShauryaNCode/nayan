#include "MathUtils.h"
#include <cmath>
#include <limits>
#if defined(__ARM_NEON) || defined(__ARM_NEON__)
#include <arm_neon.h>
#endif
namespace offlineface::common {
namespace {
float DotProductScalar(const float* lhs, const float* rhs, std::size_t length) { float acc = 0.0f; for (std::size_t i = 0; i < length; ++i) acc += lhs[i] * rhs[i]; return acc; }
float L2NormScalar(const float* values, std::size_t length) { return std::sqrt(std::max(0.0f, DotProductScalar(values, values, length))); }
float EuclideanDistanceScalar(const float* lhs, const float* rhs, std::size_t length) { float acc = 0.0f; for (std::size_t i = 0; i < length; ++i) { const float d = lhs[i] - rhs[i]; acc += d * d; } return std::sqrt(std::max(0.0f, acc)); }
#if defined(__ARM_NEON) || defined(__ARM_NEON__)
float HorizontalAdd(float32x4_t value) { const float32x2_t low = vget_low_f32(value); const float32x2_t high = vget_high_f32(value); const float32x2_t pair = vpadd_f32(low, high); const float32x2_t reduced = vpadd_f32(pair, pair); return vget_lane_f32(reduced, 0); }
#endif
}
CpuFeatures DetectCpuFeatures() { CpuFeatures features{};
#if defined(__aarch64__) || defined(_M_ARM64)
features.neon = true;
#if defined(__ARM_FEATURE_DOTPROD)
features.dotProduct = true;
#endif
#elif defined(__ARM_NEON) || defined(__ARM_NEON__)
features.neon = true;
#endif
return features; }
float DotProduct(const float* lhs, const float* rhs, std::size_t length) {
#if defined(__ARM_NEON) || defined(__ARM_NEON__)
if (DetectCpuFeatures().neon && length >= 8U) { float32x4_t acc0 = vdupq_n_f32(0.0f); float32x4_t acc1 = vdupq_n_f32(0.0f); std::size_t i = 0; for (; i + 8U <= length; i += 8U) { const float32x4x2_t a = vld1q_f32_x2(lhs + i); const float32x4x2_t b = vld1q_f32_x2(rhs + i); acc0 = vmlaq_f32(acc0, a.val[0], b.val[0]); acc1 = vmlaq_f32(acc1, a.val[1], b.val[1]); } float total = HorizontalAdd(vaddq_f32(acc0, acc1)); for (; i < length; ++i) total += lhs[i] * rhs[i]; return total; }
#endif
return DotProductScalar(lhs, rhs, length); }
float L2Norm(const float* values, std::size_t length) {
#if defined(__ARM_NEON) || defined(__ARM_NEON__)
if (DetectCpuFeatures().neon && length >= 8U) { float32x4_t acc0 = vdupq_n_f32(0.0f); float32x4_t acc1 = vdupq_n_f32(0.0f); std::size_t i = 0; for (; i + 8U <= length; i += 8U) { const float32x4x2_t p = vld1q_f32_x2(values + i); acc0 = vmlaq_f32(acc0, p.val[0], p.val[0]); acc1 = vmlaq_f32(acc1, p.val[1], p.val[1]); } float total = HorizontalAdd(vaddq_f32(acc0, acc1)); for (; i < length; ++i) total += values[i] * values[i]; return std::sqrt(std::max(0.0f, total)); }
#endif
return L2NormScalar(values, length); }
void NormalizeL2(float* values, std::size_t length) { const float norm = L2Norm(values, length); if (norm <= std::numeric_limits<float>::epsilon()) return; for (std::size_t i = 0; i < length; ++i) values[i] /= norm; }
float CosineSimilarity(const float* lhs, const float* rhs, std::size_t length) { const float denom = L2Norm(lhs, length) * L2Norm(rhs, length); return denom <= std::numeric_limits<float>::epsilon() ? 0.0f : DotProduct(lhs, rhs, length) / denom; }
float EuclideanDistance(const float* lhs, const float* rhs, std::size_t length) {
#if defined(__ARM_NEON) || defined(__ARM_NEON__)
if (DetectCpuFeatures().neon && length >= 8U) { float32x4_t acc0 = vdupq_n_f32(0.0f); float32x4_t acc1 = vdupq_n_f32(0.0f); std::size_t i = 0; for (; i + 8U <= length; i += 8U) { const float32x4x2_t a = vld1q_f32_x2(lhs + i); const float32x4x2_t b = vld1q_f32_x2(rhs + i); const float32x4_t d0 = vsubq_f32(a.val[0], b.val[0]); const float32x4_t d1 = vsubq_f32(a.val[1], b.val[1]); acc0 = vmlaq_f32(acc0, d0, d0); acc1 = vmlaq_f32(acc1, d1, d1); } float total = HorizontalAdd(vaddq_f32(acc0, acc1)); for (; i < length; ++i) { const float d = lhs[i] - rhs[i]; total += d * d; } return std::sqrt(std::max(0.0f, total)); }
#endif
return EuclideanDistanceScalar(lhs, rhs, length); }
std::vector<float> ComputeCentroid(const std::vector<std::vector<float>>& vectors) { if (vectors.empty()) return {}; const std::size_t length = vectors.front().size(); std::vector<float> centroid(length, 0.0f); for (const auto& vector : vectors) for (std::size_t i = 0; i < length; ++i) centroid[i] += vector[i]; const float scale = 1.0f / static_cast<float>(vectors.size()); for (float& value : centroid) value *= scale; return centroid; }
float CosineSimilarityNeonInterleaved8(const float* lhs, const float* rhs, std::size_t length) {
#if defined(__ARM_NEON) || defined(__ARM_NEON__)
if (DetectCpuFeatures().neon && length >= 8U) { float32x4_t dot0 = vdupq_n_f32(0.0f), dot1 = vdupq_n_f32(0.0f), ln0 = vdupq_n_f32(0.0f), ln1 = vdupq_n_f32(0.0f), rn0 = vdupq_n_f32(0.0f), rn1 = vdupq_n_f32(0.0f); std::size_t i = 0; for (; i + 8U <= length; i += 8U) { const float32x4x2_t a = vld1q_f32_x2(lhs + i); const float32x4x2_t b = vld1q_f32_x2(rhs + i); dot0 = vmlaq_f32(dot0, a.val[0], b.val[0]); ln0 = vmlaq_f32(ln0, a.val[0], a.val[0]); rn0 = vmlaq_f32(rn0, b.val[0], b.val[0]); dot1 = vmlaq_f32(dot1, a.val[1], b.val[1]); ln1 = vmlaq_f32(ln1, a.val[1], a.val[1]); rn1 = vmlaq_f32(rn1, b.val[1], b.val[1]); } float dot = HorizontalAdd(vaddq_f32(dot0, dot1)); float lhsNorm = HorizontalAdd(vaddq_f32(ln0, ln1)); float rhsNorm = HorizontalAdd(vaddq_f32(rn0, rn1)); for (; i < length; ++i) { dot += lhs[i] * rhs[i]; lhsNorm += lhs[i] * lhs[i]; rhsNorm += rhs[i] * rhs[i]; } const float denom = std::sqrt(std::max(0.0f, lhsNorm)) * std::sqrt(std::max(0.0f, rhsNorm)); return denom <= std::numeric_limits<float>::epsilon() ? 0.0f : dot / denom; }
#endif
return CosineSimilarity(lhs, rhs, length); }
std::vector<float> CosineSimilarities(const float* query, const float* database, std::size_t vectorCount, std::size_t vectorLength) { std::vector<float> out(vectorCount, 0.0f); for (std::size_t i = 0; i < vectorCount; ++i) out[i] = CosineSimilarityNeonInterleaved8(query, database + (i * vectorLength), vectorLength); return out; }
}
