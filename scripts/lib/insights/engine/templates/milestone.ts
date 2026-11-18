// Season milestone phrasings.
import { phrasings, type Headline, type TemplateModule } from './shared.js';

const headline = (i: number): Headline => (f, rc) => {
  const noun = f.data.label ?? String(f.value);
  if (rc.season.isCurrent) return i === 0 ? `${f.subject.name} has reached ${noun} this season` : `${f.subject.name} has passed ${noun} this season`;
  return i === 0 ? `${f.subject.name} reached ${noun} in ${rc.season.label}` : `${f.subject.name} passed ${noun} in ${rc.season.label}`;
};

export const milestoneTemplates: TemplateModule = {
  default: phrasings([headline(0), headline(1)], (f, _fr, rc, i) => {
    const total = f.data.formatted ?? String(f.data.total_value ?? f.value);
    const games = f.data.games ?? 0;
    if (i === 0) return `${total} in ${games} games`;
    return rc.season.isCurrent ? `Now at ${total} through ${games} games` : `Finished with ${total} in ${games} games`;
  }),
};
