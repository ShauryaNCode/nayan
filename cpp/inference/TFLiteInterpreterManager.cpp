#include "TFLiteInterpreterManager.h"
#include <algorithm>
#include <stdexcept>
#include "../common/MathUtils.h"
namespace offlineface::inference {
TFLiteInterpreterManager& TFLiteInterpreterManager::Instance() { static TFLiteInterpreterManager instance; return instance; }
void TFLiteInterpreterManager::Initialize(const std::string& modelPath) { std::lock_guard<std::mutex> lock(mutex_); if (modelPath.empty()) throw std::invalid_argument("modelPath must not be empty"); modelPath_ = modelPath; ConfigureThreadBudget(); CreateDelegates(); initialized_ = true; }
std::vector<float> TFLiteInterpreterManager::RunEmbedding(const uint8_t* grayPixels, uint32_t width, uint32_t height, uint32_t stride) { std::lock_guard<std::mutex> lock(mutex_); if (!initialized_) return {}; return RunMockEmbedding(grayPixels, width, height, stride); }
bool TFLiteInterpreterManager::IsInitialized() const { std::lock_guard<std::mutex> lock(mutex_); return initialized_; }
std::vector<float> TFLiteInterpreterManager::RunMockEmbedding(const uint8_t* grayPixels, uint32_t width, uint32_t height, uint32_t stride) const { if (grayPixels == nullptr || width == 0U || height == 0U) return {}; constexpr std::size_t kEmbeddingSize = 128U; std::vector<float> embedding(kEmbeddingSize, 0.0f); const uint32_t blockWidth = std::max(1U, width / 16U); const uint32_t blockHeight = std::max(1U, height / 8U); std::size_t slot = 0U; for (uint32_t by = 0; by < 8U && slot < kEmbeddingSize; ++by) for (uint32_t bx = 0; bx < 16U && slot < kEmbeddingSize; ++bx) { uint64_t sum = 0U; uint32_t count = 0U; const uint32_t startY = by * blockHeight; const uint32_t endY = std::min(height, startY + blockHeight); const uint32_t startX = bx * blockWidth; const uint32_t endX = std::min(width, startX + blockWidth); for (uint32_t row = startY; row < endY; ++row) for (uint32_t column = startX; column < endX; ++column) { sum += grayPixels[row * stride + column]; ++count; } embedding[slot++] = count == 0U ? 0.0f : static_cast<float>(sum) / static_cast<float>(count * 255U); } offlineface::common::NormalizeL2(embedding.data(), embedding.size()); return embedding; }
void TFLiteInterpreterManager::ConfigureThreadBudget() { threadCount_ = 2; }
void TFLiteInterpreterManager::CreateDelegates() { useNnapi_ = false; useXnnpack_ = false; useCoreMl_ = false; useMetal_ = false;
#if defined(__ANDROID__)
#if __ANDROID_API__ >= 27
useNnapi_ = true;
#else
useXnnpack_ = true;
#endif
#elif defined(__APPLE__)
useCoreMl_ = true; useMetal_ = true;
#else
useXnnpack_ = true;
#endif
}
}
