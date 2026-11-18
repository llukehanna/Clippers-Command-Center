import { loadFranchisePeople } from '@/src/lib/data/franchise-people';
import { respond } from '@/src/lib/data/respond';

export async function GET() {
  return respond(await loadFranchisePeople());
}
