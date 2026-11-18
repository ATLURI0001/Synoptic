import { normalizeHeading } from './cockpitMath.js';

const EARTH_RADIUS_M = 6371008.8;
const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

/**
 * Project geodetic (lat, lon, altM) into local East-North-Up tangent plane (meters)
 * relative to origin (originLat, originLon, originAltM).
 */
export function geodeticToLocalEnu(lat, lon, altM, originLat, originLon, originAltM = 0) {
  const dLat = (lat - originLat) * DEG_TO_RAD;
  let dLonDeg = lon - originLon;
  if (dLonDeg > 180) dLonDeg -= 360;
  if (dLonDeg < -180) dLonDeg += 360;
  const dLon = dLonDeg * DEG_TO_RAD;
  const cosLat = Math.cos(originLat * DEG_TO_RAD);

  return {
    east: EARTH_RADIUS_M * dLon * cosLat,
    north: EARTH_RADIUS_M * dLat,
    up: altM - originAltM,
  };
}

/**
 * Invert local East-North-Up offsets (meters) back to geodetic (lat, lon, altM).
 */
export function localEnuToGeodetic(east, north, up, originLat, originLon, originAltM = 0) {
  const cosLat = Math.max(1e-6, Math.cos(originLat * DEG_TO_RAD));
  const lat = Math.max(-90, Math.min(90, originLat + (north / EARTH_RADIUS_M) * RAD_TO_DEG));
  const rawLon = originLon + (east / (EARTH_RADIUS_M * cosLat)) * RAD_TO_DEG;
  const lon = ((((rawLon + 180) % 360) + 360) % 360) - 180;
  return {
    lat: Number(lat.toFixed(7)),
    lon: Number(lon.toFixed(7)),
    altitudeM: Number((originAltM + up).toFixed(2)),
  };
}

/**
 * 3D Alpha-Beta Kinematic Track Filter for noisy ADS-B/telemetry streams.
 *
 * Smooths horizontal and vertical aircraft position/velocity in local ENU space,
 * rejects kinematically impossible GPS/ADS-B teleportation outliers, and provides
 * bounded dead-reckoning extrapolation between asynchronous feed updates.
 */
export class AlphaBetaTrackFilter {
  /**
   * @param {object} [options]
   * @param {number} [options.alpha=0.65] Position smoothing gain in (0, 1].
   * @param {number} [options.beta=0.25] Velocity smoothing gain in (0, 1].
   * @param {number} [options.maxSpeedMps=1100] Kinematic plausibility gate (~Mach 3.2).
   * @param {number} [options.maxExtrapolationSec=30] Hard dead-reckoning horizon cap.
   */
  constructor({
    alpha = 0.65,
    beta = 0.25,
    maxSpeedMps = 1100,
    maxExtrapolationSec = 30,
  } = {}) {
    this.alpha = Number.isFinite(alpha) ? Math.max(0.05, Math.min(1.0, alpha)) : 0.65;
    this.beta = Number.isFinite(beta) ? Math.max(0.01, Math.min(1.0, beta)) : 0.25;
    this.maxSpeedMps = Number.isFinite(maxSpeedMps) && maxSpeedMps > 0 ? maxSpeedMps : 1100;
    this.maxExtrapolationSec =
      Number.isFinite(maxExtrapolationSec) && maxExtrapolationSec > 0 ? maxExtrapolationSec : 30;

    this.initialized = false;
    this.origin = null;
    this.pos = { east: 0, north: 0, up: 0 };
    this.vel = { east: 0, north: 0, up: 0 };
    this.lastTimestampMs = 0;
    this.acceptedUpdates = 0;
    this.rejectedOutliers = 0;
  }

  /**
   * Ingest a new geodetic telemetry fix.
   * Returns { accepted: boolean, reason: string, residualMeters: number, state: object|null }.
   */
  update({ lat, lon, altitudeM = 0, timestampMs }) {
    if (
      ![lat, lon, altitudeM, timestampMs].every(Number.isFinite) ||
      lat < -90 ||
      lat > 90 ||
      lon < -180 ||
      lon > 180
    ) {
      return { accepted: false, reason: 'invalid_coordinates', residualMeters: 0, state: this.getState() };
    }

    if (!this.initialized) {
      this.origin = { lat, lon, altitudeM };
      this.pos = { east: 0, north: 0, up: 0 };
      this.vel = { east: 0, north: 0, up: 0 };
      this.lastTimestampMs = timestampMs;
      this.initialized = true;
      this.acceptedUpdates = 1;
      return { accepted: true, reason: 'initialized', residualMeters: 0, state: this.getState() };
    }

    const dtSec = (timestampMs - this.lastTimestampMs) / 1000;
    if (dtSec <= 0) {
      return { accepted: false, reason: 'non_monotonic_timestamp', residualMeters: 0, state: this.getState() };
    }

    const obs = geodeticToLocalEnu(
      lat,
      lon,
      altitudeM,
      this.origin.lat,
      this.origin.lon,
      this.origin.altitudeM,
    );

    const predE = this.pos.east + this.vel.east * dtSec;
    const predN = this.pos.north + this.vel.north * dtSec;
    const predU = this.pos.up + this.vel.up * dtSec;

    const resE = obs.east - predE;
    const resN = obs.north - predN;
    const resU = obs.up - predU;
    const residualMeters = Math.hypot(resE, resN, resU);

    // Kinematic plausibility gate against ADS-B multipath / coordinate teleportation
    const impliedSpeedMps = Math.hypot(obs.east - this.pos.east, obs.north - this.pos.north) / dtSec;
    if (impliedSpeedMps > this.maxSpeedMps) {
      this.rejectedOutliers += 1;
      return {
        accepted: false,
        reason: 'kinematic_outlier',
        residualMeters: Number(residualMeters.toFixed(2)),
        state: this.getState(),
      };
    }

    if (this.acceptedUpdates === 1) {
      // Bootstrap initial velocity directly from first two valid fixes
      this.vel.east = (obs.east - this.pos.east) / dtSec;
      this.vel.north = (obs.north - this.pos.north) / dtSec;
      this.vel.up = (obs.up - this.pos.up) / dtSec;
      this.pos.east = obs.east;
      this.pos.north = obs.north;
      this.pos.up = obs.up;
    } else {
      this.pos.east = predE + this.alpha * resE;
      this.pos.north = predN + this.alpha * resN;
      this.pos.up = predU + this.alpha * resU;

      const velGain = this.beta / dtSec;
      this.vel.east += velGain * resE;
      this.vel.north += velGain * resN;
      this.vel.up += velGain * resU;
    }

    this.lastTimestampMs = timestampMs;
    this.acceptedUpdates += 1;

    return {
      accepted: true,
      reason: 'updated',
      residualMeters: Number(residualMeters.toFixed(2)),
      state: this.getState(),
    };
  }

  /**
   * Dead-reckon aircraft position and kinematic state at targetTimestampMs.
   */
  predictAt(targetTimestampMs) {
    if (!this.initialized || !Number.isFinite(targetTimestampMs)) return null;
    const rawDtSec = Math.max(0, (targetTimestampMs - this.lastTimestampMs) / 1000);
    const dtSec = Math.min(this.maxExtrapolationSec, rawDtSec);

    const estE = this.pos.east + this.vel.east * dtSec;
    const estN = this.pos.north + this.vel.north * dtSec;
    const estU = this.pos.up + this.vel.up * dtSec;

    const geo = localEnuToGeodetic(
      estE,
      estN,
      estU,
      this.origin.lat,
      this.origin.lon,
      this.origin.altitudeM,
    );

    const groundSpeedMps = Math.hypot(this.vel.east, this.vel.north);
    const headingDeg =
      groundSpeedMps > 0.1
        ? normalizeHeading((Math.atan2(this.vel.east, this.vel.north) * RAD_TO_DEG))
        : 0;

    return {
      ...geo,
      groundSpeedMps: Number(groundSpeedMps.toFixed(2)),
      climbRateMps: Number(this.vel.up.toFixed(2)),
      headingDeg: Number(headingDeg.toFixed(2)),
      extrapolatedSec: Number(dtSec.toFixed(3)),
      stale: rawDtSec > this.maxExtrapolationSec,
    };
  }

  getState() {
    if (!this.initialized) return null;
    return this.predictAt(this.lastTimestampMs);
  }
}
