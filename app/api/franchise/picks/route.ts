import { loadFranchisePicks } from '@/src/lib/data/franchise-picks';
import { respond } from '@/src/lib/data/respond';

export async function GET() {
  return respond(await loadFranchisePicks());
}
