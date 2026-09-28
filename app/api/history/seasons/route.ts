import { loadHistorySeasons } from '@/src/lib/data/history-seasons';
import { respond } from '@/src/lib/data/respond';

export async function GET() {
  return respond(await loadHistorySeasons());
}
