#include "CLAHEEngine.h"
#include <algorithm>
#if defined(__ARM_NEON) || defined(__ARM_NEON__)
#include <arm_neon.h>
#endif
#include "AdaptiveClipController.h"
namespace offlineface::clahe {
namespace {
uint8_t BilinearSample(uint8_t tl, uint8_t tr, uint8_t bl, uint8_t br, uint32_t xw, uint32_t yw, uint32_t xs, uint32_t ys) { const uint32_t top = ((xs - xw) * tl) + (xw * tr); const uint32_t bottom = ((xs - xw) * bl) + (xw * br); const uint32_t value = (((ys - yw) * top) + (yw * bottom)) / (xs * ys); return static_cast<uint8_t>(std::min<uint32_t>(255U, value)); }
}
CLAHEEngine::CLAHEEngine(CLAHEConfig config) : config_(config) {}
void CLAHEEngine::SetAdaptiveClipController(AdaptiveClipController* controller) { clipController_ = controller; }
void CLAHEEngine::Apply(const uint8_t* input, uint32_t width, uint32_t height, uint32_t stride, uint8_t* output) const {
  if (input == nullptr || output == nullptr || width == 0U || height == 0U) return;
  const uint32_t tileWidth = std::max(1U, (width + config_.tilesX - 1U) / config_.tilesX); const uint32_t tileHeight = std::max(1U, (height + config_.tilesY - 1U) / config_.tilesY); const uint32_t tileCount = config_.tilesX * config_.tilesY;
  std::vector<std::vector<uint8_t>> luts(tileCount, std::vector<uint8_t>(config_.bins, 0U)); std::vector<uint32_t> histogram(config_.bins, 0U);
  const uint32_t clipLimit = clipController_ != nullptr ? clipController_->SelectClipLimit(input, width, height, stride, tileWidth, tileHeight) : std::max<uint32_t>(1U, (tileWidth * tileHeight) / 32U);
  for (uint32_t ty = 0; ty < config_.tilesY; ++ty) for (uint32_t tx = 0; tx < config_.tilesX; ++tx) { std::fill(histogram.begin(), histogram.end(), 0U); BuildTileHistogram(input, width, height, stride, tx, ty, tileWidth, tileHeight, histogram); ClipHistogram(histogram, clipLimit); const uint32_t currentTileWidth = std::min(tileWidth, width - std::min(width, tx * tileWidth)); const uint32_t currentTileHeight = std::min(tileHeight, height - std::min(height, ty * tileHeight)); BuildLut(histogram, std::max<uint32_t>(1U, currentTileWidth * currentTileHeight), luts[ty * config_.tilesX + tx]); }
  for (uint32_t row = 0; row < height; ++row) { const uint32_t tileY = std::min(config_.tilesY - 1U, row / tileHeight); const uint32_t nextTileY = std::min(config_.tilesY - 1U, tileY + 1U); const uint32_t yWeight = row % tileHeight; for (uint32_t column = 0; column < width; ++column) { const uint32_t tileX = std::min(config_.tilesX - 1U, column / tileWidth); const uint32_t nextTileX = std::min(config_.tilesX - 1U, tileX + 1U); const uint32_t xWeight = column % tileWidth; const uint8_t value = input[row * stride + column]; const uint8_t tl = luts[tileY * config_.tilesX + tileX][value]; const uint8_t tr = luts[tileY * config_.tilesX + nextTileX][value]; const uint8_t bl = luts[nextTileY * config_.tilesX + tileX][value]; const uint8_t br = luts[nextTileY * config_.tilesX + nextTileX][value]; output[row * width + column] = BilinearSample(tl, tr, bl, br, xWeight, yWeight, tileWidth, tileHeight); } }
}
void CLAHEEngine::BuildTileHistogram(const uint8_t* input, uint32_t width, uint32_t height, uint32_t stride, uint32_t tileX, uint32_t tileY, uint32_t tileWidth, uint32_t tileHeight, std::vector<uint32_t>& histogram) const {
  const uint32_t startX = tileX * tileWidth; const uint32_t startY = tileY * tileHeight; const uint32_t endX = std::min(width, startX + tileWidth); const uint32_t endY = std::min(height, startY + tileHeight);
#if defined(__ARM_NEON) || defined(__ARM_NEON__)
  static const uint8_t identityTableBytes[16] = {0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15}; const uint8x16_t identityTable = vld1q_u8(identityTableBytes);
#endif
  for (uint32_t row = startY; row < endY; ++row) { const uint8_t* rowPtr = input + (row * stride) + startX; uint32_t column = startX;
#if defined(__ARM_NEON) || defined(__ARM_NEON__)
    for (; column + 16U <= endX; column += 16U, rowPtr += 16U) { const uint8x16_t values = vld1q_u8(rowPtr); const uint8x8x2_t tables = {{vget_low_u8(identityTable), vget_high_u8(identityTable)}}; const uint8x8_t lowLane = vtbl2_u8(tables, vget_low_u8(values)); const uint8x8_t highLane = vtbl2_u8(tables, vget_high_u8(values)); alignas(16) uint8_t unpacked[16]; vst1_u8(unpacked, lowLane); vst1_u8(unpacked + 8, highLane); for (uint32_t lane = 0; lane < 16U; ++lane) ++histogram[unpacked[lane]]; }
#endif
    for (; column < endX; ++column, ++rowPtr) ++histogram[*rowPtr]; }
}
void CLAHEEngine::ClipHistogram(std::vector<uint32_t>& histogram, uint32_t clipLimit) const { uint32_t excess = 0U; for (uint32_t& bin : histogram) { if (bin > clipLimit) { excess += (bin - clipLimit); bin = clipLimit; } } const uint32_t increment = excess / static_cast<uint32_t>(histogram.size()); const uint32_t remainder = excess % static_cast<uint32_t>(histogram.size()); for (uint32_t& bin : histogram) bin += increment; for (uint32_t i = 0; i < remainder; ++i) ++histogram[i]; }
void CLAHEEngine::BuildLut(const std::vector<uint32_t>& histogram, uint32_t tilePixelCount, std::vector<uint8_t>& lut) const { uint32_t cdf = 0U; for (uint32_t i = 0; i < config_.bins; ++i) { cdf += histogram[i]; const uint32_t scaled = (cdf * 255U) / tilePixelCount; lut[i] = static_cast<uint8_t>(std::min<uint32_t>(255U, scaled)); } }
}
