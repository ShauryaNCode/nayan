#include "FFTTextureAnalyzer.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>

namespace antispoof {
namespace {
constexpr int kFftSize = 32;
constexpr int kFftBins = kFftSize * kFftSize;
constexpr int kQ15 = 32768;
constexpr float kPi = 3.14159265358979323846f;

struct ComplexQ15 {
  int32_t real{0};
  int32_t imag{0};
};

int32_t ClampI32(int64_t value) {
  return static_cast<int32_t>(
      std::clamp<int64_t>(value, -2147483647LL, 2147483647LL));
}

std::array<int16_t, kFftSize / 2> MakeTrigTable(bool sine) {
  std::array<int16_t, kFftSize / 2> table{};
  for (int i = 0; i < kFftSize / 2; ++i) {
    const float angle = 2.0f * kPi * static_cast<float>(i) / kFftSize;
    table[i] = static_cast<int16_t>(
        std::lround((sine ? std::sin(angle) : std::cos(angle)) * (kQ15 - 1)));
  }
  return table;
}

const std::array<int16_t, kFftSize / 2>& CosTable() {
  static const auto table = MakeTrigTable(false);
  return table;
}

const std::array<int16_t, kFftSize / 2>& SinTable() {
  static const auto table = MakeTrigTable(true);
  return table;
}

void Fft1D(ComplexQ15* values) {
  for (int i = 1, j = 0; i < kFftSize; ++i) {
    int bit = kFftSize >> 1;
    for (; (j & bit) != 0; bit >>= 1) {
      j ^= bit;
    }
    j ^= bit;
    if (i < j) {
      std::swap(values[i], values[j]);
    }
  }

  const auto& cosTable = CosTable();
  const auto& sinTable = SinTable();
  for (int length = 2; length <= kFftSize; length <<= 1) {
    const int half = length >> 1;
    const int tableStep = kFftSize / length;
    for (int start = 0; start < kFftSize; start += length) {
      for (int offset = 0; offset < half; ++offset) {
        const int tableIndex = offset * tableStep;
        const int32_t wr = cosTable[tableIndex];
        const int32_t wi = -sinTable[tableIndex];
        const ComplexQ15 even = values[start + offset];
        const ComplexQ15 odd = values[start + offset + half];
        const int32_t tr = ClampI32(
            ((static_cast<int64_t>(odd.real) * wr) -
             (static_cast<int64_t>(odd.imag) * wi)) >> 15);
        const int32_t ti = ClampI32(
            ((static_cast<int64_t>(odd.real) * wi) +
             (static_cast<int64_t>(odd.imag) * wr)) >> 15);
        values[start + offset] = {
            ClampI32(static_cast<int64_t>(even.real) + tr),
            ClampI32(static_cast<int64_t>(even.imag) + ti),
        };
        values[start + offset + half] = {
            ClampI32(static_cast<int64_t>(even.real) - tr),
            ClampI32(static_cast<int64_t>(even.imag) - ti),
        };
      }
    }
  }
}

void Fft2D(std::array<ComplexQ15, kFftBins>& values) {
  for (int row = 0; row < kFftSize; ++row) {
    Fft1D(values.data() + (row * kFftSize));
  }

  std::array<ComplexQ15, kFftSize> column{};
  for (int x = 0; x < kFftSize; ++x) {
    for (int y = 0; y < kFftSize; ++y) {
      column[y] = values[(y * kFftSize) + x];
    }
    Fft1D(column.data());
    for (int y = 0; y < kFftSize; ++y) {
      values[(y * kFftSize) + x] = column[y];
    }
  }
}

int WrappedFrequency(int bin) {
  return bin <= kFftSize / 2 ? bin : kFftSize - bin;
}
}  // namespace

FFTTextureResult AnalyzeFaceCropFixed(const uint8_t* grayImage,
                                      int width,
                                      int height,
                                      int stride,
                                      float threshold) {
  if (grayImage == nullptr || width < 8 || height < 8 || stride < width) {
    return {};
  }

  const int cropSize = std::min(width, height);
  const int cropX = (width - cropSize) / 2;
  const int cropY = (height - cropSize) / 2;
  std::array<ComplexQ15, kFftBins> spectrum{};
  int64_t mean = 0;
  for (int y = 0; y < kFftSize; ++y) {
    const int srcY = cropY + ((y * cropSize) / kFftSize);
    for (int x = 0; x < kFftSize; ++x) {
      const int srcX = cropX + ((x * cropSize) / kFftSize);
      mean += grayImage[(srcY * stride) + srcX];
    }
  }
  mean /= kFftBins;

  for (int y = 0; y < kFftSize; ++y) {
    const int srcY = cropY + ((y * cropSize) / kFftSize);
    for (int x = 0; x < kFftSize; ++x) {
      const int srcX = cropX + ((x * cropSize) / kFftSize);
      const int32_t centered =
          (static_cast<int32_t>(grayImage[(srcY * stride) + srcX]) -
           static_cast<int32_t>(mean)) << 7;
      spectrum[(y * kFftSize) + x] = {centered, 0};
    }
  }

  Fft2D(spectrum);

  uint64_t totalEnergy = 1U;
  uint64_t highEnergy = 0U;
  uint64_t moireEnergy = 0U;
  for (int y = 0; y < kFftSize; ++y) {
    const int fy = WrappedFrequency(y);
    for (int x = 0; x < kFftSize; ++x) {
      if (x == 0 && y == 0) {
        continue;
      }
      const int fx = WrappedFrequency(x);
      const ComplexQ15 bin = spectrum[(y * kFftSize) + x];
      const uint64_t magnitude =
          static_cast<uint64_t>(std::abs(bin.real)) +
          static_cast<uint64_t>(std::abs(bin.imag));
      totalEnergy += magnitude;
      if (fx >= 10 || fy >= 10) {
        highEnergy += magnitude;
      }
      if ((fx >= 12 && fy <= 3) || (fy >= 12 && fx <= 3)) {
        moireEnergy += magnitude;
      }
    }
  }

  const uint32_t highRatioQ10 =
      static_cast<uint32_t>((highEnergy * 1024U) / totalEnergy);
  const uint32_t moireRatioQ10 =
      static_cast<uint32_t>((moireEnergy * 1024U) / totalEnergy);
  const uint32_t thresholdQ10 =
      static_cast<uint32_t>(std::max(0.0f, threshold) * 1024.0f);
  return {
      highRatioQ10 > thresholdQ10 || moireRatioQ10 > (thresholdQ10 / 2U),
      highRatioQ10,
      moireRatioQ10,
  };
}

bool IsSpoof(const uint8_t* grayImage, int width, int height, float threshold) {
  return AnalyzeFaceCropFixed(grayImage, width, height, width, threshold)
      .spoofDetected;
}

bool IsSpoofFixed(const uint8_t* grayImage,
                  int width,
                  int height,
                  float threshold) {
  return AnalyzeFaceCropFixed(grayImage, width, height, width, threshold)
      .spoofDetected;
}
}  // namespace antispoof
