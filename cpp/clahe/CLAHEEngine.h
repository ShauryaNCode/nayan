#pragma once
#include <cstdint>
#include <vector>
namespace offlineface::clahe {
struct CLAHEConfig { uint32_t tilesX{8}; uint32_t tilesY{8}; uint32_t bins{256}; };
class AdaptiveClipController;
class CLAHEEngine {
 public:
  explicit CLAHEEngine(CLAHEConfig config = {});
  void SetAdaptiveClipController(AdaptiveClipController* controller);
  void Apply(const uint8_t* input, uint32_t width, uint32_t height, uint32_t stride, uint8_t* output) const;
 private:
  void BuildTileHistogram(const uint8_t* input, uint32_t width, uint32_t height, uint32_t stride, uint32_t tileX, uint32_t tileY, uint32_t tileWidth, uint32_t tileHeight, std::vector<uint32_t>& histogram) const;
  void ClipHistogram(std::vector<uint32_t>& histogram, uint32_t clipLimit) const;
  void BuildLut(const std::vector<uint32_t>& histogram, uint32_t tilePixelCount, std::vector<uint8_t>& lut) const;
  CLAHEConfig config_; AdaptiveClipController* clipController_{nullptr};
};
}
