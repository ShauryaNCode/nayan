#pragma once

#include <array>
#include <cstddef>
#include <cstdint>
#include <memory>
#include <string>
#include <vector>

namespace offlineface::landmarks {

struct Landmark3D {
  float x{0.0f};
  float y{0.0f};
  float z{0.0f};
};

using FaceLandmarks = std::array<Landmark3D, 468>;

struct FaceMetrics {
  float ear{0.0f};
  float mar{0.0f};
  float yaw{0.0f};
  float pitch{0.0f};
  float roll{0.0f};
  bool faceDetected{false};
};

struct ImageFrame {
  const uint8_t* pixels{nullptr};
  uint32_t width{0};
  uint32_t height{0};
  uint32_t stride{0};
  uint8_t channels{3};
};

struct CameraIntrinsics {
  float fx{0.0f};
  float fy{0.0f};
  float cx{0.0f};
  float cy{0.0f};
};

struct HeadPose {
  float yaw{0.0f};
  float pitch{0.0f};
  float roll{0.0f};
  bool valid{false};
};

class FaceMeshEngine {
 public:
  FaceMeshEngine();
  ~FaceMeshEngine();

  FaceMeshEngine(const FaceMeshEngine&) = delete;
  FaceMeshEngine& operator=(const FaceMeshEngine&) = delete;
  FaceMeshEngine(FaceMeshEngine&&) noexcept;
  FaceMeshEngine& operator=(FaceMeshEngine&&) noexcept;

  bool LoadModel(const std::string& modelPath);
  bool IsReady() const;
  std::string LastError() const;

  FaceMetrics Run(const ImageFrame& frame);
  FaceMetrics ComputeFromLandmarks(const FaceLandmarks& landmarks,
                                   uint32_t frameWidth,
                                   uint32_t frameHeight) const;

  static FaceLandmarks ParseLandmarks(const float* values,
                                      std::size_t valueCount);
  static FaceMetrics ComputeMetrics(const FaceLandmarks& landmarks,
                                    uint32_t frameWidth,
                                    uint32_t frameHeight);
  static float ComputeEAR(const FaceLandmarks& landmarks);
  static float ComputeMAR(const FaceLandmarks& landmarks);
  static HeadPose EstimateHeadPose(const FaceLandmarks& landmarks,
                                   uint32_t frameWidth,
                                   uint32_t frameHeight);

 private:
  class Impl;
  std::unique_ptr<Impl> impl_;
};

}  // namespace offlineface::landmarks
