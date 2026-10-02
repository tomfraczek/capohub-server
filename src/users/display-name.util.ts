import { User } from './entities/user.entity';

// The label shown for a user built from their profile identity: full name
// when both parts are set, else apelido, else the publicCode - which is
// only ever reached by an account that has not filled in a name at all
// (profileComplete=false), never as a stand-in for a name that exists.
// First name, last name and apelido carry no privacy toggle (they are
// always visible), so nothing here depends on the viewer. Never
// `User.displayName` (the separate account label). No localized/templated
// wrapper text - that's a frontend concern. A dependency-free helper so
// both the users module (public profile, GET /users/search) and the
// groups module (GET /groups/:id/followers) share one rule.
export function resolveDisplayName(
  target: Pick<User, 'firstName' | 'lastName' | 'apelido' | 'publicCode'>,
): string {
  if (target.firstName && target.lastName) {
    return `${target.firstName} ${target.lastName}`;
  }
  if (target.apelido) {
    return target.apelido;
  }
  return target.publicCode;
}
