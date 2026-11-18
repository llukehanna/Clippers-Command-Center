import { loadFranchiseContracts } from '@/src/lib/data/franchise-contracts';
import { respond } from '@/src/lib/data/respond';

export async function GET() {
  return respond(await loadFranchiseContracts());
}
