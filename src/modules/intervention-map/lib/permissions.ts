import type { UserRole } from '../data/types';

// What the screens offer each role. This only decides which buttons appear: the database's
// policies are what actually enforce the rules, so a button left visible by mistake still can't
// do anything the role isn't allowed to do.
export interface Permissions {
  canEdit: boolean;
  canSeeHistory: boolean;
  canRestore: boolean;
  canManageSharedViews: boolean;
}

export function permissionsFor(role: UserRole): Permissions {
  return {
    canEdit: role === 'admin' || role === 'encoder',
    canSeeHistory: role === 'admin' || role === 'encoder',
    canRestore: role === 'admin',
    canManageSharedViews: role === 'admin',
  };
}

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Admin',
  encoder: 'Encoder',
  viewer: 'Viewer',
};
