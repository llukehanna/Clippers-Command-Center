import { icsResponse, loadIcsGames } from '@/src/lib/data/schedule-ics';
import { scheduleGameIds } from '@/src/lib/prebuild/params';
import { staticParams } from '@/src/lib/prebuild/static-params';

// Prerendered at build for every scheduled game; unknown ids 404 until the next build.
export const dynamic = 'force-static';
export const dynamicParams = false;

export async function generateStaticParams() {
  return staticParams(await scheduleGameIds()).map((game_id) => ({ game_id }));
}

export async function GET(_request: Request, { params }: { params: Promise<{ game_id: string }> }) {
  const { game_id } = await params;
  if (!/^\d+$/.test(game_id)) return new Response('Not found', { status: 404 });
  const [game] = await loadIcsGames({ gameId: game_id });
  if (!game) return new Response('Not found', { status: 404 });
  const filename = `lac-${game.lac_home ? 'vs' : 'at'}-${game.opponent_abbr.toLowerCase()}-${game.game_date}.ics`;
  return icsResponse([game], { calName: 'Clippers', filename });
}
