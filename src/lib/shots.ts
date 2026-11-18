// src/lib/shots.ts
// Shot locations from ESPN play-by-play (pbp_events.shot_x / shot_y, feet):
// x runs 0–50 across the court, y away from the hoop's line (the hoop sits at
// about (25, 0); ingest keeps 0 <= y <= 94). Zones use shot_value for threes,
// distance and the 16-ft paint for twos.

export const HOOP_X = 25;
export const HOOP_FROM_BASELINE = 5.25;
/** Court units per foot in the shot chart's SVG (viewBox 0 0 500 470). */
export const SCALE = 10;

export type ShotZone = 'rim' | 'paint' | 'mid' | 'corner3' | 'above3';
export const ZONES: ShotZone[] = ['rim', 'paint', 'mid', 'corner3', 'above3'];
export const ZONE_LABEL: Record<ShotZone, string> = {
  rim: 'At the rim',
  paint: 'Paint',
  mid: 'Midrange',
  corner3: 'Corner 3',
  above3: 'Above-the-break 3',
};

export interface Shot {
  x: number;
  y: number;
  made: boolean;
  value: 2 | 3;
  player_id: string;
  player: string;
}

export function shotZone(x: number, y: number, value: 2 | 3): ShotZone {
  if (value === 3) return y <= 8 ? 'corner3' : 'above3';
  if (Math.hypot(x - HOOP_X, y) <= 4) return 'rim';
  if (Math.abs(x - HOOP_X) <= 8 && y <= 14) return 'paint';
  return 'mid';
}

export interface ZoneLine {
  zone: ShotZone;
  made: number;
  att: number;
}

export function zoneSummary(shots: Shot[]): ZoneLine[] {
  const lines = new Map<ShotZone, ZoneLine>(ZONES.map((zone) => [zone, { zone, made: 0, att: 0 }]));
  for (const s of shots) {
    const line = lines.get(shotZone(s.x, s.y, s.value))!;
    line.att++;
    if (s.made) line.made++;
  }
  return ZONES.map((z) => lines.get(z)!);
}

export function toCourt(x: number, y: number): { cx: number; cy: number } {
  return { cx: x * SCALE, cy: (y + HOOP_FROM_BASELINE) * SCALE };
}
