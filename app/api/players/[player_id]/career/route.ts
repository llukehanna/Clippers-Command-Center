import { loadPlayerCareer } from '@/src/lib/data/player-career';
import { respond } from '@/src/lib/data/respond';

export async function GET(_request: Request, { params }: { params: Promise<{ player_id: string }> }) {
  const { player_id } = await params;
  return respond(await loadPlayerCareer(player_id));
}
