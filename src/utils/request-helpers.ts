/**
 * Request helpers shared by custom (auth:false) controllers.
 *
 * Custom binary/side-effect routes (waypoints up/download, /profiles/me, join,
 * close) are registered with `auth: false` so they don't depend on the
 * users-permissions role-permission grants. Instead they authenticate the
 * caller manually here with the plugin's own JWT service — fully self-contained
 * and deterministic (C-01..C-06).
 */

/** True if the user carries an admin role or the Trackify super-admin code. */
export function isAdminUser(user: any): boolean {
  return !!user?.roles?.some(
    (r: any) => r.type === 'admin' || r.code === 'trackify-super-admin'
  );
}

/**
 * Resolve the authenticated user from the Bearer token, or null.
 * Never throws — a missing/invalid token simply yields null (used by endpoints
 * that also serve public resources, e.g. GET /rides/:id/waypoints on a public
 * ride).
 */
export async function getAuthenticatedUser(ctx: any): Promise<any | null> {
  try {
    const auth: string = ctx.request?.header?.authorization || '';
    if (!auth.toLowerCase().startsWith('bearer ')) return null;
    const token = auth.slice(7).trim();
    if (!token) return null;

    const jwtService = strapi.plugin('users-permissions').service('jwt');
    const payload = await jwtService.verify(token);
    if (!payload?.id) return null;

    const user = await strapi.db
      .query('plugin::users-permissions.user')
      .findOne({ where: { id: payload.id }, populate: ['role'] });
    if (!user) return null;

    // Normalize a `roles` array so isAdminUser works like ctx.state.user.
    return { ...user, roles: user.role ? [user.role] : [] };
  } catch {
    return null;
  }
}

/**
 * Read the raw request body as a Buffer, with a hard size cap.
 *
 * `application/octet-stream` is not parsed by strapi::body, so the Node stream
 * is still readable here. If a deployment reconfigures the body parser to buffer
 * it, we fall back to whatever it left on ctx.request.body.
 */
export async function readRawBody(
  ctx: any,
  maxBytes: number = 12 * 1024 * 1024
): Promise<Buffer> {
  const pre = ctx.request?.body;
  if (Buffer.isBuffer(pre)) return pre;
  if (pre && typeof pre === 'object' && Buffer.isBuffer(pre.raw)) return pre.raw;

  const req = ctx.req;
  return await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error(`Payload exceeds ${maxBytes} bytes`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** Send a Strapi-shaped error envelope with an explicit status. */
export function sendError(
  ctx: any,
  status: number,
  name: string,
  message: string,
  details: Record<string, any> = {}
): void {
  ctx.status = status;
  ctx.body = { data: null, error: { status, name, message, details } };
}
