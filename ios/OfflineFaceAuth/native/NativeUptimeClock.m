#import <Foundation/Foundation.h>
#import <React/RCTBridgeModule.h>
#import <mach/mach_time.h>

@interface NativeUptimeClock : NSObject <RCTBridgeModule>
@end

@implementation NativeUptimeClock

RCT_EXPORT_MODULE();

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

RCT_REMAP_METHOD(getUptimeMs,
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  mach_timebase_info_data_t info;
  kern_return_t status = mach_timebase_info(&info);
  if (status != KERN_SUCCESS || info.denom == 0) {
    reject(@"E_UPTIME_CLOCK", @"mach_timebase_info failed", nil);
    return;
  }

  uint64_t ticks = 0;
  if (@available(iOS 10.0, *)) {
    ticks = mach_continuous_time();
  } else {
    ticks = mach_absolute_time();
  }

  uint64_t nanos = ticks * (uint64_t)info.numer / (uint64_t)info.denom;
  resolve(@(nanos / 1000000ULL));
}

@end
