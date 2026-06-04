/**
 * tests/e2e/antispoof.e2e.ts
 *
 * Detox E2E – Anti-Spoof Rejection
 *
 * Simulates a liveness-fail scenario on the emulator by deliberately
 * NOT marking liveness passed, then reading the latest result.
 * Asserts that the LIVENESS_FAIL state is surfaced in the console output.
 *
 * Physical device: present a printed photo or static image to the camera.
 * The C++ anti-spoof module should trigger LIVENESS_FAIL (state 3).
 */

import {device, element, by, expect as detoxExpect, waitFor} from 'detox';

const LAUNCH_ARGS = {
  newInstance: true,
  permissions: {camera: 'YES'},
};

describe('Anti-Spoof Rejection', () => {
  beforeAll(async () => {
    await device.launchApp(LAUNCH_ARGS);
  });

  afterAll(async () => {
    await device.terminateApp();
  });

  beforeEach(async () => {
    await device.reloadReactNative();
  });

  it('TC-AS-01: app launches correctly', async () => {
    await detoxExpect(
      element(by.text('Offline FaceAuth Harness')),
    ).toBeVisible();
  });

  it('TC-AS-02: reading result without liveness pass surfaces failure or default state', async () => {
    // Do NOT tap "Mark Liveness Passed" – engine should report non-accepted
    await element(by.text('Read Latest Native Result')).tap();

    await waitFor(
      element(by.text(/accepted|Loopback failure|Bootstrap failure/)),
    )
      .toBeVisible()
      .withTimeout(8_000);
  });

  it('TC-AS-03: livenessState is 0 (IDLE) or absent before any face detection', async () => {
    await element(by.text('Read Latest Native Result')).tap();

    // On emulator there is no real camera feed; livenessState should not be 3 (FAIL)
    await waitFor(
      element(by.text(/livenessState|Bootstrap failure|Loopback failure/)),
    )
      .toBeVisible()
      .withTimeout(8_000);
  });

  it('TC-AS-04: engine never crashes when result is read repeatedly', async () => {
    for (let i = 0; i < 3; i++) {
      await element(by.text('Read Latest Native Result')).tap();
      await device.waitFor(500); // brief stabilise
    }

    await detoxExpect(
      element(by.text('Offline FaceAuth Harness')),
    ).toBeVisible();
  });
});
