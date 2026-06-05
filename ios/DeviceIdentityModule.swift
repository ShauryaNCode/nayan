import Foundation
import React
import Security

@objc(DeviceIdentityModule)
final class DeviceIdentityModule: NSObject {
  private static let applicationTag = "com.nayan.device_key_v1"
  private static let spkiP256Header = Data([
    0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2A, 0x86,
    0x48, 0xCE, 0x3D, 0x02, 0x01, 0x06, 0x08, 0x2A,
    0x86, 0x48, 0xCE, 0x3D, 0x03, 0x01, 0x07, 0x03,
    0x42, 0x00,
  ])

  @objc
  static func requiresMainQueueSetup() -> Bool {
    return false
  }

  @objc(getOrCreateDeviceKey:rejecter:)
  func getOrCreateDeviceKey(
    _ resolve: RCTPromiseResolveBlock,
    rejecter reject: RCTPromiseRejectBlock
  ) {
    do {
      let privateKey = try getOrCreatePrivateKey()
      let publicKeyData = try publicKeySubjectPublicKeyInfo(from: privateKey)
      resolve(publicKeyData.base64EncodedString())
    } catch {
      reject("E_DEVICE_KEY", "Failed to get or create device key", error)
    }
  }

  @objc(signDeletionReceipt:resolver:rejecter:)
  func signDeletionReceipt(
    _ receiptJson: String,
    resolver resolve: RCTPromiseResolveBlock,
    rejecter reject: RCTPromiseRejectBlock
  ) {
    do {
      guard !receiptJson.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
        throw makeError("receiptJson must not be empty")
      }

      let privateKey = try getOrCreatePrivateKey()
      let algorithm = SecKeyAlgorithm.ecdsaSignatureMessageX962SHA256

      guard SecKeyIsAlgorithmSupported(privateKey, .sign, algorithm) else {
        throw makeError("ECDSA P-256 SHA-256 signing is unavailable")
      }

      var signatureError: Unmanaged<CFError>?
      guard let signature = SecKeyCreateSignature(
        privateKey,
        algorithm,
        Data(receiptJson.utf8) as CFData,
        &signatureError
      ) as Data? else {
        throw takeError(signatureError) ?? makeError("Failed to sign deletion receipt")
      }

      resolve(signature.base64EncodedString())
    } catch {
      reject("E_DEVICE_RECEIPT_SIGN", "Failed to sign deletion receipt", error)
    }
  }

  private func getOrCreatePrivateKey() throws -> SecKey {
    if let existingKey = try copyExistingPrivateKey() {
      return existingKey
    }

    #if targetEnvironment(simulator)
    return try createPrivateKey(preferSecureEnclave: false)
    #else
    do {
      return try createPrivateKey(preferSecureEnclave: true)
    } catch {
      return try createPrivateKey(preferSecureEnclave: false)
    }
    #endif
  }

  private func copyExistingPrivateKey() throws -> SecKey? {
    var item: CFTypeRef?
    let status = SecItemCopyMatching(existingPrivateKeyQuery() as CFDictionary, &item)

    if status == errSecSuccess {
      return (item as! SecKey)
    }
    if status == errSecItemNotFound {
      return nil
    }

    throw osStatusError(status, message: "Failed to read device key")
  }

  private func createPrivateKey(preferSecureEnclave: Bool) throws -> SecKey {
    var accessControlError: Unmanaged<CFError>?
    guard let accessControl = SecAccessControlCreateWithFlags(
      kCFAllocatorDefault,
      kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
      [.privateKeyUsage],
      &accessControlError
    ) else {
      throw takeError(accessControlError) ?? makeError("Failed to create key access control")
    }

    var attributes: [String: Any] = [
      kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
      kSecAttrKeySizeInBits as String: 256,
      kSecPrivateKeyAttrs as String: [
        kSecAttrIsPermanent as String: true,
        kSecAttrApplicationTag as String: applicationTagData(),
        kSecAttrAccessControl as String: accessControl,
      ],
    ]

    if preferSecureEnclave {
      attributes[kSecAttrTokenID as String] = kSecAttrTokenIDSecureEnclave
    }

    var createError: Unmanaged<CFError>?
    guard let privateKey = SecKeyCreateRandomKey(
      attributes as CFDictionary,
      &createError
    ) else {
      throw takeError(createError) ?? makeError("Failed to create device key")
    }

    return privateKey
  }

  private func publicKeySubjectPublicKeyInfo(from privateKey: SecKey) throws -> Data {
    guard let publicKey = SecKeyCopyPublicKey(privateKey) else {
      throw makeError("Failed to read device public key")
    }

    var publicKeyError: Unmanaged<CFError>?
    guard let rawPublicKey = SecKeyCopyExternalRepresentation(
      publicKey,
      &publicKeyError
    ) as Data? else {
      throw takeError(publicKeyError) ?? makeError("Failed to export device public key")
    }

    return try wrapP256PublicKeyInSubjectPublicKeyInfo(rawPublicKey)
  }

  private func wrapP256PublicKeyInSubjectPublicKeyInfo(_ rawPublicKey: Data) throws -> Data {
    if rawPublicKey.first == 0x30 {
      return rawPublicKey
    }

    guard rawPublicKey.count == 65, rawPublicKey.first == 0x04 else {
      throw makeError("Unexpected P-256 public key format")
    }

    var encoded = Self.spkiP256Header
    encoded.append(rawPublicKey)
    return encoded
  }

  private func existingPrivateKeyQuery() -> [String: Any] {
    return [
      kSecClass as String: kSecClassKey,
      kSecAttrApplicationTag as String: applicationTagData(),
      kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
      kSecReturnRef as String: true,
    ]
  }

  private func applicationTagData() -> Data {
    return Data(Self.applicationTag.utf8)
  }

  private func takeError(_ error: Unmanaged<CFError>?) -> Error? {
    guard let error = error else {
      return nil
    }
    return error.takeRetainedValue() as Error
  }

  private func makeError(_ message: String) -> NSError {
    return NSError(
      domain: "DeviceIdentityModule",
      code: -1,
      userInfo: [NSLocalizedDescriptionKey: message]
    )
  }

  private func osStatusError(_ status: OSStatus, message: String) -> NSError {
    return NSError(
      domain: NSOSStatusErrorDomain,
      code: Int(status),
      userInfo: [NSLocalizedDescriptionKey: "\(message): \(status)"]
    )
  }
}
