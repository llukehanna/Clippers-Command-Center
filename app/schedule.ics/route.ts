import { icsResponse, loadIcsGames } from '@/src/lib/data/schedule-ics';

// Prerendered at build (rebuilt whenever the schedule syncs).
export const dynamic = 'force-static';

// Subscribable feed: webcal://clippers.lukeghanna.com/schedule.ics
export async function GET() {
  return icsResponse(await loadIcsGames({}), { calName: 'Clippers' });
}
