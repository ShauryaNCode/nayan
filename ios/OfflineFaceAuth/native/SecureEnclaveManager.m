#import "SecureEnclaveManager.h"

#import <React/RCTUtils.h>
#import <Security/Security.h>
#import <TargetConditionals.h>

static NSString *const NayanDatabaseKeyAlias = @"offline_face_auth_db_v1";
static NSString *const NayanKeychainService = @"com.offlinefaceauth.nayan.db-key";
static NSString *const NayanPersonKeyAliasPrefix = @"face_embed_key_";

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

RCT_REMAP_METHOD(generatePersonKey,
                 generatePersonKeyWithPersonnelId:(NSString *)personnelId
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  NSString *alias = [self personKeyAliasForPersonnelId:personnelId];
  if (alias == nil) {
    reject(@"E_PERSON_KEY_GENERATE", @"personnelId must not be empty", nil);
    return;
  }

  SecKeyRef existingKey = [self copyExistingPrivateKeyForAlias:alias];
  if (existingKey != nil) {
    CFRelease(existingKey);
    reject(@"E_PERSON_KEY_GENERATE", @"Person key already exists", nil);
    return;
  }

  NSError *error = nil;
  BOOL secureEnclaveBacked = NO;
  SecKeyRef privateKey =
      [self copyOrCreatePrivateKeyForAlias:alias
                       secureEnclaveBacked:&secureEnclaveBacked
                                      error:&error];

  if (privateKey == nil) {
    reject(@"E_PERSON_KEY_GENERATE", @"Failed to create person key", error);
    return;
  }

  CFRelease(privateKey);
  resolve(@YES);
}

RCT_REMAP_METHOD(deletePersonKey,
                 deletePersonKeyWithPersonnelId:(NSString *)personnelId
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  NSString *alias = [self personKeyAliasForPersonnelId:personnelId];
  if (alias == nil) {
    reject(@"E_PERSON_KEY_DELETE", @"personnelId must not be empty", nil);
    return;
  }

  NSData *tag = [alias dataUsingEncoding:NSUTF8StringEncoding];
  NSDictionary *query = @{
    (__bridge id)kSecClass : (__bridge id)kSecClassKey,
    (__bridge id)kSecAttrApplicationTag : tag,
    (__bridge id)kSecAttrKeyType : (__bridge id)kSecAttrKeyTypeECSECPrimeRandom
  };

  OSStatus status = SecItemDelete((__bridge CFDictionaryRef)query);
  if (status == errSecSuccess || status == errSecItemNotFound) {
    resolve(@(status == errSecSuccess));
    return;
  }

  NSError *error = [NSError errorWithDomain:NSOSStatusErrorDomain code:status userInfo:nil];
  reject(@"E_PERSON_KEY_DELETE", @"Failed to delete person key", error);
}

RCT_REMAP_METHOD(wrapDEK,
                 wrapDEKWithPersonnelId:(NSString *)personnelId
                 dekHex:(NSString *)dekHex
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  NSString *alias = [self personKeyAliasForPersonnelId:personnelId];
  if (alias == nil) {
    reject(@"E_PERSON_DEK_WRAP", @"personnelId must not be empty", nil);
    return;
  }

  NSData *dekData = [self dataFromHexString:dekHex];
  if (dekData == nil || dekData.length != 32) {
    reject(@"E_PERSON_DEK_WRAP", @"dekHex must contain exactly 32 bytes", nil);
    return;
  }

  SecKeyRef privateKey = [self copyExistingPrivateKeyForAlias:alias];
  if (privateKey == nil) {
    reject(@"E_PERSON_DEK_WRAP", @"No person key exists", nil);
    return;
  }

  SecKeyRef publicKey = SecKeyCopyPublicKey(privateKey);
  CFRelease(privateKey);

  if (publicKey == nil) {
    reject(@"E_PERSON_DEK_WRAP", @"Failed to read person public key", nil);
    return;
  }

  SecKeyAlgorithm algorithm =
      kSecKeyAlgorithmECIESEncryptionCofactorVariableIVX963SHA256AESGCM;
  if (!SecKeyIsAlgorithmSupported(publicKey, kSecKeyOperationTypeEncrypt, algorithm)) {
    CFRelease(publicKey);
    reject(@"E_PERSON_DEK_WRAP", @"ECIES AES-GCM is unavailable on this device", nil);
    return;
  }

  CFErrorRef cfError = nil;
  CFDataRef encryptedData =
      SecKeyCreateEncryptedData(publicKey, algorithm, (__bridge CFDataRef)dekData, &cfError);
  CFRelease(publicKey);

  if (encryptedData == nil) {
    NSError *error = CFBridgingRelease(cfError);
    reject(@"E_PERSON_DEK_WRAP", @"Failed to wrap DEK", error);
    return;
  }

  NSData *wrappedData = CFBridgingRelease(encryptedData);
  resolve([wrappedData base64EncodedStringWithOptions:0]);
}

RCT_REMAP_METHOD(unwrapDEK,
                 unwrapDEKWithPersonnelId:(NSString *)personnelId
                 wrappedDEKBase64:(NSString *)wrappedDEKBase64
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  NSString *alias = [self personKeyAliasForPersonnelId:personnelId];
  if (alias == nil) {
    reject(@"E_PERSON_DEK_UNWRAP", @"personnelId must not be empty", nil);
    return;
  }

  NSData *wrappedData =
      [[NSData alloc] initWithBase64EncodedString:wrappedDEKBase64 options:0];
  if (wrappedData == nil || wrappedData.length == 0) {
    reject(@"E_PERSON_DEK_UNWRAP", @"wrappedDEKBase64 is not valid base64", nil);
    return;
  }

  SecKeyRef privateKey = [self copyExistingPrivateKeyForAlias:alias];
  if (privateKey == nil) {
    reject(@"E_PERSON_DEK_UNWRAP", @"No person key exists", nil);
    return;
  }

  SecKeyAlgorithm algorithm =
      kSecKeyAlgorithmECIESEncryptionCofactorVariableIVX963SHA256AESGCM;
  if (!SecKeyIsAlgorithmSupported(privateKey, kSecKeyOperationTypeDecrypt, algorithm)) {
    CFRelease(privateKey);
    reject(@"E_PERSON_DEK_UNWRAP", @"ECIES AES-GCM is unavailable on this device", nil);
    return;
  }

  CFErrorRef cfError = nil;
  CFDataRef decryptedData =
      SecKeyCreateDecryptedData(privateKey,
                                algorithm,
                                (__bridge CFDataRef)wrappedData,
                                &cfError);
  CFRelease(privateKey);

  if (decryptedData == nil) {
    NSError *error = CFBridgingRelease(cfError);
    reject(@"E_PERSON_DEK_UNWRAP", @"Failed to unwrap DEK", error);
    return;
  }

  NSData *dekData = CFBridgingRelease(decryptedData);
  if (dekData.length != 32) {
    reject(@"E_PERSON_DEK_UNWRAP", @"Unwrapped DEK is not 32 bytes", nil);
    return;
  }

  resolve([self hexStringFromData:dekData]);
}

- (SecKeyRef)copyOrCreatePrivateKey:(BOOL *)secureEnclaveBacked
                              error:(NSError **)error CF_RETURNS_RETAINED
{
  return [self copyOrCreatePrivateKeyForAlias:NayanDatabaseKeyAlias
                          secureEnclaveBacked:secureEnclaveBacked
                                         error:error];
}

- (SecKeyRef)copyOrCreatePrivateKeyForAlias:(NSString *)alias
                       secureEnclaveBacked:(BOOL *)secureEnclaveBacked
                                      error:(NSError **)error CF_RETURNS_RETAINED
{
  SecKeyRef existingKey = [self copyExistingPrivateKeyForAlias:alias];
  if (existingKey != nil) {
    if (secureEnclaveBacked != NULL) {
      *secureEnclaveBacked = [self existingKeyUsesSecureEnclave:existingKey];
    }
    return existingKey;
  }

#if TARGET_OS_SIMULATOR
  return [self createKeychainPrivateKeyForAlias:alias
                            preferSecureEnclave:NO
                           secureEnclaveBacked:secureEnclaveBacked
                                          error:error];
#else
  SecKeyRef secureEnclaveKey =
      [self createKeychainPrivateKeyForAlias:alias
                         preferSecureEnclave:YES
                        secureEnclaveBacked:secureEnclaveBacked
                                       error:error];
  if (secureEnclaveKey != nil) {
    return secureEnclaveKey;
  }

  return [self createKeychainPrivateKeyForAlias:alias
                            preferSecureEnclave:NO
                           secureEnclaveBacked:secureEnclaveBacked
                                          error:error];
#endif
}

- (SecKeyRef)copyExistingPrivateKey CF_RETURNS_RETAINED
{
  return [self copyExistingPrivateKeyForAlias:NayanDatabaseKeyAlias];
}

- (SecKeyRef)copyExistingPrivateKeyForAlias:(NSString *)alias CF_RETURNS_RETAINED
{
  NSData *tag = [alias dataUsingEncoding:NSUTF8StringEncoding];
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
  return [self createKeychainPrivateKeyForAlias:NayanDatabaseKeyAlias
                            preferSecureEnclave:preferSecureEnclave
                           secureEnclaveBacked:secureEnclaveBacked
                                          error:error];
}

- (SecKeyRef)createKeychainPrivateKeyForAlias:(NSString *)alias
                          preferSecureEnclave:(BOOL)preferSecureEnclave
                         secureEnclaveBacked:(BOOL *)secureEnclaveBacked
                                        error:(NSError **)error CF_RETURNS_RETAINED
{
  NSData *tag = [alias dataUsingEncoding:NSUTF8StringEncoding];
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

- (NSString *)personKeyAliasForPersonnelId:(NSString *)personnelId
{
  if (personnelId == nil || personnelId.length == 0) {
    return nil;
  }
  NSString *trimmed =
      [personnelId stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
  if (trimmed.length == 0) {
    return nil;
  }
  return [NayanPersonKeyAliasPrefix stringByAppendingString:trimmed];
}

- (NSData *)dataFromHexString:(NSString *)hexString
{
  if (hexString == nil || hexString.length % 2 != 0) {
    return nil;
  }

  NSMutableData *data = [NSMutableData dataWithCapacity:hexString.length / 2];
  for (NSUInteger index = 0; index < hexString.length; index += 2) {
    NSString *byteString = [hexString substringWithRange:NSMakeRange(index, 2)];
    unsigned int byteValue = 0;
    NSScanner *scanner = [NSScanner scannerWithString:byteString];
    if (![scanner scanHexInt:&byteValue] || byteValue > 0xff) {
      return nil;
    }
    uint8_t byte = (uint8_t)byteValue;
    [data appendBytes:&byte length:1];
  }
  return data;
}

- (NSString *)hexStringFromData:(NSData *)data
{
  const unsigned char *bytes = (const unsigned char *)data.bytes;
  NSMutableString *hexString = [NSMutableString stringWithCapacity:data.length * 2];
  for (NSUInteger index = 0; index < data.length; index += 1) {
    [hexString appendFormat:@"%02x", bytes[index]];
  }
  return hexString;
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
