import { loadGamePreview } from '@/src/lib/data/game-preview';
import { respond } from '@/src/lib/data/respond';

export async function GET(_request: Request, { params }: { params: Promise<{ game_id: string }> }) {
  const { game_id } = await params;
  return respond(await loadGamePreview(game_id));
}
