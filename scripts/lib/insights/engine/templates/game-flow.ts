// Postgame game flow (play-by-play): comebacks, leads, runs, lead changes. Past tense.
import type { Fact } from '../types.js';
import { oppShort, phrasings, type Headline, type RenderContext, type TemplateModule } from './shared.js';

type Words = ((f: Fact, rc: RenderContext) => string)[];
const WORDS: Record<string, Words> = {
  comeback: [
    (f, rc) => `Clippers erased a ${f.value}-point deficit to beat the ${oppShort(f, rc)}`,
    (f, rc) => `Clippers came back from ${f.value} down to beat the ${oppShort(f, rc)}`,
  ],
  largest_lead: [
    (f, rc) => `Clippers led the ${oppShort(f, rc)} by as many as ${f.value}`,
    (f, rc) => `Clippers built a ${f.value}-point lead on the ${oppShort(f, rc)}`,
  ],
  blown_lead: [
    (f, rc) => `Clippers lost to the ${oppShort(f, rc)} after leading by ${f.value}`,
    (f, rc) => `Clippers blew a ${f.value}-point lead vs the ${oppShort(f, rc)}`,
  ],
  best_run: [
    (f, rc) => `Clippers went on a ${f.value}-0 run vs the ${oppShort(f, rc)}`,
    (f, rc) => `A ${f.value}-0 Clippers run vs the ${oppShort(f, rc)}`,
  ],
  lead_changes: [
    (f, rc) => `The lead changed hands ${f.value} times vs the ${oppShort(f, rc)}`,
    (f, rc) => `${f.value} lead changes in the Clippers' game vs the ${oppShort(f, rc)}`,
  ],
};

const headlines: Headline[] = [0, 1].map((i) => (f: Fact, rc: RenderContext) => WORDS[f.stat][i](f, rc));

export const gameFlowTemplates: TemplateModule = {
  default: phrasings(headlines, (f) => `Largest lead ${f.data.lead ?? 0}, largest deficit ${f.data.deficit ?? 0}`),
};
