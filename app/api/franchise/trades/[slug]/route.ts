import { loadFranchiseTrade } from '@/src/lib/data/franchise-trade';
import { respond } from '@/src/lib/data/respond';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  return respond(await loadFranchiseTrade(slug));
}
