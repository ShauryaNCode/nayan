cmake_minimum_required(VERSION 3.22)

project(nayan_native_engine LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

option(NAYAN_ENABLE_FRAME_PROCESSORS "Build the Nayan JSI/frame processor bridge" ON)
option(NAYAN_BUILD_MOCK_LIVENESS_RUNNER "Build standalone liveness FSM mock runner" OFF)

set(NAYAN_ENGINE_INCLUDE_DIRS
  ${CMAKE_CURRENT_SOURCE_DIR}
  ${CMAKE_CURRENT_SOURCE_DIR}/antispoof
  ${CMAKE_CURRENT_SOURCE_DIR}/clahe
  ${CMAKE_CURRENT_SOURCE_DIR}/common
  ${CMAKE_CURRENT_SOURCE_DIR}/crypto
  ${CMAKE_CURRENT_SOURCE_DIR}/frame-processor
  ${CMAKE_CURRENT_SOURCE_DIR}/inference
  ${CMAKE_CURRENT_SOURCE_DIR}/landmarks
)

set(NAYAN_ENGINE_SOURCES
  ${CMAKE_CURRENT_SOURCE_DIR}/common/MathUtils.cpp
  ${CMAKE_CURRENT_SOURCE_DIR}/antispoof/DepthCueChecker.cpp
  ${CMAKE_CURRENT_SOURCE_DIR}/antispoof/FFTTextureAnalyzer.cpp
  ${CMAKE_CURRENT_SOURCE_DIR}/clahe/AdaptiveClipController.cpp
  ${CMAKE_CURRENT_SOURCE_DIR}/clahe/CLAHEEngine.cpp
  ${CMAKE_CURRENT_SOURCE_DIR}/clahe/ColorSpaceConverter.cpp
  ${CMAKE_CURRENT_SOURCE_DIR}/frame-processor/FrameProcessorPlugin.cpp
  ${CMAKE_CURRENT_SOURCE_DIR}/frame-processor/JSIHostObject.cpp
  ${CMAKE_CURRENT_SOURCE_DIR}/frame-processor/PixelBufferPool.cpp
  ${CMAKE_CURRENT_SOURCE_DIR}/inference/CentroidCalculator.cpp
  ${CMAKE_CURRENT_SOURCE_DIR}/inference/EmbeddingAverager.cpp
  ${CMAKE_CURRENT_SOURCE_DIR}/inference/MobileFaceNetRunner.cpp
  ${CMAKE_CURRENT_SOURCE_DIR}/inference/TFLiteInterpreterManager.cpp
  ${CMAKE_CURRENT_SOURCE_DIR}/landmarks/EARCalculator.cpp
  ${CMAKE_CURRENT_SOURCE_DIR}/landmarks/FaceMeshEngine.cpp
  ${CMAKE_CURRENT_SOURCE_DIR}/landmarks/FaceMeshRunner.cpp
  ${CMAKE_CURRENT_SOURCE_DIR}/landmarks/HeadPoseEstimator.cpp
  ${CMAKE_CURRENT_SOURCE_DIR}/landmarks/LivenessFSM.cpp
  ${CMAKE_CURRENT_SOURCE_DIR}/landmarks/MARCalculator.cpp
)

add_library(nayan_native_engine STATIC ${NAYAN_ENGINE_SOURCES})
add_library(nayan::native_engine ALIAS nayan_native_engine)

target_include_directories(nayan_native_engine
  PUBLIC
    ${NAYAN_ENGINE_INCLUDE_DIRS}
)

target_compile_definitions(nayan_native_engine
  PUBLIC
    NAYAN_ENABLE_FRAME_PROCESSORS=$<BOOL:${NAYAN_ENABLE_FRAME_PROCESSORS}>
)

if(ANDROID)
  find_package(ReactAndroid REQUIRED CONFIG)

  target_link_libraries(nayan_native_engine
    PUBLIC
      ReactAndroid::jsi
      android
      log
  )
elseif(APPLE)
  target_link_libraries(nayan_native_engine
    PUBLIC
      "-framework CoreVideo"
      "-framework Foundation"
  )
endif()

if(ANDROID AND CMAKE_ANDROID_ARCH_ABI STREQUAL "arm64-v8a")
  target_compile_options(nayan_native_engine PRIVATE
    -O3
    -ffast-math
    -fstrict-aliasing
    -funroll-loops
    -march=armv8-a+simd
  )
elseif(ANDROID AND CMAKE_ANDROID_ARCH_ABI STREQUAL "armeabi-v7a")
  target_compile_options(nayan_native_engine PRIVATE
    -O3
    -ffast-math
    -fstrict-aliasing
    -funroll-loops
    -mfpu=neon
    -mfloat-abi=softfp
  )
elseif(CMAKE_SYSTEM_PROCESSOR MATCHES "arm|aarch64|ARM")
  target_compile_options(nayan_native_engine PRIVATE
    -O3
    -ffast-math
    -fstrict-aliasing
    -funroll-loops
  )
else()
  target_compile_options(nayan_native_engine PRIVATE
    -O3
    -ffast-math
    -fstrict-aliasing
  )
endif()

if(NAYAN_BUILD_MOCK_LIVENESS_RUNNER)
  add_executable(mock_liveness_runner
    ${CMAKE_CURRENT_SOURCE_DIR}/landmarks/MockLivenessRunner.cpp
  )

  target_link_libraries(mock_liveness_runner PRIVATE nayan::native_engine)
  target_include_directories(mock_liveness_runner PRIVATE ${NAYAN_ENGINE_INCLUDE_DIRS})
endif()

