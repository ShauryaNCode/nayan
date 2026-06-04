#include "ColorSpaceConverter.h"

#include <algorithm>
#include <cmath>

namespace offlineface::clahe {
namespace {

float SrgbToLinear(float value) {
  value /= 255.0f;
  return value <= 0.04045f ? value / 12.92f
                           : std::pow((value + 0.055f) / 1.055f, 2.4f);
}

float LinearToSrgb(float value) {
  value = std::clamp(value, 0.0f, 1.0f);
  const float srgb = value <= 0.0031308f
                         ? value * 12.92f
                         : (1.055f * std::pow(value, 1.0f / 2.4f)) - 0.055f;
  return std::clamp(srgb * 255.0f, 0.0f, 255.0f);
}

float LabF(float value) {
  constexpr float kEpsilon = 0.008856f;
  constexpr float kKappa = 903.3f;
  return value > kEpsilon ? std::cbrt(value)
                          : ((kKappa * value) + 16.0f) / 116.0f;
}

float LabInvF(float value) {
  constexpr float kEpsilon = 0.008856f;
  constexpr float kKappa = 903.3f;
  const float cube = value * value * value;
  return cube > kEpsilon ? cube : ((116.0f * value) - 16.0f) / kKappa;
}

}  // namespace

void GrayToRgb(const uint8_t* gray,
               uint32_t width,
               uint32_t height,
               uint32_t stride,
               uint8_t* rgb) {
  if (gray == nullptr || rgb == nullptr) {
    return;
  }
  for (uint32_t y = 0; y < height; ++y) {
    for (uint32_t x = 0; x < width; ++x) {
      const uint8_t value = gray[(y * stride) + x];
      const std::size_t offset =
          (static_cast<std::size_t>(y) * width + x) * 3U;
      rgb[offset] = value;
      rgb[offset + 1U] = value;
      rgb[offset + 2U] = value;
    }
  }
}

void RgbToLab(const uint8_t* rgb,
              uint32_t width,
              uint32_t height,
              float* lab) {
  if (rgb == nullptr || lab == nullptr) {
    return;
  }

  for (uint32_t i = 0; i < width * height; ++i) {
    const float r = SrgbToLinear(rgb[(i * 3U) + 0U]);
    const float g = SrgbToLinear(rgb[(i * 3U) + 1U]);
    const float b = SrgbToLinear(rgb[(i * 3U) + 2U]);

    const float x = ((0.4124564f * r) + (0.3575761f * g) + (0.1804375f * b)) /
                    0.95047f;
    const float y = (0.2126729f * r) + (0.7151522f * g) + (0.0721750f * b);
    const float z = ((0.0193339f * r) + (0.1191920f * g) + (0.9503041f * b)) /
                    1.08883f;

    const float fx = LabF(x);
    const float fy = LabF(y);
    const float fz = LabF(z);
    lab[(i * 3U) + 0U] = (116.0f * fy) - 16.0f;
    lab[(i * 3U) + 1U] = 500.0f * (fx - fy);
    lab[(i * 3U) + 2U] = 200.0f * (fy - fz);
  }
}

void LabToRgb(const float* lab,
              uint32_t width,
              uint32_t height,
              uint8_t* rgb) {
  if (lab == nullptr || rgb == nullptr) {
    return;
  }

  for (uint32_t i = 0; i < width * height; ++i) {
    const float l = lab[(i * 3U) + 0U];
    const float a = lab[(i * 3U) + 1U];
    const float b = lab[(i * 3U) + 2U];

    const float fy = (l + 16.0f) / 116.0f;
    const float fx = fy + (a / 500.0f);
    const float fz = fy - (b / 200.0f);
    const float x = 0.95047f * LabInvF(fx);
    const float y = LabInvF(fy);
    const float z = 1.08883f * LabInvF(fz);

    const float r = (3.2404542f * x) + (-1.5371385f * y) + (-0.4985314f * z);
    const float g = (-0.9692660f * x) + (1.8760108f * y) + (0.0415560f * z);
    const float blue = (0.0556434f * x) + (-0.2040259f * y) +
                       (1.0572252f * z);
    rgb[(i * 3U) + 0U] =
        static_cast<uint8_t>(std::lround(LinearToSrgb(r)));
    rgb[(i * 3U) + 1U] =
        static_cast<uint8_t>(std::lround(LinearToSrgb(g)));
    rgb[(i * 3U) + 2U] =
        static_cast<uint8_t>(std::lround(LinearToSrgb(blue)));
  }
}

void ExtractLChannel(const float* lab,
                     uint32_t width,
                     uint32_t height,
                     uint8_t* luma) {
  if (lab == nullptr || luma == nullptr) {
    return;
  }
  for (uint32_t i = 0; i < width * height; ++i) {
    luma[i] = static_cast<uint8_t>(
        std::lround(std::clamp(lab[i * 3U], 0.0f, 100.0f) * 2.55f));
  }
}

void ReplaceLChannel(const uint8_t* luma,
                     uint32_t width,
                     uint32_t height,
                     float* lab) {
  if (luma == nullptr || lab == nullptr) {
    return;
  }
  for (uint32_t i = 0; i < width * height; ++i) {
    lab[i * 3U] = static_cast<float>(luma[i]) / 2.55f;
  }
}

void RgbToGray(const uint8_t* rgb,
               uint32_t width,
               uint32_t height,
               uint8_t* gray) {
  if (rgb == nullptr || gray == nullptr) {
    return;
  }
  for (uint32_t i = 0; i < width * height; ++i) {
    const uint32_t r = rgb[(i * 3U) + 0U];
    const uint32_t g = rgb[(i * 3U) + 1U];
    const uint32_t b = rgb[(i * 3U) + 2U];
    gray[i] = static_cast<uint8_t>(((77U * r) + (150U * g) + (29U * b)) >> 8U);
  }
}

}  // namespace offlineface::clahe
