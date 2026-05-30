#pragma once

#include <cstddef>
#include <cstdint>
#include <vector>

namespace offlineface::common {
struct CpuFeatures { bool neon{false}; bool dotProduct{false}; };
CpuFeatures DetectCpuFeatures();
float DotProduct(const float* lhs, const float* rhs, std::size_t length);
float L2Norm(const float* values, std::size_t length);
void NormalizeL2(float* values, std::size_t length);
float CosineSimilarity(const float* lhs, const float* rhs, std::size_t length);
float EuclideanDistance(const float* lhs, const float* rhs, std::size_t length);
std::vector<float> ComputeCentroid(const std::vector<std::vector<float>>& vectors);
float CosineSimilarityNeonInterleaved8(const float* lhs, const float* rhs, std::size_t length);
std::vector<float> CosineSimilarities(const float* query, const float* database, std::size_t vectorCount, std::size_t vectorLength);
}
