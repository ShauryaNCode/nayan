# nayan

Nayan is a React Native 0.73 application shell for an offline face-authentication workflow. The app uses TypeScript for the React Native layer, Android and iOS native shells, and a shared cross-platform C++ engine compiled through CMake/CocoaPods.

## Current Status

- React Native 0.73.6 is initialized with Hermes enabled.
- Android debug builds and installs successfully.
- Android CMake builds the shared C++ engine and JNI bridge for `armeabi-v7a`, `arm64-v8a`, `x86`, and `x86_64`.
- iOS has a React Native 0.73 Podfile, Xcode project scaffold, and `NayanNativeEngine` podspec.
- New Architecture is currently disabled on Android because the app does not yet generate `libappmodules.so`.
- JSI injection is skipped on x86/x86_64 emulators to avoid emulator-only illegal-instruction crashes. Test the full JSI path on an ARM Android device.

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

## Native Build Layout

Android native build flow:

```text
android/app/build.gradle
  -> android/app/src/main/cpp/CMakeLists.txt
      -> cpp/CMakeLists.txt
          -> nayan::native_engine
      -> offline_face_auth_jni
```

iOS native build flow:

```text
ios/Podfile
  -> ios/NayanNativeEngine.podspec
      -> cpp/{common,clahe,frame-processor,inference}
```

The root CMake target exposes these C++ include areas:

```text
cpp/antispoof
cpp/clahe
cpp/common
cpp/crypto
cpp/frame-processor
cpp/inference
cpp/landmarks
```

Only native sources that are currently valid implementation files are compiled. Placeholder source files remain in place for future implementation work.

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

## Useful Commands

Build Android debug APK:

```powershell
cd C:\Users\th366\Desktop\nayan\android
.\gradlew.bat :app:assembleDebug
```

Install Android debug APK:

```powershell
cd C:\Users\th366\Desktop\nayan\android
.\gradlew.bat :app:installDebug
```

Capture app crash logs:

```powershell
C:\Users\th366\AppData\Local\Android\Sdk\platform-tools\adb.exe logcat -c
C:\Users\th366\AppData\Local\Android\Sdk\platform-tools\adb.exe shell am start -n com.offlinefaceauth/.MainActivity
C:\Users\th366\AppData\Local\Android\Sdk\platform-tools\adb.exe logcat -d -v time | findstr /i "AndroidRuntime FATAL ReactNativeJS SIGSEGV UnsatisfiedLinkError offlinefaceauth"
```

## Important Android Settings

```properties
hermesEnabled=true
newArchEnabled=false
reactNativeArchitectures=armeabi-v7a,arm64-v8a,x86,x86_64
```

New Architecture stays disabled until the app has proper generated New Architecture app modules. Enabling it too early makes RN load `libappmodules.so`, which is not generated yet.
