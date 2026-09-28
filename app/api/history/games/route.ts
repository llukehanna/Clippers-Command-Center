import { loadHistoryGames } from '@/src/lib/data/history-games';
import { respond } from '@/src/lib/data/respond';

export async function GET(request: Request) {
  return respond(await loadHistoryGames(new URL(request.url)));
}
