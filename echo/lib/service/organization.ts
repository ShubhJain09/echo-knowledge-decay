import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { store } from '../db/store';
import { account, hash, members, saveUser } from '../auth/accounts';
import { authorize, type Actor } from '../auth/rbac';
import { text, valid } from '../types/schemas';
import { repository } from '../repository';
import { AppError } from '../errors';
import type { Organization } from '../types';

const INVITE_DAYS = 7;
/** Owner is deliberately absent: an organization has exactly one, created at signup. */
const invitableRoles = z.enum(['Admin', 'Reviewer', 'Editor', 'Viewer', 'Auditor']);
type InvitableRole = z.infer<typeof invitableRoles>;

interface Invite {
  email: string;
  role: InvitableRole;
  organizationId: string;
  expires: string;
  accepted: boolean;
}

/**
 * Membership and organization settings. These are identity writes rather than knowledge writes, so
 * they append an audit row instead of taking the tenant-wide knowledge transaction.
 */
export async function organizationAction(action: string, body: unknown, actor: Actor) {
  const repo = repository(actor.organizationId);

  // Accepting an invitation is the one action a non-admin may perform.
  if (action === 'accept') {
    const input = valid(z.object({ token: text(100) }).strict(), body);
    const invite = await store().get<Invite>(`INVITE#${hash(input.token)}`, 'INVITE');
    if (!invite || invite.data.accepted || invite.data.email !== actor.email || Date.parse(invite.data.expires) < Date.now())
      throw new AppError(400, 'Invitation is invalid or expired.');
    const user = (await account(actor.email))!;
    const org = invite.data.organizationId;
    if ((await members(actor.organizationId)).length > 1 && actor.role === 'Owner')
      throw new AppError(409, 'An owner with teammates cannot leave the organization through an invitation.');
    await store().write([
      { row: { ...invite, revision: invite.revision + 1, data: { ...invite.data, accepted: true } }, expected: invite.revision },
      {
        row: {
          ...user,
          organizationId: org,
          revision: user.revision + 1,
          data: { ...user.data, organizationId: org, role: invite.data.role },
        },
        expected: user.revision,
      },
      {
        row: { pk: `ORG#${org}`, sk: `MEMBER#${actor.id}`, organizationId: org, revision: 0, data: { email: actor.email } },
        expected: -1,
      },
    ]);
    await repository(org).appendAudit({ ...actor, organizationId: org, role: invite.data.role }, 'organization.joined', actor.id);
    return { ok: true };
  }

  authorize(actor.role, 'admin');

  if (action === 'invite') {
    const input = valid(
      z
        .object({
          email: z
            .email()
            .max(254)
            .transform(s => s.toLowerCase()),
          role: invitableRoles,
        })
        .strict(),
      body,
    );
    if (input.role === 'Admin' && actor.role !== 'Owner') throw new AppError(403, 'Only an owner can invite administrators.');
    const token = randomBytes(32).toString('hex');
    const invite: Invite = {
      ...input,
      organizationId: actor.organizationId,
      expires: new Date(Date.now() + INVITE_DAYS * 86400000).toISOString(),
      accepted: false,
    };
    await store().write([
      {
        row: { pk: `INVITE#${hash(token)}`, sk: 'INVITE', organizationId: actor.organizationId, revision: 0, data: invite },
        expected: -1,
      },
    ]);
    await repo.appendAudit(actor, 'organization.invited', randomUUID());
    // The link is returned rather than emailed. Nothing is sent to the invitee automatically.
    return { url: `${process.env.NEXTAUTH_URL}/invite?token=${token}`, email: input.email };
  }

  if (action === 'role') {
    const input = valid(z.object({ email: z.email(), role: invitableRoles }).strict(), body);
    const user = await account(input.email);
    if (!user || user.data.organizationId !== actor.organizationId) throw new AppError(404, 'Member not found.');
    if (
      user.data.role === 'Owner' ||
      user.data.id === actor.id ||
      (actor.role !== 'Owner' && (input.role === 'Admin' || user.data.role === 'Admin'))
    )
      throw new AppError(403, 'This role change requires the organization owner and cannot change the owner.');
    // Bumping sessionVersion revokes the member's existing sessions immediately.
    await saveUser(user, { ...user.data, role: input.role, sessionVersion: user.data.sessionVersion + 1 });
    await repo.appendAudit(actor, 'organization.role_changed', user.data.id);
    return { ok: true };
  }

  if (action === 'settings') {
    const input = valid(z.object({ name: text(100) }).strict(), body);
    const row = await store().get<Organization>(`ORG#${actor.organizationId}`, 'ORGANIZATION');
    if (!row) throw new AppError(404, 'Organization not found.');
    await store().write([
      { row: { ...row, revision: row.revision + 1, data: { ...row.data, name: input.name } }, expected: row.revision },
    ]);
    await repo.appendAudit(actor, 'organization.settings', actor.organizationId);
    return { ok: true };
  }

  throw new AppError(404, 'Organization action not found.');
}
