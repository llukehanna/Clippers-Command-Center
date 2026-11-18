import { loadFranchiseHonors } from '@/src/lib/data/franchise-honors';
import { respond } from '@/src/lib/data/respond';

export async function GET() {
  return respond(await loadFranchiseHonors());
}
