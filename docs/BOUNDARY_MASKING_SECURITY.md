# Sensitive Geographical Boundary Masking Protocols

## Geo-Fence Masking
Configurable bounding boxes automatically apply spatial obfuscation:
- Spatial jitter: Coordinates within defined privacy polygons are snapped to the centroid of their containing H3 hexagon.
- Velocity filtering: Temporal gaps in tracking data across exclusion zones prevent dead-reckoning trajectory reconstruction.
- Role-Based Access: Unmasked raw coordinate telemetry requires cryptographic administrative authorization.
