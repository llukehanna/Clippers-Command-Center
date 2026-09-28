import { loadHome } from '@/src/lib/data/home';
import { respond } from '@/src/lib/data/respond';

export async function GET(_request?: Request) {
  return respond(await loadHome());
}
