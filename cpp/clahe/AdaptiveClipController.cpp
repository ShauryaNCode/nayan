#include "AdaptiveClipController.h"
#include <algorithm>
namespace offlineface::clahe {
uint32_t AdaptiveClipController::SelectClipLimit(const uint8_t* input, uint32_t width, uint32_t height, uint32_t stride, uint32_t tileWidth, uint32_t tileHeight) const {
  if (input == nullptr || width == 0U || height == 0U) return 1U; uint64_t sum = 0U, sumSquares = 0U, samples = 0U; const uint32_t rowStep = std::max(1U, tileHeight / 2U); const uint32_t columnStep = std::max(1U, tileWidth / 2U);
  for (uint32_t row = 0; row < height; row += rowStep) for (uint32_t column = 0; column < width; column += columnStep) { const uint8_t value = input[row * stride + column]; sum += value; sumSquares += static_cast<uint64_t>(value) * static_cast<uint64_t>(value); ++samples; }
  if (samples == 0U) return 1U; const uint64_t mean = sum / samples; const uint64_t variance = (sumSquares / samples) > (mean * mean) ? (sumSquares / samples) - (mean * mean) : 0U; const uint32_t tilePixels = std::max(1U, tileWidth * tileHeight); uint32_t multiplierMilli = 1800U; if (mean < 60U) multiplierMilli = 3000U; else if (mean > 190U && variance > 2000U) multiplierMilli = 1200U; else if (variance < 400U) multiplierMilli = 2600U; else if (variance > 3500U) multiplierMilli = 1500U; return std::max<uint32_t>(1U, (tilePixels * multiplierMilli) / 256000U); }
}
