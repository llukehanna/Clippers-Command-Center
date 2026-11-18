// GET /players/nba/{personId} — a player's profile by NBA person id. Live
// data (box score, rotation, injuries) only knows NBA ids; profiles are keyed
// by our internal player id, so this looks it up and redirects. Unknown ids
// land on the roster.
import { NextResponse, type NextRequest } from 'next/server';
import { sql } from '@/src/lib/db';

export async function GET(request: NextRequest, ctx: { params: Promise<{ person_id: string }> }) {
  const { person_id } = await ctx.params;
  const id = Number(person_id);
  let playerId: string | null = null;
  if (Number.isSafeInteger(id) && id > 0) {
    try {
      const [row] = await sql<{ player_id: string }[]>`
        SELECT player_id::text FROM players WHERE nba_person_id = ${id} LIMIT 1
      `;
      playerId = row?.player_id ?? null;
    } catch (err) {
      console.error('[GET /players/nba] lookup failed:', err);
    }
  }
  return NextResponse.redirect(new URL(playerId ? `/players/${playerId}` : '/players', request.url), 307);
}
