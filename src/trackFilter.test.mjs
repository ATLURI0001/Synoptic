import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AlphaBetaTrackFilter,
  geodeticToLocalEnu,
  localEnuToGeodetic,
} from './trackFilter.js';

test('geodeticToLocalEnu and localEnuToGeodetic round-trip accurately including anti-meridian', () => {
  const originLat = 37.6213;
  const originLon = 179.995;
  const targetLat = 37.6303; // ~1 km north
  const targetLon = -179.995; // ~0.88 km east across 180° meridian

  const enu = geodeticToLocalEnu(targetLat, targetLon, 3500, originLat, originLon, 3000);
  assert.ok(enu.north > 950 && enu.north < 1050, `north=${enu.north}`);
  assert.ok(enu.east > 800 && enu.east < 950, `east=${enu.east}`);
  assert.equal(enu.up, 500);

  const back = localEnuToGeodetic(enu.east, enu.north, enu.up, originLat, originLon, 3000);
  assert.ok(Math.abs(back.lat - targetLat) < 1e-4);
  assert.ok(Math.abs(back.lon - targetLon) < 1e-4);
  assert.equal(back.altitudeM, 3500);
});

test('AlphaBetaTrackFilter tracks constant-velocity climbing aircraft and dead-reckons forward', () => {
  const filter = new AlphaBetaTrackFilter({ alpha: 0.7, beta: 0.3, maxExtrapolationSec: 15 });
  const originLat = 40.0;
  const originLon = -74.0;
  // Fly due east at 200 m/s, climbing at 5 m/s
  const t0 = 1_000_000;

  for (let sec = 0; sec <= 5; sec++) {
    const geo = localEnuToGeodetic(sec * 200, 0, sec * 5, originLat, originLon, 1000);
    const res = filter.update({
      lat: geo.lat,
      lon: geo.lon,
      altitudeM: geo.altitudeM,
      timestampMs: t0 + sec * 1000,
    });
    assert.equal(res.accepted, true);
  }

  const state = filter.getState();
  assert.ok(Math.abs(state.groundSpeedMps - 200) < 2, `speed=${state.groundSpeedMps}`);
  assert.ok(Math.abs(state.headingDeg - 90) < 1, `heading=${state.headingDeg}`);
  assert.ok(Math.abs(state.climbRateMps - 5) < 0.2, `climb=${state.climbRateMps}`);

  // Predict 5 seconds ahead (total 10s -> 2000m east, 1050m alt)
  const pred = filter.predictAt(t0 + 10_000);
  assert.equal(pred.stale, false);
  assert.ok(Math.abs(pred.altitudeM - 1050) < 1.5, `predAlt=${pred.altitudeM}`);

  // Predict beyond maxExtrapolationSec (30s > 15s cap) -> marked stale and clamped
  const stalePred = filter.predictAt(t0 + 35_000);
  assert.equal(stalePred.stale, true);
  assert.equal(stalePred.extrapolatedSec, 15);
});

test('AlphaBetaTrackFilter rejects ADS-B teleportation outliers and non-monotonic fixes', () => {
  const filter = new AlphaBetaTrackFilter({ maxSpeedMps: 500 });
  const t0 = 2_000_000;

  assert.equal(filter.update({ lat: 51.5, lon: -0.1, altitudeM: 5000, timestampMs: t0 }).accepted, true);
  assert.equal(filter.update({ lat: 51.501, lon: -0.1, altitudeM: 5000, timestampMs: t0 + 1000 }).accepted, true);

  // Teleport 1 degree (~111 km) in 1 second -> 111,000 m/s >> 500 m/s gate
  const glitch = filter.update({ lat: 52.5, lon: -0.1, altitudeM: 5000, timestampMs: t0 + 2000 });
  assert.equal(glitch.accepted, false);
  assert.equal(glitch.reason, 'kinematic_outlier');
  assert.equal(filter.rejectedOutliers, 1);

  // Stale/out-of-order timestamp
  const old = filter.update({ lat: 51.502, lon: -0.1, altitudeM: 5000, timestampMs: t0 + 500 });
  assert.equal(old.accepted, false);
  assert.equal(old.reason, 'non_monotonic_timestamp');

  // Invalid coordinates
  const bad = filter.update({ lat: 95, lon: 0, altitudeM: 0, timestampMs: t0 + 3000 });
  assert.equal(bad.accepted, false);
  assert.equal(bad.reason, 'invalid_coordinates');
});
