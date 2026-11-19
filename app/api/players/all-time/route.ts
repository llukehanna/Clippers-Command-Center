import { loadPlayersAllTime } from '@/src/lib/data/players-all-time';
import { respond } from '@/src/lib/data/respond';

export async function GET() {
  return respond(await loadPlayersAllTime());
}
