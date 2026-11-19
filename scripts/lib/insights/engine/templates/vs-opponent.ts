// A Clippers player's scoring vs the next opponent, over the regular seasons since records start.
// "Career" only when his whole career is in the data (data.career); otherwise "since {label}".
import { oppShort, phrasings, type Headline, type TemplateModule } from './shared.js';

const headline = (i: number): Headline => (f, rc) =>
  i === 0
    ? `${f.subject.name} averages ${f.data.formatted} points vs the ${oppShort(f, rc)}`
    : `${f.subject.name} vs the ${oppShort(f, rc)}: ${f.data.formatted} PPG`;

export const vsOpponentTemplates: TemplateModule = {
  default: phrasings([headline(0), headline(1)], (f, _fr, rc) =>
    f.data.career
      ? `${f.data.games} career regular-season games vs the ${oppShort(f, rc)}; ${f.data.prev_formatted} PPG overall`
      : `${f.data.games} regular-season games since ${f.data.label}; ${f.data.prev_formatted} PPG overall`),
};
