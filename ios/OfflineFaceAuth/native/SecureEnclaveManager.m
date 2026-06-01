#import "SecureEnclaveManager.h"

#import <React/RCTUtils.h>
#import <Security/Security.h>
#import <TargetConditionals.h>

static NSString *const NayanDatabaseKeyAlias = @"offline_face_auth_db_v1";
static NSString *const NayanKeychainService = @"com.offlinefaceauth.nayan.db-key";

@implementation SecureEnclaveManager

RCT_EXPORT_MODULE();

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

RCT_REMAP_METHOD(generateSecureRandomBase64,
                 generateSecureRandomBase64WithByteLength:(nonnull NSNumber *)byteLength
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  NSInteger length = [byteLength integerValue];
  if (length <= 0 || length > 1024) {
    reject(@"E_SECURE_RANDOM", @"byteLength must be between 1 and 1024", nil);
    return;
  }

  NSMutableData *randomData = [NSMutableData dataWithLength:(NSUInteger)length];
  OSStatus status =
      SecRandomCopyBytes(kSecRandomDefault, randomData.length, randomData.mutableBytes);

  if (status != errSecSuccess) {
    reject(@"E_SECURE_RANDOM", @"Failed to generate secure random bytes", nil);
    return;
  }

  resolve([randomData base64EncodedStringWithOptions:0]);
}

RCT_REMAP_METHOD(deriveDatabasePassphrase,
                 deriveDatabasePassphraseWithNonce:(NSString *)nonceBase64
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  if (nonceBase64 == nil || nonceBase64.length == 0) {
    reject(@"E_DB_PASSPHRASE", @"nonceBase64 must not be empty", nil);
    return;
  }

  NSData *nonceData = [[NSData alloc] initWithBase64EncodedString:nonceBase64 options:0];
  if (nonceData == nil || nonceData.length == 0) {
    reject(@"E_DB_PASSPHRASE", @"nonceBase64 is not valid base64", nil);
    return;
  }

  NSError *error = nil;
  BOOL secureEnclaveBacked = NO;
  SecKeyRef privateKey = [self copyOrCreatePrivateKey:&secureEnclaveBacked error:&error];
  if (privateKey == nil) {
    reject(@"E_DB_PASSPHRASE", @"Failed to create database key", error);
    return;
  }

  SecKeyRef publicKey = SecKeyCopyPublicKey(privateKey);
  CFRelease(privateKey);

  if (publicKey == nil) {
    reject(@"E_DB_PASSPHRASE", @"Failed to read database public key", nil);
    return;
  }

  SecKeyAlgorithm algorithm =
      kSecKeyAlgorithmECIESEncryptionCofactorVariableIVX963SHA256AESGCM;
  if (!SecKeyIsAlgorithmSupported(publicKey, kSecKeyOperationTypeEncrypt, algorithm)) {
    CFRelease(publicKey);
    reject(@"E_DB_PASSPHRASE", @"ECIES AES-GCM is unavailable on this device", nil);
    return;
  }

  CFErrorRef cfError = nil;
  CFDataRef encryptedData =
      SecKeyCreateEncryptedData(publicKey, algorithm, (__bridge CFDataRef)nonceData, &cfError);
  CFRelease(publicKey);

  if (encryptedData == nil) {
    NSError *encryptionError = CFBridgingRelease(cfError);
    reject(@"E_DB_PASSPHRASE", @"Failed to derive SQLCipher passphrase", encryptionError);
    return;
  }

  NSData *passphraseEnvelope = CFBridgingRelease(encryptedData);

  resolve(@{
    @"passphrase" : [passphraseEnvelope base64EncodedStringWithOptions:0],
    @"keyAlias" : NayanDatabaseKeyAlias,
    @"provider" : secureEnclaveBacked ? @"ios_secure_enclave" : @"ios_keychain",
    @"envelopeVersion" : @1
  });
}

- (SecKeyRef)copyOrCreatePrivateKey:(BOOL *)secureEnclaveBacked
                              error:(NSError **)error CF_RETURNS_RETAINED
{
  SecKeyRef existingKey = [self copyExistingPrivateKey];
  if (existingKey != nil) {
    if (secureEnclaveBacked != NULL) {
      *secureEnclaveBacked = [self existingKeyUsesSecureEnclave:existingKey];
    }
    return existingKey;
  }

#if TARGET_OS_SIMULATOR
  return [self createKeychainPrivateKey:NO secureEnclaveBacked:secureEnclaveBacked error:error];
#else
  SecKeyRef secureEnclaveKey =
      [self createKeychainPrivateKey:YES secureEnclaveBacked:secureEnclaveBacked error:error];
  if (secureEnclaveKey != nil) {
    return secureEnclaveKey;
  }

  return [self createKeychainPrivateKey:NO secureEnclaveBacked:secureEnclaveBacked error:error];
#endif
}

- (SecKeyRef)copyExistingPrivateKey CF_RETURNS_RETAINED
{
  NSData *tag = [NayanDatabaseKeyAlias dataUsingEncoding:NSUTF8StringEncoding];
  NSDictionary *query = @{
    (__bridge id)kSecClass : (__bridge id)kSecClassKey,
    (__bridge id)kSecAttrApplicationTag : tag,
    (__bridge id)kSecAttrKeyType : (__bridge id)kSecAttrKeyTypeECSECPrimeRandom,
    (__bridge id)kSecReturnRef : @YES
  };

  SecKeyRef privateKey = nil;
  OSStatus status = SecItemCopyMatching((__bridge CFDictionaryRef)query,
                                        (CFTypeRef *)&privateKey);

  return status == errSecSuccess ? privateKey : nil;
}

- (SecKeyRef)createKeychainPrivateKey:(BOOL)preferSecureEnclave
                  secureEnclaveBacked:(BOOL *)secureEnclaveBacked
                                 error:(NSError **)error CF_RETURNS_RETAINED
{
  NSData *tag = [NayanDatabaseKeyAlias dataUsingEncoding:NSUTF8StringEncoding];
  SecAccessControlCreateFlags flags = kSecAccessControlPrivateKeyUsage;
  CFErrorRef accessControlError = nil;
  SecAccessControlRef accessControl =
      SecAccessControlCreateWithFlags(kCFAllocatorDefault,
                                      kSecAttrAccessibleAfterFirstUnlock,
                                      flags,
                                      &accessControlError);

  if (accessControl == nil) {
    if (error != NULL) {
      *error = CFBridgingRelease(accessControlError);
    }
    return nil;
  }

  NSMutableDictionary *attributes = [@{
    (__bridge id)kSecAttrKeyType : (__bridge id)kSecAttrKeyTypeECSECPrimeRandom,
    (__bridge id)kSecAttrKeySizeInBits : @256,
    (__bridge id)kSecPrivateKeyAttrs : @{
      (__bridge id)kSecAttrIsPermanent : @YES,
      (__bridge id)kSecAttrApplicationTag : tag,
      (__bridge id)kSecAttrAccessControl : (__bridge id)accessControl
    }
  } mutableCopy];

  if (preferSecureEnclave) {
    attributes[(__bridge id)kSecAttrTokenID] = (__bridge id)kSecAttrTokenIDSecureEnclave;
  }

  CFErrorRef createError = nil;
  SecKeyRef privateKey =
      SecKeyCreateRandomKey((__bridge CFDictionaryRef)attributes, &createError);
  CFRelease(accessControl);

  if (privateKey == nil) {
    if (error != NULL) {
      *error = CFBridgingRelease(createError);
    }
    if (secureEnclaveBacked != NULL) {
      *secureEnclaveBacked = NO;
    }
    return nil;
  }

  if (secureEnclaveBacked != NULL) {
    *secureEnclaveBacked = preferSecureEnclave;
  }

  return privateKey;
}

- (BOOL)existingKeyUsesSecureEnclave:(SecKeyRef)privateKey
{
  CFDictionaryRef attributes = SecKeyCopyAttributes(privateKey);
  if (attributes == nil) {
    return NO;
  }

  NSDictionary *attributeDictionary = CFBridgingRelease(attributes);
  id tokenId = attributeDictionary[(__bridge id)kSecAttrTokenID];
  return [tokenId isEqual:(__bridge id)kSecAttrTokenIDSecureEnclave];
}

@end
