# NAYAN 
Nayan is a React Native 0.73 application shell for an offline face-authentication workflow. The app uses TypeScript for the React Native layer, Android and iOS native shells, and a shared cross-platform C++ engine compiled through CMake/CocoaPods.
---
<img width="2087" height="1169" alt="image" src="https://github.com/user-attachments/assets/6162a510-7506-443f-8e36-c54207d19c0f" />

## Android Run

Start Metro:

```powershell
cd C:\Users\th366\Desktop\nayan
npx react-native start --reset-cache
```

Install and run the debug app:

```powershell
cd C:\Users\th366\Desktop\nayan\android
.\gradlew.bat :app:installDebug
```

Or use the React Native CLI from the project root:

```powershell
npx react-native run-android
```

If the emulator reports insufficient storage, wipe emulator data from Android Studio Device Manager and reinstall.

## iOS Run

iOS must be built on macOS with Xcode and CocoaPods:

```bash
cd ios
pod install
cd ..
npx react-native run-ios
```

The iOS shell is scaffolded, but has not been verified from this Windows workspace.

## Emulator Notes

On x86/x86_64 Android emulators, the app intentionally skips native JSI global injection. The UI can show:

```text
Engine Presence: Missing
Initialization State: Not initialized
```

That is expected on the emulator-safe path. The React Native app still runs, and the JNI/CMake build is packaged. Use a real ARM Android device to validate the full native JSI bridge and frame-processor path.

<img width="2089" height="1175" alt="image" src="https://github.com/user-attachments/assets/90fb8590-2d19-400b-b542-630cc6d2154c" />


## Project Structure

```text
nayan/
|-- android/                         # Android React Native shell
|   |-- build.gradle                  # Root Android Gradle config
|   |-- gradle.properties             # Hermes/New Architecture/ABI config
|   |-- settings.gradle               # RN Gradle plugin + app include
|   |-- gradlew
|   |-- gradlew.bat
|   `-- app/
|       |-- build.gradle              # App Gradle, NDK, CMake, RN config
|       |-- proguard-rules.pro
|       `-- src/main/
|           |-- AndroidManifest.xml
|           |-- cpp/
|           |   |-- CMakeLists.txt    # Links JNI bridge to ../../../../../cpp
|           |   `-- jni_bridge.cpp    # Android JNI/JSI native bridge
|           |-- java/com/offlinefaceauth/
|           |   |-- MainActivity.java
|           |   |-- MainApplication.java
|           |   |-- NativeBridge.java
|           |   |-- NativeBridgePackage.java
|           |   `-- keystore/
|           `-- res/values/
|               |-- strings.xml
|               `-- styles.xml
|
|-- ios/                             # iOS React Native shell
|   |-- Podfile                       # RN 0.73 CocoaPods config
|   |-- NayanNativeEngine.podspec     # Maps shared C++ sources into CocoaPods
|   |-- OfflineFaceAuth.xcodeproj/
|   |-- OfflineFaceAuthTests/
|   `-- OfflineFaceAuth/
|       |-- AppDelegate.h
|       |-- AppDelegate.mm
|       |-- Info.plist
|       |-- LaunchScreen.storyboard
|       |-- main.m
|       |-- Nayan-Bridging-Header.h
|       |-- OfflineFaceAuth.entitlements
|       |-- Images.xcassets/
|       |-- models/
|       `-- native/
|
|-- cpp/                             # Shared cross-platform native engine
|   |-- CMakeLists.txt                # Defines nayan::native_engine
|   |-- antispoof/
|   |-- clahe/
|   |-- common/
|   |-- crypto/
|   |-- frame-processor/
|   |-- inference/
|   `-- landmarks/
|
|-- src/                             # React Native TypeScript app
|   |-- App.tsx                       # Current native harness UI
|   |-- app/
|   |-- components/
|   |-- config/
|   |-- liveness/
|   |-- screens/
|   |-- storage/
|   |-- sync/
|   |-- types/
|   `-- utils/
|
|-- models/                          # Model assets and conversion notes
|-- tests/                           # Unit, integration, e2e, fixtures
|-- docs/                            # Architecture, setup, security, benchmark docs
|-- scripts/                         # Build, lint, benchmark, e2e helper scripts
|-- deploy/                          # AWS, Docker, Fastlane deployment assets
|
|-- app.json                         # RN app name: nayan
|-- babel.config.js
|-- index.js                         # Registers src/App with AppRegistry
|-- metro.config.js                   # Adds model asset extensions and watch folders
|-- package.json
|-- package-lock.json
|-- tsconfig.json
`-- README.md
```

## 👥 Team

| Contributor | Role | Responsibilities |
|------------|------|------------------|
| **[Shaurya Naik](https://github.com/ShauryaNCode)** | Team Lead, Native ML Pipeline Architect & Liveness & UX Systems Engineer | Provide overall project leadership while architecting the native ML pipeline and liveness tracking systems. He develops the C++ frame processor plugin, integrates MobileFaceNet and MediaPipe models, implements image normalization, designs the 5-state liveness FSM, and builds the 60 FPS Skia UI overlay and haptic feedback systems. |
| **[Gaurav Parker](https://github.com/DeltaG06)** | Secure Storage & Crypto Engineer | Secures the application by implementing a SQLCipher encrypted database with per-vector AES-256-GCM encryption. He manages hardware-backed key generation via Keystore and Secure Enclave, builds a blockchain-style SHA-256 transaction ledger with launch integrity checks, and implements an $O(\log N)$ vector index for rapid local face search. |
| **[Gaurang Khanolkar](https://github.com/gaurang0410)** | Sync, Connectivity & Demo Engineer | Manages data synchronization and the demo environment. He builds an atomic offline queue with write-ahead logging, implements NetInfo-driven exponential backoffs, coordinates AWS S3 multipart sync with conflict resolution, secures post-sync data purging, and designs the end-to-end Airplane Mode demo flow alongside performance monitoring UIs and integration tests. |

---
