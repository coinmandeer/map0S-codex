import test from "node:test";
import assert from "node:assert/strict";

interface FakeOptions {
  timeout?: number;
  maximumAge?: number;
  enableHighAccuracy?: boolean;
}
type SuccessCb = (position: {
  coords: { longitude: number; latitude: number; accuracy: number };
}) => void;
type ErrorCb = (error: {
  code: number;
  message: string;
  PERMISSION_DENIED: number;
  TIMEOUT: number;
  POSITION_UNAVAILABLE: number;
}) => void;

const CODES = { PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 };

function positionError(code: number) {
  return { code, message: "fake", ...CODES };
}

/** Records what the service asks the platform for, which is the whole point of several of
 *  these tests: the original bug was an *absent* option, not a wrong result. */
const calls: FakeOptions[] = [];
let respond: (success: SuccessCb, failure: ErrorCb) => void = (success) =>
  success({ coords: { longitude: 14.42, latitude: 50.08, accuracy: 12 } });
let watchCount = 0;
let clearCount = 0;

(globalThis as Record<string, unknown>).window = { isSecureContext: true };
// Node ships a read-only `navigator`, so it has to be redefined rather than assigned.
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  writable: true,
  value: {
    geolocation: {
      getCurrentPosition(success: SuccessCb, failure: ErrorCb, options?: FakeOptions) {
        calls.push(options ?? {});
        respond(success, failure);
      },
      watchPosition(success: SuccessCb, failure: ErrorCb, options?: FakeOptions) {
        calls.push(options ?? {});
        watchCount += 1;
        respond(success, failure);
        return watchCount;
      },
      clearWatch() {
        clearCount += 1;
      }
    }
  }
});

const { geolocation, GeolocationError, messageFor } = await import("./geolocation.js");

test.beforeEach(() => {
  calls.length = 0;
  geolocation.reset();
  respond = (success) => success({ coords: { longitude: 14.42, latitude: 50.08, accuracy: 12 } });
});

/** The regression that started all this: `getCurrentPosition` defaults to `timeout: Infinity`,
 *  so a request that never resolves calls neither callback and the caller waits forever. */
test("every request carries an explicit timeout", async () => {
  await geolocation.getPosition();

  assert.equal(calls.length, 1);
  assert.equal(typeof calls[0]!.timeout, "number");
  assert.ok(calls[0]!.timeout! > 0 && calls[0]!.timeout! < 60_000);
});

test("an explicit timeout overrides the default", async () => {
  await geolocation.getPosition({ timeoutMs: 3000 });
  assert.equal(calls[0]!.timeout, 3000);
});

test("a fresh cached fix is reused instead of asking the device again", async () => {
  const first = await geolocation.getPosition();
  const second = await geolocation.getPosition({ maxAgeMs: 60_000 });

  assert.equal(calls.length, 1, "second call must be served from cache");
  assert.deepEqual(first, second);
});

test("maxAgeMs of zero always asks the device", async () => {
  await geolocation.getPosition();
  await geolocation.getPosition({ maxAgeMs: 0 });

  assert.equal(calls.length, 2);
});

/** One click in Objevuj used to fire two competing requests, because the button and the
 *  country lookup each asked separately. */
test("simultaneous callers share a single request", async () => {
  let release: (() => void) | null = null;
  respond = (success) => {
    release = () => success({ coords: { longitude: 1, latitude: 2, accuracy: 5 } });
  };

  const both = Promise.all([
    geolocation.getPosition({ maxAgeMs: 0 }),
    geolocation.getPosition({ maxAgeMs: 0 })
  ]);
  release!();
  const [a, b] = await both;

  assert.equal(calls.length, 1, "only one platform request");
  assert.deepEqual(a, b);
});

test("a denied permission rejects with a distinguishable kind", async () => {
  respond = (_success, failure) => failure(positionError(CODES.PERMISSION_DENIED));

  await assert.rejects(
    () => geolocation.getPosition({ maxAgeMs: 0 }),
    (error: unknown) => error instanceof GeolocationError && error.kind === "denied"
  );
});

test("a timeout rejects with its own kind, not a generic failure", async () => {
  respond = (_success, failure) => failure(positionError(CODES.TIMEOUT));

  await assert.rejects(
    () => geolocation.getPosition({ maxAgeMs: 0 }),
    (error: unknown) => error instanceof GeolocationError && error.kind === "timeout"
  );
});

/** Denied and timed out need different advice — the first tells you to change a browser
 *  setting, the second just to try again. The old code showed one message for both. */
test("each failure kind gets its own message", () => {
  const denied = messageFor(new GeolocationError("denied", ""));
  const timeout = messageFor(new GeolocationError("timeout", ""));
  const insecure = messageFor(new GeolocationError("insecure-context", ""));

  assert.notEqual(denied, timeout);
  assert.notEqual(denied, insecure);
  assert.match(insecure, /HTTPS/);
});

test("locate reports a cached fix before the fresh one arrives", async () => {
  await geolocation.getPosition();

  const seen: number[] = [];
  respond = (success) => success({ coords: { longitude: 20, latitude: 30, accuracy: 3 } });
  const fresh = await geolocation.locate((coarse) => seen.push(coarse.lng), { maxAgeMs: 0 });

  assert.deepEqual(seen, [14.42], "coarse callback got the cached position");
  assert.equal(fresh.lng, 20, "resolved with the fresh one");
});

test("watchers share one platform watch and release it together", () => {
  const before = watchCount;
  const offA = geolocation.watch(() => {});
  const offB = geolocation.watch(() => {});

  assert.equal(watchCount, before + 1, "second subscriber reuses the same watch");

  const clearedBefore = clearCount;
  offA();
  assert.equal(clearCount, clearedBefore, "still watching for the remaining subscriber");
  offB();
  assert.equal(clearCount, clearedBefore + 1);
});

test("an insecure origin is reported as such rather than as a plain failure", async () => {
  (globalThis as Record<string, unknown>).window = { isSecureContext: false };
  try {
    await assert.rejects(
      () => geolocation.getPosition({ maxAgeMs: 0 }),
      (error: unknown) => error instanceof GeolocationError && error.kind === "insecure-context"
    );
  } finally {
    (globalThis as Record<string, unknown>).window = { isSecureContext: true };
  }
});
