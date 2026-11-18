import { loadFranchiseMoves } from '@/src/lib/data/franchise-moves';
import { respond } from '@/src/lib/data/respond';

export async function GET(request: Request) {
  return respond(await loadFranchiseMoves(new URL(request.url)));
}
