#pragma once
#include <atomic>
#include <cstddef>
#include <cstdint>
#include <memory>
#include <mutex>
#include <vector>
namespace offlineface::frameprocessor {
enum class PixelFormat : uint8_t { kGray8 = 0, kRgb24 = 1, kRgba32 = 2, kNv12YPlane = 3, kYuv420Luma = 4 };
struct FrameBuffer { uint32_t width{0}; uint32_t height{0}; uint32_t stride{0}; PixelFormat format{PixelFormat::kGray8}; uint64_t timestampNs{0}; std::size_t byteLength{0}; uint8_t* data{nullptr}; std::atomic<uint32_t> refCount{0}; };
class PixelBufferPool {
 public:
  PixelBufferPool(std::size_t capacity, std::size_t bytesPerFrame);
  ~PixelBufferPool();
  PixelBufferPool(const PixelBufferPool&) = delete;
  PixelBufferPool& operator=(const PixelBufferPool&) = delete;
  FrameBuffer* Acquire(uint32_t width, uint32_t height, uint32_t stride, PixelFormat format, uint64_t timestampNs, std::size_t requiredBytes);
  void Release(FrameBuffer* frame);
  std::size_t Capacity() const noexcept;
  std::size_t BytesPerFrame() const noexcept;
 private:
  std::vector<std::unique_ptr<uint8_t[]>> storage_;
  std::vector<std::unique_ptr<FrameBuffer>> frames_;
  std::mutex mutex_;
  std::size_t nextIndex_{0};
  std::size_t bytesPerFrame_{0};
};
}
