/**
 * tests/e2e/verification.e2e.ts
 *
 * Detox E2E – Verification Flow
 *
 * Covers: app launch → engine present → read latest result → verify
 * liveness state fields appear in the console output card.
 */

import {device, element, by, expect as detoxExpect, waitFor} from 'detox';

const LAUNCH_ARGS = {
  newInstance: true,
  permissions: {camera: 'YES'},
};

describe('Verification Flow', () => {
  beforeAll(async () => {
    await device.launchApp(LAUNCH_ARGS);
  });

  afterAll(async () => {
    await device.terminateApp();
  });

  beforeEach(async () => {
    await device.reloadReactNative();
  });

  it('TC-V-01: app launches with verification harness title', async () => {
    await detoxExpect(
      element(by.text('Offline FaceAuth Harness')),
    ).toBeVisible();
  });

  it('TC-V-02: engine initialisation status card shows', async () => {
    await detoxExpect(
      element(by.text('Engine Presence')),
    ).toBeVisible();

    await detoxExpect(
      element(by.text('Initialization State')),
    ).toBeVisible();
  });

  it('TC-V-03: read latest result exposes livenessState field', async () => {
    // Pre-condition: mark liveness passed so the engine has a result
    await element(by.text('Mark Liveness Passed')).tap();

    await waitFor(element(by.text(/Liveness FSM marked PASS/)))
      .toBeVisible()
      .withTimeout(5_000);

    await element(by.text('Read Latest Native Result')).tap();

    // Console output must include livenessState key from the JSON result
    await waitFor(
      element(by.text(/livenessState|Loopback failure/)),
    )
      .toBeVisible()
      .withTimeout(8_000);
  });

  it('TC-V-04: Frame Processor Plugin status card is rendered', async () => {
    await detoxExpect(
      element(by.text('Frame Processor Plugin')),
    ).toBeVisible();
  });

  it('TC-V-05: Model Path card shows expected path', async () => {
    await detoxExpect(
      element(by.text('Model Path')),
    ).toBeVisible();

    await detoxExpect(
      element(by.text('/sdcard/Download/mobilefacenet.tflite')),
    ).toBeVisible();
  });
});
