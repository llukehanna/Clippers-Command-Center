import { loadSchedule } from '@/src/lib/data/schedule';
import { respond } from '@/src/lib/data/respond';

export async function GET(request: Request) {
  return respond(await loadSchedule(new URL(request.url)));
}
