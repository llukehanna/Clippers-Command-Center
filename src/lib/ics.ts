// src/lib/ics.ts
// iCalendar (RFC 5545) for the schedule: one game (/schedule/[id]/ics) or the
// season feed (/schedule.ics). CRLF line endings, 75-octet folding, text
// escaping; all-day events when the tip time isn't known.

export const SITE_URL = 'https://clippers.lukeghanna.com';

export interface IcsEvent {
  uid: string;
  start: string | null;        // ISO UTC tip time
  date: string;                // YYYY-MM-DD, used when start is null
  durationMinutes: number;
  summary: string;
  location?: string | null;
  description?: string | null;
  url?: string | null;
}

export function escapeText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n');
}

const encoder = new TextEncoder();

export function foldLine(line: string): string {
  const out: string[] = [];
  let cur = '';
  let bytes = 0;
  let limit = 75; // continuation lines start with a space, leaving 74
  for (const ch of line) {
    const n = encoder.encode(ch).length;
    if (bytes + n > limit) {
      out.push(cur);
      cur = '';
      bytes = 0;
      limit = 74;
    }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}

const utcStamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const dateStamp = (ymd: string) => ymd.replaceAll('-', '');
function nextDay(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function buildIcs(events: IcsEvent[], calName: string, now: Date = new Date()): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Clippers Command Center//Schedule//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(calName)}`,
    'X-WR-TIMEZONE:America/Los_Angeles',
  ];
  for (const e of events) {
    lines.push('BEGIN:VEVENT', `UID:${e.uid}`, `DTSTAMP:${utcStamp(now)}`);
    const start = e.start ? new Date(e.start) : null;
    if (start && !Number.isNaN(start.getTime())) {
      lines.push(`DTSTART:${utcStamp(start)}`, `DTEND:${utcStamp(new Date(start.getTime() + e.durationMinutes * 60_000))}`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${dateStamp(e.date)}`, `DTEND;VALUE=DATE:${dateStamp(nextDay(e.date))}`);
    }
    lines.push(`SUMMARY:${escapeText(e.summary)}`);
    if (e.location) lines.push(`LOCATION:${escapeText(e.location)}`);
    if (e.description) lines.push(`DESCRIPTION:${escapeText(e.description)}`);
    if (e.url) lines.push(`URL:${e.url}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

export interface IcsGame {
  game_id: string;
  game_date: string;
  start_time_utc: string | null;
  lac_home: boolean;
  opponent_abbr: string;
  arena: string | null;
  status: string;
  lac_score: number | null;
  opp_score: number | null;
  broadcasts?: string[];
}

export function gameIcsEvent(g: IcsGame): IcsEvent {
  const matchup = `LAC ${g.lac_home ? 'vs' : '@'} ${g.opponent_abbr}`;
  const final = g.status.toLowerCase() === 'final' && g.lac_score != null && g.opp_score != null;
  const summary = final ? `${matchup} · ${g.lac_score! > g.opp_score! ? 'W' : 'L'} ${g.lac_score}-${g.opp_score}` : matchup;
  const url = `${SITE_URL}${final ? '/history/' : '/schedule/'}${g.game_id}`;
  const description = [g.broadcasts?.length ? `Watch: ${g.broadcasts.join(', ')}` : null, url].filter(Boolean).join('\n');
  return {
    uid: `ccc-${g.game_id}@clippers.lukeghanna.com`,
    start: g.start_time_utc,
    date: g.game_date,
    durationMinutes: 150,
    summary,
    location: g.arena ?? (g.lac_home ? 'Intuit Dome' : null),
    description,
    url,
  };
}
