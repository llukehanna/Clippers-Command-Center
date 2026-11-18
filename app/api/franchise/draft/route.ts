import { loadFranchiseDraft } from '@/src/lib/data/franchise-draft';
import { respond } from '@/src/lib/data/respond';

export async function GET() {
  return respond(await loadFranchiseDraft());
}
