const path = require('path');
const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');

const defaultConfig = getDefaultConfig(__dirname);

module.exports = mergeConfig(defaultConfig, {
  resolver: {
    assetExts: [...defaultConfig.resolver.assetExts, 'tflite', 'onnx'],
  },
  watchFolders: [path.resolve(__dirname, 'cpp'), path.resolve(__dirname, 'models')],
});
