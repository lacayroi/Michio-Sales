import { SESSION_COOKIE, verifySessionToken } from '@michio/auth/session';
import { type NextRequest, NextResponse } from 'next/server';

const PUBLIC_PAGES = ['/login'];
// Endpoints authenticated by other means (API key, webhook signature) or intentionally open.
const OPEN_API = ['/api/v1/auth/login', '/api/v1/health', '/api/v1/public/', '/api/v1/webhooks/', '/webhooks/'];

function isMutation(method: string) {
  return !['GET', 'HEAD', 'OPTIONS'].includes(method);
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isApi = pathname.startsWith('/api/') || pathname.startsWith('/webhooks/');
  const isOpenApi = OPEN_API.some((p) => pathname.startsWith(p));

  // CSRF defence for cookie-authenticated mutations (SPEC 11.1): require a same-origin request.
  if (isApi && !isOpenApi && isMutation(req.method)) {
    const origin = req.headers.get('origin');
    if (!origin || new URL(origin).host !== req.headers.get('host')) {
      return NextResponse.json({ error: { code: 'CSRF', message: 'Yêu cầu không hợp lệ' } }, { status: 403 });
    }
  }
  if (isApi) return NextResponse.next(); // route handlers check the session themselves

  const secret = process.env.SESSION_SECRET ?? '';
  const session = await verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value, secret);
  const isPublic = PUBLIC_PAGES.includes(pathname);

  if (!session && !isPublic) {
    const url = new URL('/login', req.url);
    if (pathname !== '/') url.searchParams.set('next', pathname + req.nextUrl.search);
    return NextResponse.redirect(url);
  }
  if (session && isPublic) return NextResponse.redirect(new URL('/', req.url));
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|brand/|icon.png|favicon.ico|manifest.webmanifest).*)'],
};
