// Most recent meeting with the next opponent.
import { fmtDate } from '../dates.js';
import { oppFull, phrasings, type Headline, type TemplateModule } from './shared.js';

const headline = (i: number): Headline => (f, rc) => {
  const opp = oppFull(f, rc);
  const lac = f.data.lac_score ?? 0;
  const them = f.data.opp_score ?? 0;
  const score = `${Math.max(lac, them)}-${Math.min(lac, them)}`;
  const won = lac > them;
  return i === 0
    ? `Last meeting: Clippers ${won ? 'won' : 'lost'} ${score} vs the ${opp}`
    : `Last time vs the ${opp}: a ${score} Clippers ${won ? 'win' : 'loss'}`;
};

export const lastMeetingTemplates: TemplateModule = {
  default: phrasings([headline(0), headline(1)], (f) =>
    `${f.data.meeting_home ? 'Home' : 'Away'}, ${fmtDate(f.data.meeting_date ?? f.context.date)}`),
};
