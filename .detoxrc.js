/** @type {Detox.DetoxConfig} */
module.exports = {
  testRunner: {
    args: {
      $0: 'jest',
      config: 'jest.config.e2e.js',
    },
    jest: {
      setupTimeout: 120000,
    },
  },

  apps: {
    'android.debug': {
      type: 'android.apk',
      binaryPath: 'android/app/build/outputs/apk/debug/app-debug.apk',
      build:
        'cd android && ./gradlew assembleDebug assembleAndroidTest -DtestBuildType=debug',
      reversePorts: [8081],
    },
  },

  devices: {
    'emulator': {
      type: 'android.emulator',
      device: {
        avdName: 'Pixel_7',
      },
    },
    'attached.device': {
      type: 'android.attached',
      device: {
        adbName: '.*', // matches any USB-attached device
      },
    },
  },

  configurations: {
    'android.emu.debug': {
      device: 'emulator',
      app: 'android.debug',
    },
    'android.device.debug': {
      device: 'attached.device',
      app: 'android.debug',
    },
  },
};
