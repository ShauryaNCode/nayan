#include "PixelBufferPool.h"

#include <stdexcept>

namespace offlineface::frameprocessor {

PixelBufferPool::PixelBufferPool(std::size_t capacity,
                                 std::size_t bytesPerFrame)
    : storage_(capacity), frames_(capacity), bytesPerFrame_(bytesPerFrame) {
  if (capacity == 0U || bytesPerFrame == 0U) {
    throw std::invalid_argument(
        "PixelBufferPool requires non-zero capacity and bytesPerFrame");
  }

  for (std::size_t i = 0; i < capacity; ++i) {
    storage_[i] = std::make_unique<uint8_t[]>(bytesPerFrame_);
    frames_[i] = std::make_unique<FrameBuffer>();
    frames_[i]->data = storage_[i].get();
    frames_[i]->byteLength = bytesPerFrame_;
  }
}

PixelBufferPool::~PixelBufferPool() {
  for (auto& frame : frames_) {
    if (frame) {
      frame->data = nullptr;
      frame->byteLength = 0;
      frame->refCount.store(0, std::memory_order_release);
    }
  }
}

FrameBuffer* PixelBufferPool::Acquire(uint32_t width,
                                      uint32_t height,
                                      uint32_t stride,
                                      PixelFormat format,
                                      uint64_t timestampNs,
                                      std::size_t requiredBytes) {
  if (requiredBytes > bytesPerFrame_) {
    throw std::runtime_error("Requested frame exceeds pool allocation");
  }

  std::lock_guard<std::mutex> lock(mutex_);
  for (std::size_t attempt = 0; attempt < frames_.size(); ++attempt) {
    const std::size_t slot = (nextIndex_ + attempt) % frames_.size();
    FrameBuffer* frame = frames_[slot].get();
    uint32_t expected = 0U;
    if (!frame->refCount.compare_exchange_strong(
            expected, 1U, std::memory_order_acq_rel, std::memory_order_acquire)) {
      continue;
    }

    nextIndex_ = (slot + 1U) % frames_.size();
    frame->width = width;
    frame->height = height;
    frame->stride = stride;
    frame->format = format;
    frame->timestampNs = timestampNs;
    frame->byteLength = requiredBytes;
    return frame;
  }

  return nullptr;
}

void PixelBufferPool::Release(FrameBuffer* frame) {
  if (frame == nullptr) {
    return;
  }

  uint32_t previous = frame->refCount.load(std::memory_order_acquire);
  while (previous != 0U) {
    if (frame->refCount.compare_exchange_weak(
            previous,
            previous - 1U,
            std::memory_order_acq_rel,
            std::memory_order_acquire)) {
      break;
    }
  }

  if (previous == 1U) {
    std::atomic_thread_fence(std::memory_order_release);
    frame->timestampNs = 0U;
    frame->width = 0U;
    frame->height = 0U;
    frame->stride = 0U;
    frame->byteLength = bytesPerFrame_;
  }
}

std::size_t PixelBufferPool::Capacity() const noexcept {
  return frames_.size();
}

std::size_t PixelBufferPool::BytesPerFrame() const noexcept {
  return bytesPerFrame_;
}

}  // namespace offlineface::frameprocessor
