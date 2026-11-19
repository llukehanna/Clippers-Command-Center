// src/lib/insights/evidence-aria.ts
// Screen-reader summary of an evidence spec (spec §2.6: "every evidence spec
// also produces an aria summary string at render time").
import { ordinal } from '../record-notes';
import type { Evidence } from './types';

const num = (v: number) => (Number.isInteger(v) ? v.toLocaleString('en-US') : v.toFixed(1));

export function evidenceAria(e: Evidence): string {
  switch (e.type) {
    case 'streak_strip': {
      const hits = e.games.filter((g) => g.hit).length;
      return `${hits} of ${e.games.length} games at ${num(e.threshold)} or better`;
    }
    case 'rank_track':
      return `Ranked ${e.tied ? 'tied for ' : ''}${ordinal(e.rank)} of ${e.total} in ${e.label}`;
    case 'history_ladder': {
      const head = `${e.current.label}: ${num(e.current.value)}`;
      const next = e.others[0];
      return next ? `${head}. Next best on record: ${num(next.value)}, ${next.label}, ${next.date}` : head;
    }
    case 'delta':
      return `From ${num(e.before.value)} (${e.before.label}) to ${num(e.after.value)} (${e.after.label})`;
    case 'milestone_progress':
      return `${num(e.current)} of ${num(e.target)} ${e.label}`;
    case 'margin_spark': {
      const margins = e.series.map(([, m]) => m);
      return margins.length ? `Margin ranged from ${Math.min(...margins)} to ${Math.max(...margins)}` : 'No margin data';
    }
  }
}
