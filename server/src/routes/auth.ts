import type { FastifyPluginAsync } from 'fastify';
import type { Services } from '../app.js';
import { SESSION_COOKIE } from '../auth.js';

export const authRoutes =
  ({ ctx }: Services): FastifyPluginAsync =>
  async (app) => {
    const auth = ctx.auth;
    const cookieOpts = { path: '/', httpOnly: true, sameSite: 'lax' as const, maxAge: 30 * 24 * 60 * 60 };

    app.get('/status', async (req) => ({ setupRequired: auth.setupRequired(), authenticated: !!req.isAdmin }));

    app.post<{ Body: { password: string } }>('/setup', async (req, reply) => {
      if (!auth.setupRequired()) return reply.code(409).send({ error: 'Already set up' });
      const password = req.body?.password ?? '';
      if (password.length < 8) return reply.code(400).send({ error: 'Use at least 8 characters' });
      auth.setPassword(password);
      reply.setCookie(SESSION_COOKIE, auth.createSession(), cookieOpts);
      return { ok: true };
    });

    app.post<{ Body: { password: string } }>('/login', async (req, reply) => {
      if (auth.setupRequired()) return reply.code(409).send({ error: 'Setup required' });
      if (!auth.checkPassword(req.body?.password ?? '')) return reply.code(401).send({ error: 'Wrong password' });
      reply.setCookie(SESSION_COOKIE, auth.createSession(), cookieOpts);
      return { ok: true };
    });

    app.post('/logout', async (req, reply) => {
      const token = req.cookies[SESSION_COOKIE];
      if (token) auth.destroySession(token);
      reply.clearCookie(SESSION_COOKIE, { path: '/' });
      return { ok: true };
    });
  };
