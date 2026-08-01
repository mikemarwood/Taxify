import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET is not set. Copy .env.example to .env and set a strong secret.');
}

const TOKEN_TTL = '90d';
export const COOKIE_NAME = 'taxify_token';

export function signToken(user) {
  return jwt.sign({ sub: user.id, email: user.email }, JWT_SECRET, { expiresIn: TOKEN_TTL });
}

// An accountant's session names the client whose books they opened. It lives on
// the token rather than on their user row because they may have several
// clients, and because closing the tab should leave nothing behind. The ttl is
// the access window itself — the token cannot outlive the assignment.
export function signAccountantToken(user, ownerId, windowHours) {
  return jwt.sign({ sub: user.id, email: user.email, clientId: ownerId }, JWT_SECRET, {
    expiresIn: `${windowHours}h`,
  });
}

// A view-as session carries the admin's own id so the session can be handed
// back on exit. Deliberately short-lived: it's a support tool, not somewhere to
// work from, and a forgotten one shouldn't sit open for ninety days.
export function signViewAsToken(user, adminId) {
  return jwt.sign({ sub: user.id, email: user.email, viewedBy: adminId }, JWT_SECRET, { expiresIn: '2h' });
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

export function cookieOptions(persistent = true) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    // A "public device" login omits maxAge so the cookie is a browser session
    // cookie and disappears as soon as the window/browser is closed.
    ...(persistent ? { maxAge: 90 * 24 * 60 * 60 * 1000 } : {}),
    path: '/',
  };
}
