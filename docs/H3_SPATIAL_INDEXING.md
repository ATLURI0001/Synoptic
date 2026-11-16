# H3 Geospatial Resolution & Spatial Indexing Guide

## Overview
Synoptic indexes continuous global activity using Uber's discrete hexagonal global grid system (H3).

## Resolution Tiers
- **Resolution 4**: Continent and regional clustering (~11,000 km² per hexagon).
- **Resolution 7**: Metropolitan and flight corridor tracking (~5.16 km²).
- **Resolution 10**: High-precision port, terminal, and runway spatial partitions (~0.015 km²).

## Aggregation Pipeline
Spatial streams pass through k-ring neighbor algorithms to detect density anomalies and vessel groupings in real time.
