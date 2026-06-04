#import <CoreMedia/CoreMedia.h>
#import <Foundation/Foundation.h>

#if __has_include(<VisionCamera/FrameProcessorPlugin.h>)
#import <VisionCamera/FrameProcessorPlugin.h>
#import <VisionCamera/FrameProcessorPluginRegistry.h>
#else
#import "FrameProcessorPlugin.h"
#import "FrameProcessorPluginRegistry.h"
#endif

namespace offlineface::iosbridge {
bool EnqueueSampleBuffer(CMSampleBufferRef sampleBuffer);
}

@interface NayanFrameProcessorPlugin : FrameProcessorPlugin
@end

@implementation NayanFrameProcessorPlugin

- (id _Nullable)callback:(Frame*)frame withArguments:(NSDictionary* _Nullable)arguments {
  if (frame == nil || !frame.isValid) {
    return @NO;
  }
  return offlineface::iosbridge::EnqueueSampleBuffer(frame.buffer) ? @YES : @NO;
}

VISION_EXPORT_FRAME_PROCESSOR(NayanFrameProcessorPlugin, nayanFaceAuth)

@end
