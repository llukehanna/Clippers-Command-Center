import { loadHistoryGame } from '@/src/lib/data/history-game';
import { respond } from '@/src/lib/data/respond';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ game_id: string }> }
) {
  const { game_id } = await params;
  return respond(await loadHistoryGame(game_id));
}
