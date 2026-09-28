import { loadPlayer } from '@/src/lib/data/player';
import { respond } from '@/src/lib/data/respond';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ player_id: string }> }
) {
  const { player_id } = await params;
  return respond(await loadPlayer(player_id, new URL(request.url)));
}
