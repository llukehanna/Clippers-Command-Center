import { loadFranchiseFrontOffice } from '@/src/lib/data/franchise-front-office';
import { respond } from '@/src/lib/data/respond';

export async function GET() {
  return respond(await loadFranchiseFrontOffice());
}
