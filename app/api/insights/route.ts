import { loadInsights } from '@/src/lib/data/insights';
import { respond } from '@/src/lib/data/respond';

export async function GET(request: Request) {
  return respond(await loadInsights(new URL(request.url)));
}
