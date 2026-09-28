import { loadMedia } from '@/src/lib/data/media';
import { respond } from '@/src/lib/data/respond';

export async function GET(request: Request) {
  return respond(await loadMedia(new URL(request.url)));
}
