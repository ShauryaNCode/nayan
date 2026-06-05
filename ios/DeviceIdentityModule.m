#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(DeviceIdentityModule, NSObject)

RCT_EXTERN_METHOD(getOrCreateDeviceKey:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(signDeletionReceipt:(NSString *)receiptJson
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
