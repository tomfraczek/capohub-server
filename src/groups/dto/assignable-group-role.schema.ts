import { z } from 'zod';
import { GroupRole } from '../enums/group-role.enum';

// OWNER is deliberately excluded from both: it can only be granted through
// POST .../transfer-ownership, which enforces the "exactly one active
// OWNER" invariant (also backed by ROLE_ASSIGNMENTS_OWNER_UNIQUE_INDEX at
// the database level).
//
// Group only ever grants ADMIN - it has no ordinary members, so
// MEMBER/INSTRUCTOR/ASSISTANT are not assignable there at all (also
// enforced by the role_assignments_role_matches_target_check DB
// constraint - this schema is the fast, request-time rejection).
export const assignableGroupRoleSchema = z.enum([GroupRole.ADMIN]);

// Section grants the full non-OWNER role set.
export const assignableSectionRoleSchema = z.enum([
  GroupRole.ADMIN,
  GroupRole.INSTRUCTOR,
  GroupRole.ASSISTANT,
  GroupRole.MEMBER,
]);
