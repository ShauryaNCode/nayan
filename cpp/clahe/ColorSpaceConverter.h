#pragma once

#include <cstdint>

namespace offlineface::clahe {

void GrayToRgb(const uint8_t* gray,
               uint32_t width,
               uint32_t height,
               uint32_t stride,
               uint8_t* rgb);

void RgbToLab(const uint8_t* rgb,
              uint32_t width,
              uint32_t height,
              float* lab);

void LabToRgb(const float* lab,
              uint32_t width,
              uint32_t height,
              uint8_t* rgb);

void ExtractLChannel(const float* lab,
                     uint32_t width,
                     uint32_t height,
                     uint8_t* luma);

void ReplaceLChannel(const uint8_t* luma,
                     uint32_t width,
                     uint32_t height,
                     float* lab);

void RgbToGray(const uint8_t* rgb,
               uint32_t width,
               uint32_t height,
               uint8_t* gray);

}  // namespace offlineface::clahe
