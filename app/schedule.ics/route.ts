import { icsResponse, loadIcsGames } from '@/src/lib/data/schedule-ics';

// Subscribable feed: webcal://clippers.lukeghanna.com/schedule.ics
export async function GET() {
  return icsResponse(await loadIcsGames({}), { calName: 'Clippers' });
}
