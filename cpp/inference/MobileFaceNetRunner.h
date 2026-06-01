#pragma once

#include <cstdint>
#include <mutex>
#include <memory>
#include <string>
#include <vector>

namespace offlineface::inference {

class MobileFaceNetRunner {
 public:
  MobileFaceNetRunner();
  ~MobileFaceNetRunner();
  MobileFaceNetRunner(MobileFaceNetRunner&&) noexcept;
  MobileFaceNetRunner& operator=(MobileFaceNetRunner&&) noexcept;
  MobileFaceNetRunner(const MobileFaceNetRunner&) = delete;
  MobileFaceNetRunner& operator=(const MobileFaceNetRunner&) = delete;

  bool LoadModel(const std::string& modelPath);
  bool IsReady() const;
  std::string LastError() const;

  std::vector<float> Run(const uint8_t* grayPixels,
                         uint32_t width,
                         uint32_t height,
                         uint32_t stride) const;

  const std::string& ModelPath() const;

 private:
  class Impl;
  std::vector<float> RunDeterministicFallback(const uint8_t* grayPixels,
                                              uint32_t width,
                                              uint32_t height,
                                              uint32_t stride) const;

  std::unique_ptr<Impl> impl_;
};

}  // namespace offlineface::inference
