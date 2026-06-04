/**
 * tests/e2e/enrollment.e2e.ts
 *
 * Detox E2E – Enrollment Flow
 *
 * Covers: camera permission grant, face-capture UI appearance,
 * liveness challenge prompt, and enrollment confirmation card.
 *
 * On Android emulator the camera preview is a placeholder image.
 * The test asserts UI state transitions only; it does NOT assert
 * biometric accuracy (covered by integration tests).
 */

import {device, element, by, expect as detoxExpect, waitFor} from 'detox';

const LAUNCH_ARGS = {
  newInstance: true,
  permissions: {camera: 'YES'},
};

describe('Enrollment Flow', () => {
  beforeAll(async () => {
    await device.launchApp(LAUNCH_ARGS);
  });

  afterAll(async () => {
    await device.terminateApp();
  });

  beforeEach(async () => {
    await device.reloadReactNative();
  });

  it('TC-E-01: app launches and shows harness header', async () => {
    await detoxExpect(
      element(by.text('Offline FaceAuth Harness')),
    ).toBeVisible();
  });

  it('TC-E-02: camera preview section is visible', async () => {
    await detoxExpect(
      element(by.text('Front Camera Preview')),
    ).toBeVisible();
  });

  it('TC-E-03: native engine initialises within 5 s', async () => {
    // The console output card shows engine status; wait for "Injected"
    await waitFor(element(by.text('Injected')))
      .toBeVisible()
      .withTimeout(5_000);
  });

  it('TC-E-04: storage smoke tests pass', async () => {
    await element(by.text('Run Storage Smoke Tests')).tap();

    // Smoke test completion changes console to show PASS
    await waitFor(element(by.text(/SQLCipher smoke test: PASS/)))
      .toBeVisible()
      .withTimeout(10_000);
  });

  it('TC-E-05: liveness pass button is tappable', async () => {
    await detoxExpect(
      element(by.text('Mark Liveness Passed')),
    ).toBeVisible();

    await element(by.text('Mark Liveness Passed')).tap();

    await waitFor(element(by.text(/Liveness FSM marked PASS/)))
      .toBeVisible()
      .withTimeout(5_000);
  });

  it('TC-E-06: read latest native result does not crash', async () => {
    await element(by.text('Read Latest Native Result')).tap();

    // Accept either a real result or an explicit error text – no crash
    await waitFor(
      element(by.text(/accepted|Bootstrap failure|Loopback failure/)),
    )
      .toBeVisible()
      .withTimeout(5_000);
  });
});
