import { loadPlayers } from '@/src/lib/data/players';
import { respond } from '@/src/lib/data/respond';

export async function GET(request: Request) {
  return respond(await loadPlayers(new URL(request.url)));
}
