#pragma once
#include <cstdint>
namespace offlineface::clahe {
class AdaptiveClipController {
 public:
  uint32_t SelectClipLimit(const uint8_t* input, uint32_t width, uint32_t height, uint32_t stride, uint32_t tileWidth, uint32_t tileHeight) const;
};
}
