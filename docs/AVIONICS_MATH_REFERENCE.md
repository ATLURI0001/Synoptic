# Avionics Calculations & Aerodynamic Formulas Reference

## Core Formulas
### 1. Crosswind Component
`Crosswind = TrueAirspeed * sin(WindDirection - RunwayHeading)`

### 2. Pressure Altitude
`PressureAltitude = FieldElevation + (29.92 - AltimeterSetting) * 1000`

### 3. Density Altitude
`DensityAltitude = PressureAltitude + [120 * (OutsideAirTemp - StandardTemp)]`
