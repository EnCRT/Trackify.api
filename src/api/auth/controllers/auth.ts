import crypto from 'node:crypto';
import type { Core } from '@strapi/strapi';
import { getAuthenticatedUser } from '../../../utils/request-helpers';

// Lazy-load google-auth-library so Strapi starts even if it's not installed yet.
let OAuth2Client: any;
let GOOGLE_CLIENT_ID: string;

function getGoogleClient() {
  if (!OAuth2Client) {
    try {
      const googleAuth = require('google-auth-library');
      OAuth2Client = googleAuth.OAuth2Client;
    } catch {
      throw new Error(
        'google-auth-library is not installed. Run: npm install google-auth-library'
      );
    }
  }
  if (!GOOGLE_CLIENT_ID) {
    GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
    if (!GOOGLE_CLIENT_ID) {
      throw new Error(
        'GOOGLE_CLIENT_ID environment variable is not set. Add it to your .env file.'
      );
    }
  }
  return new OAuth2Client(GOOGLE_CLIENT_ID);
}

export default {
  /**
   * POST /api/auth/google/mobile
   *
   * Accepts a Google idToken from Flutter (obtained via google_sign_in without Firebase),
   * verifies it server-side, finds or creates a Strapi user, and returns a JWT.
   */
  async googleMobile(ctx: any) {
    const { idToken } = ctx.request.body as { idToken?: string };

    if (!idToken) {
      return ctx.badRequest('idToken is required');
    }

    try {
      const client = getGoogleClient();

      // Verify the Google idToken
      const ticket = await client.verifyIdToken({
        idToken,
        audience: GOOGLE_CLIENT_ID,
      });

      const payload = ticket.getPayload();
      if (!payload || !payload.email) {
        return ctx.unauthorized('Invalid Google token');
      }

      const { email, name, picture, sub: googleId } = payload;

      // Find or create user via users-permissions plugin
      const userQuery = strapi.documents('plugin::users-permissions.user');
      const jwtService = strapi.plugin('users-permissions').service('jwt');
      const userService = strapi.plugin('users-permissions').service('user');

      // Try to find existing user by email
      let users = await userQuery.findMany({
        filters: { email },
        limit: 1,
      });

      let user: any;

      if (users && users.length > 0) {
        user = users[0];
      } else {
        // Create new user
        const username =
          email.split('@')[0] + '_' + Math.random().toString(36).slice(2, 8);

        user = await userService.add({
          email,
          username,
          // Strapi requires a password; use googleId hash as a placeholder
          // (the user will never use password auth)
          password: googleId || crypto.randomUUID(),
          confirmed: true,
          provider: 'google',
          // Store display name
          firstname: name?.split(' ')[0] || '',
          lastname: name?.split(' ').slice(1).join(' ') || '',
        });

        strapi.log.info(`[Google Auth] Created new user: ${email}`);
      }

      // Ensure the rider has a Profile row (B-06). Non-fatal on failure —
      // auth still succeeds; C-04's GET /profiles/me will retry the create.
      try {
        await strapi
          .service('api::profile.profile')
          .findOrCreateForUser(user.id, {
            nickname: user.username,
            first_name: name?.split(' ')[0] || '',
            last_name: name?.split(' ').slice(1).join(' ') || '',
            photo_url: picture,
          });
      } catch (profileErr: any) {
        strapi.log.error(
          '[Google Auth] Profile ensure failed:',
          profileErr?.message || profileErr
        );
      }

      // Issue JWT
      const jwt = await jwtService.issue({ id: user.id });

      ctx.send({
        jwt,
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
        },
      });
    } catch (error: any) {
      strapi.log.error('[Google Auth] Error:', error.message || error);
      return ctx.unauthorized(
        'Google authentication failed: ' + (error.message || 'Unknown error')
      );
    }
  },

  /**
   * POST /api/auth/refresh
   *
   * Trackify uses Strapi-issued JWTs (the Google id-token is verified once at
   * login). Refresh is a sliding re-issue: present a still-valid token (Bearer
   * header or `refresh_token` in the body) and get a fresh JWT.
   *
   * NOTE(contract §9): this resolves the open item — Strapi issues/refreshes its
   * own JWT; it does not forward a Supabase token. A rotating refresh-token store
   * (users-permissions `jwtManagement: 'refresh'`) is a future hardening step.
   */
  async refresh(ctx: any) {
    let userId = (await getAuthenticatedUser(ctx))?.id;

    if (!userId) {
      const token = ctx.request.body?.refresh_token;
      if (token) {
        try {
          const payload = await strapi
            .plugin('users-permissions')
            .service('jwt')
            .verify(token);
          userId = payload?.id;
        } catch {
          /* fall through to 401 */
        }
      }
    }

    if (!userId) {
      return ctx.unauthorized('Invalid or missing token');
    }

    const jwt = await strapi.plugin('users-permissions').service('jwt').issue({ id: userId });
    return ctx.send({ jwt, expires_in: 3600 });
  },

  /**
   * POST /api/auth/logout
   * JWTs are stateless, so logout is a client-side token discard. Returns 204.
   * (A token-blacklist can be added later if server-side revocation is needed.)
   */
  async logout(ctx: any) {
    ctx.status = 204;
  },
};
