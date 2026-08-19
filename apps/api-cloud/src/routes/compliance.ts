/**
 * /api/compliance — small helpers for the protected "Steuer-Export & Compliance"
 * section. `unlock` is a no-op probe whose only job is to FORCE a manager PIN
 * step-up before the fiscal-export section opens: it requires ADMIN + a fresh
 * step-up token, so the POS api-client interceptor pops the StepUpModal and the
 * section only reveals its export buttons once a valid step-up token exists.
 */

import { Type } from '@sinclair/typebox';
import type { FastifyPluginAsync } from 'fastify';

import { requireAuth, requireRole, requireStepUp } from '../lib/auth-policy.js';

const complianceRoute: FastifyPluginAsync = async (app) => {
  app.get(
    '/api/compliance/unlock',
    {
      schema: {
        tags: ['compliance'],
        summary: 'Manager-PIN gate for the Steuer-Export & Compliance section.',
        response: { 200: Type.Object({ ok: Type.Boolean() }) },
      },
    },
    async (req) => {
      requireAuth(req);
      requireRole(req, 'ADMIN', 'READONLY');
      requireStepUp(req);
      return { ok: true };
    },
  );
};

export default complianceRoute;
