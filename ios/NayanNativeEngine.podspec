Pod::Spec.new do |s|
  s.name = 'NayanNativeEngine'
  s.version = '0.0.1'
  s.summary = 'Shared C++ native engine used by the Nayan React Native shells.'
  s.homepage = 'https://example.invalid/nayan'
  s.license = { :type => 'MIT' }
  s.author = { 'Nayan' => 'native@nayan.invalid' }
  s.platforms = { :ios => min_ios_version_supported }
  s.source = { :path => '..' }

  s.requires_arc = false
  s.pod_target_xcconfig = {
    'CLANG_CXX_LANGUAGE_STANDARD' => 'c++17',
    'CLANG_CXX_LIBRARY' => 'libc++',
    'HEADER_SEARCH_PATHS' => [
      '$(inherited)',
      '"${PODS_TARGET_SRCROOT}/../cpp"',
      '"${PODS_TARGET_SRCROOT}/../cpp/antispoof"',
      '"${PODS_TARGET_SRCROOT}/../cpp/clahe"',
      '"${PODS_TARGET_SRCROOT}/../cpp/common"',
      '"${PODS_TARGET_SRCROOT}/../cpp/crypto"',
      '"${PODS_TARGET_SRCROOT}/../cpp/frame-processor"',
      '"${PODS_TARGET_SRCROOT}/../cpp/inference"',
      '"${PODS_TARGET_SRCROOT}/../cpp/landmarks"',
      '"${PODS_ROOT}/Headers/Public/React-jsi"'
    ].join(' ')
  }

  s.source_files = [
    '../cpp/common/MathUtils.cpp',
    '../cpp/clahe/AdaptiveClipController.cpp',
    '../cpp/clahe/CLAHEEngine.cpp',
    '../cpp/frame-processor/FrameProcessorPlugin.cpp',
    '../cpp/frame-processor/JSIHostObject.cpp',
    '../cpp/frame-processor/PixelBufferPool.cpp',
    '../cpp/inference/EmbeddingAverager.cpp',
    '../cpp/inference/TFLiteInterpreterManager.cpp'
  ]

  s.dependency 'React-Core'
  s.dependency 'React-jsi'
end
