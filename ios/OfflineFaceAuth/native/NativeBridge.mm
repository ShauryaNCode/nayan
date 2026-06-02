#import "NativeBridge.h"

#import <CoreMedia/CoreMedia.h>
#import <CoreVideo/CoreVideo.h>
#import <React/RCTBridge+Private.h>
#import <React/RCTUtils.h>

#if __has_include(<React/RCTCxxBridge.h>)
#import <React/RCTCxxBridge.h>
#endif

#include <jsi/jsi.h>

#include <memory>
#include <mutex>
#include <string>

#include "clahe/AdaptiveClipController.h"
#include "clahe/CLAHEEngine.h"
#include "frame-processor/FrameProcessorPlugin.h"
#include "frame-processor/JSIHostObject.h"
#include "frame-processor/PixelBufferPool.h"
#include "inference/CentroidCalculator.h"
#include "inference/EmbeddingAverager.h"
#include "inference/TFLiteInterpreterManager.h"

namespace jsi = facebook::jsi;

namespace offlineface::iosbridge {
namespace {

constexpr std::size_t kFramePoolCapacity = 3U;
constexpr std::size_t kMaxGrayFrameBytes = 4096U * 4096U;
constexpr const char* kGlobalModuleName = "__offlineFaceAuth";

std::mutex gPipelineMutex;
std::shared_ptr<offlineface::frameprocessor::PixelBufferPool> gPixelBufferPool;
std::shared_ptr<offlineface::clahe::CLAHEEngine> gClaheEngine;
std::shared_ptr<offlineface::clahe::AdaptiveClipController>
    gAdaptiveClipController;
std::shared_ptr<offlineface::inference::EmbeddingAverager> gEmbeddingAverager;
std::shared_ptr<offlineface::inference::CentroidCalculator> gCentroidCalculator;
std::shared_ptr<offlineface::frameprocessor::FrameProcessorPlugin>
    gFrameProcessorPlugin;

std::shared_ptr<offlineface::frameprocessor::FrameProcessorPlugin>
GetOrCreatePipelineLocked() {
  if (gFrameProcessorPlugin != nullptr) {
    return gFrameProcessorPlugin;
  }

  gPixelBufferPool =
      std::make_shared<offlineface::frameprocessor::PixelBufferPool>(
          kFramePoolCapacity, kMaxGrayFrameBytes);
  gAdaptiveClipController =
      std::make_shared<offlineface::clahe::AdaptiveClipController>();
  gClaheEngine = std::make_shared<offlineface::clahe::CLAHEEngine>();
  gClaheEngine->SetAdaptiveClipController(gAdaptiveClipController.get());
  gEmbeddingAverager =
      std::make_shared<offlineface::inference::EmbeddingAverager>();
  gCentroidCalculator =
      std::make_shared<offlineface::inference::CentroidCalculator>();

  auto interpreterManager =
      std::shared_ptr<offlineface::inference::TFLiteInterpreterManager>(
          &offlineface::inference::TFLiteInterpreterManager::Instance(),
          [](offlineface::inference::TFLiteInterpreterManager*) {});

  gFrameProcessorPlugin =
      std::make_shared<offlineface::frameprocessor::FrameProcessorPlugin>(
          gPixelBufferPool,
          gClaheEngine,
          interpreterManager,
          gEmbeddingAverager);
  return gFrameProcessorPlugin;
}

offlineface::frameprocessor::NativeLivenessState DecodeLivenessState(NSInteger state) {
  using offlineface::frameprocessor::NativeLivenessState;
  switch (state) {
    case 1:
      return NativeLivenessState::kDetected;
    case 2:
      return NativeLivenessState::kChallengeActive;
    case 3:
      return NativeLivenessState::kLivenessPass;
    case 4:
      return NativeLivenessState::kLivenessFail;
    case 0:
    default:
      return NativeLivenessState::kIdle;
  }
}

offlineface::frameprocessor::NativeLivenessChallenge DecodeLivenessChallenge(
    NSInteger challenge) {
  using offlineface::frameprocessor::NativeLivenessChallenge;
  switch (challenge) {
    case 1:
      return NativeLivenessChallenge::kBlink;
    case 2:
      return NativeLivenessChallenge::kSmile;
    case 3:
      return NativeLivenessChallenge::kTurnLeft;
    case 4:
      return NativeLivenessChallenge::kTurnRight;
    case 0:
    default:
      return NativeLivenessChallenge::kNone;
  }
}

offlineface::frameprocessor::ProcessedFrameResult SnapshotLatestResult() {
  std::lock_guard<std::mutex> lock(gPipelineMutex);
  if (gFrameProcessorPlugin == nullptr) {
    return {};
  }
  return gFrameProcessorPlugin->DrainLatestResult();
}

jsi::Function CreateLatestResultFunction(jsi::Runtime& runtime) {
  return jsi::Function::createFromHostFunction(
      runtime,
      jsi::PropNameID::forAscii(runtime, "getLatestResult"),
      0,
      [](jsi::Runtime& rt,
         const jsi::Value&,
         const jsi::Value*,
         size_t) -> jsi::Value {
        auto hostObject = offlineface::frameprocessor::MakeResultHostObject(
            SnapshotLatestResult());
        return jsi::Value(
            rt, jsi::Object::createFromHostObject(rt, std::move(hostObject)));
      });
}

jsi::Function CreateInitializedFunction(jsi::Runtime& runtime) {
  return jsi::Function::createFromHostFunction(
      runtime,
      jsi::PropNameID::forAscii(runtime, "isInitialized"),
      0,
      [](jsi::Runtime&, const jsi::Value&, const jsi::Value*, size_t)
          -> jsi::Value {
        return jsi::Value(
            offlineface::inference::TFLiteInterpreterManager::Instance()
                .IsInitialized());
      });
}

void InstallJsiBindings(jsi::Runtime& runtime) {
  jsi::Object module(runtime);
  module.setProperty(
      runtime, "getLatestResult", CreateLatestResultFunction(runtime));
  module.setProperty(
      runtime, "isInitialized", CreateInitializedFunction(runtime));
  module.setProperty(
      runtime,
      "setLivenessState",
      jsi::Function::createFromHostFunction(
          runtime,
          jsi::PropNameID::forAscii(runtime, "setLivenessState"),
          1,
          [](jsi::Runtime&, const jsi::Value&, const jsi::Value* args, size_t count)
              -> jsi::Value {
            if (count < 1 || !args[0].isNumber()) {
              return jsi::Value(false);
            }
            std::lock_guard<std::mutex> lock(gPipelineMutex);
            GetOrCreatePipelineLocked()->SetLivenessState(
                DecodeLivenessState(static_cast<NSInteger>(args[0].asNumber())));
            return jsi::Value(true);
          }));
  module.setProperty(
      runtime,
      "setLivenessChallenge",
      jsi::Function::createFromHostFunction(
          runtime,
          jsi::PropNameID::forAscii(runtime, "setLivenessChallenge"),
          1,
          [](jsi::Runtime&, const jsi::Value&, const jsi::Value* args, size_t count)
              -> jsi::Value {
            if (count < 1 || !args[0].isNumber()) {
              return jsi::Value(false);
            }
            std::lock_guard<std::mutex> lock(gPipelineMutex);
            GetOrCreatePipelineLocked()->SetLivenessChallenge(
                DecodeLivenessChallenge(static_cast<NSInteger>(args[0].asNumber())));
            return jsi::Value(true);
          }));
  module.setProperty(runtime, "frameProcessorRegistryReady", jsi::Value(true));
  runtime.global().setProperty(runtime, kGlobalModuleName, std::move(module));
}

bool EnqueuePixelBuffer(CVPixelBufferRef pixelBuffer, uint64_t timestampNs) {
  if (pixelBuffer == nullptr ||
      !offlineface::inference::TFLiteInterpreterManager::Instance()
           .IsInitialized()) {
    return false;
  }

  CVReturn lockResult =
      CVPixelBufferLockBaseAddress(pixelBuffer, kCVPixelBufferLock_ReadOnly);
  if (lockResult != kCVReturnSuccess) {
    return false;
  }

  const size_t width = CVPixelBufferGetWidthOfPlane(pixelBuffer, 0);
  const size_t height = CVPixelBufferGetHeightOfPlane(pixelBuffer, 0);
  const size_t stride = CVPixelBufferGetBytesPerRowOfPlane(pixelBuffer, 0);
  const auto* yPlane =
      static_cast<const uint8_t*>(CVPixelBufferGetBaseAddressOfPlane(pixelBuffer, 0));
  bool accepted = false;
  if (yPlane != nullptr && width > 0 && height > 0 && stride >= width) {
    std::lock_guard<std::mutex> lock(gPipelineMutex);
    accepted = GetOrCreatePipelineLocked()->EnqueueGrayFrame(
        yPlane,
        static_cast<uint32_t>(width),
        static_cast<uint32_t>(height),
        static_cast<uint32_t>(stride),
        timestampNs);
  }

  CVPixelBufferUnlockBaseAddress(pixelBuffer, kCVPixelBufferLock_ReadOnly);
  return accepted;
}

}  // namespace

bool EnqueueSampleBuffer(CMSampleBufferRef sampleBuffer) {
  if (sampleBuffer == nullptr) {
    return false;
  }
  CVImageBufferRef imageBuffer = CMSampleBufferGetImageBuffer(sampleBuffer);
  const CMTime presentationTime =
      CMSampleBufferGetPresentationTimeStamp(sampleBuffer);
  const uint64_t timestampNs =
      static_cast<uint64_t>(CMTimeGetSeconds(presentationTime) * 1000000000.0);
  return EnqueuePixelBuffer(imageBuffer, timestampNs);
}

void InitializePipeline(const std::string& mobileFaceNetPath,
                        const std::string& faceMeshPath) {
  offlineface::inference::TFLiteInterpreterManager::Instance().Initialize(
      mobileFaceNetPath, faceMeshPath);
  std::lock_guard<std::mutex> lock(gPipelineMutex);
  GetOrCreatePipelineLocked();
}

void SetLivenessStateCode(NSInteger state) {
  std::lock_guard<std::mutex> lock(gPipelineMutex);
  GetOrCreatePipelineLocked()->SetLivenessState(DecodeLivenessState(state));
}

void SetLivenessChallengeCode(NSInteger challenge) {
  std::lock_guard<std::mutex> lock(gPipelineMutex);
  GetOrCreatePipelineLocked()->SetLivenessChallenge(
      DecodeLivenessChallenge(challenge));
}

void InstallJSI(jsi::Runtime& runtime) {
  InstallJsiBindings(runtime);
}

}  // namespace offlineface::iosbridge

@implementation NativeBridge

RCT_EXPORT_MODULE()

@synthesize bridge = _bridge;

+ (BOOL)requiresMainQueueSetup {
  return YES;
}

RCT_EXPORT_METHOD(initializeEngine
                  : (NSString*)modelPath resolve
                  : (RCTPromiseResolveBlock)resolve reject
                  : (RCTPromiseRejectBlock)reject) {
  @try {
    NSString* mobilePath = [self resolveModelPath:modelPath
                                      defaultName:@"mobilefacenet"
                                        extension:@"tflite"
                                      subdirectory:@"mobilefacenet"];
    NSString* faceMeshPath = [self resolveModelPath:nil
                                        defaultName:@"face_landmark"
                                          extension:@"tflite"
                                        subdirectory:@"facemesh"];
    offlineface::iosbridge::InitializePipeline(
        std::string([mobilePath UTF8String]),
        std::string([faceMeshPath UTF8String]));
    resolve(nil);
  } @catch (NSException* exception) {
    reject(@"E_NATIVE_INITIALIZE", exception.reason, nil);
  }
}

RCT_EXPORT_METHOD(ensureJsiInstalled
                  : (RCTPromiseResolveBlock)resolve reject
                  : (RCTPromiseRejectBlock)reject) {
  @try {
#if __has_include(<React/RCTCxxBridge.h>)
    RCTCxxBridge* cxxBridge = (RCTCxxBridge*)self.bridge;
    if (![cxxBridge isKindOfClass:[RCTCxxBridge class]] ||
        cxxBridge.runtime == nullptr) {
      resolve(@NO);
      return;
    }
    offlineface::iosbridge::InstallJSI(*static_cast<jsi::Runtime*>(cxxBridge.runtime));
    resolve(@YES);
#else
    resolve(@NO);
#endif
  } @catch (NSException* exception) {
    reject(@"E_NATIVE_INSTALL_JSI", exception.reason, nil);
  }
}

RCT_EXPORT_METHOD(setLivenessState
                  : (NSString*)state resolve
                  : (RCTPromiseResolveBlock)resolve reject
                  : (RCTPromiseRejectBlock)reject) {
  NSDictionary<NSString*, NSNumber*>* states = @{
    @"IDLE" : @0,
    @"DETECTED" : @1,
    @"CHALLENGE_ACTIVE" : @2,
    @"LIVENESS_PASS" : @3,
    @"LIVENESS_FAIL" : @4,
  };
  offlineface::iosbridge::SetLivenessStateCode(states[state].integerValue);
  resolve(nil);
}

RCT_EXPORT_METHOD(setLivenessChallenge
                  : (NSString*)challenge resolve
                  : (RCTPromiseResolveBlock)resolve reject
                  : (RCTPromiseRejectBlock)reject) {
  NSDictionary<NSString*, NSNumber*>* challenges = @{
    @"NONE" : @0,
    @"BLINK" : @1,
    @"SMILE" : @2,
    @"TURN_LEFT" : @3,
    @"TURN_RIGHT" : @4,
  };
  offlineface::iosbridge::SetLivenessChallengeCode(challenges[challenge].integerValue);
  resolve(nil);
}

RCT_EXPORT_METHOD(setLivenessPassed
                  : (BOOL)passed resolve
                  : (RCTPromiseResolveBlock)resolve reject
                  : (RCTPromiseRejectBlock)reject) {
  offlineface::iosbridge::SetLivenessStateCode(passed ? 3 : 2);
  resolve(nil);
}

- (NSString*)resolveModelPath:(NSString*)requestedPath
                  defaultName:(NSString*)defaultName
                    extension:(NSString*)extension
                  subdirectory:(NSString*)subdirectory {
  if (requestedPath.length > 0 &&
      [[NSFileManager defaultManager] fileExistsAtPath:requestedPath]) {
    return requestedPath;
  }

  NSString* bundled = [[NSBundle mainBundle] pathForResource:defaultName
                                                      ofType:extension
                                                 inDirectory:subdirectory];
  if (bundled.length > 0) {
    return bundled;
  }

  NSString* flatBundled = [[NSBundle mainBundle] pathForResource:defaultName
                                                          ofType:extension];
  if (flatBundled.length > 0) {
    return flatBundled;
  }

  @throw [NSException exceptionWithName:@"MissingModel"
                                 reason:[NSString stringWithFormat:@"Missing %@.%@",
                                                                  defaultName,
                                                                  extension]
                               userInfo:nil];
}

@end
