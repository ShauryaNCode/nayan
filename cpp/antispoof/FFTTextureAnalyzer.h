#pragma once
#include <cstdint>
namespace antispoof {
struct FFTTextureResult { bool spoofDetected{false}; uint32_t highFrequencyRatioQ10{0}; uint32_t moireScoreQ10{0}; };
FFTTextureResult AnalyzeFaceCropFixed(const uint8_t* grayImage, int width, int height, int stride, float threshold = 0.38f);
bool IsSpoof(const uint8_t* grayImage, int width, int height, float threshold = 0.38f);
bool IsSpoofFixed(const uint8_t* grayImage, int width, int height, float threshold = 0.38f);
}  // namespace antispoof
