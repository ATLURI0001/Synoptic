# Live Flight (ADS-B) & Maritime (AIS) Telemetry Specification

## Coordinate System
All spatial calculations utilize the WGS 84 (EPSG:4326) ellipsoid. Geodesic distance calculations use the Vincenty inverse formula for sub-millimeter precision.

## Message Payloads
- **Aircraft State**: ICAO 24-bit address, Callsign, Altitude (pressure & geometric), Ground speed, Heading, Vertical rate.
- **Vessel State**: MMSI, IMO, Vessel name, Navigation status, Rate of turn, SOG, COG, Draught.
