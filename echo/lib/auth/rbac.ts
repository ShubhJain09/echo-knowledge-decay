import { AppError } from '../errors';
export const roles = ['Owner','Admin','Reviewer','Editor','Viewer','Auditor'] as const;
export type Role = typeof roles[number];
export type Permission = 'read'|'create'|'ingest'|'review'|'audit'|'admin';
const matrix: Record<Role, readonly Permission[]> = {
  Owner: ['read','create','ingest','review','audit','admin'], Admin: ['read','create','ingest','review','audit','admin'],
  Reviewer: ['read','create','ingest','review'], Editor: ['read','ingest'], Viewer: ['read'], Auditor: ['read','audit'],
};
export const can = (role: Role, permission: Permission) => matrix[role]?.includes(permission) || false;
export function authorize(role: Role, permission: Permission) { if (!can(role, permission)) throw new AppError(403, 'Your role does not allow this action.'); }
export type Actor = { id: string; organizationId: string; name: string; email: string; role: Role; requestId: string };
