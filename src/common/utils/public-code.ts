import { randomBytes } from 'node:crypto';
import { EntityManager } from '@mikro-orm/postgresql';
import { Group } from '../../groups/entities/group.entity';
import { User } from '../../users/entities/user.entity';

// Crockford-inspired Base32 subset: digits 0-9 plus uppercase letters
// with I, L, O and U removed to avoid visual confusion with 1, 1, 0 and V
// respectively.  256 is an exact multiple of 32, so `byte % 32` distributes
// uniformly across the 32 symbols - no rejection sampling needed.
//
// Space: 32^8 = 1,099,511,627,776 ≈ 1.1 trillion combinations.
// Format: XXXX-XXXX (8 symbols, dash in the middle for readability).
const CHARSET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * Generates a random public code in XXXX-XXXX format.
 * Pure function - no DB access. Does NOT guarantee global uniqueness on its
 * own; callers that need a globally unique code must use
 * generateUniquePublicCode() instead.
 */
export function generatePublicCode(): string {
  const bytes = randomBytes(8);
  const chars = Array.from({ length: 8 }, (_, i) => CHARSET[bytes[i] % 32]);
  return `${chars.slice(0, 4).join('')}-${chars.slice(4).join('')}`;
}

/**
 * Generates a public code that does not already exist in either the `users`
 * or `groups` table (and can be extended for future entity types). Retries
 * up to 10 times on the astronomically rare collision.
 *
 * Must be called with the EntityManager that is currently active for the
 * caller's request (or transaction fork) - never `this.em` from inside an
 * already-open `em.transactional(...)` callback.
 */
export async function generateUniquePublicCode(
  em: EntityManager,
): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = generatePublicCode();
    const [existingUser, existingGroup] = await Promise.all([
      em.findOne(User, { publicCode: code }),
      em.findOne(Group, { publicCode: code }),
    ]);
    if (!existingUser && !existingGroup) {
      return code;
    }
  }

  // 10 consecutive collisions is statistically impossible (p ≈ 10^-110 for
  // 10 M total records), so reaching here indicates a serious bug or an
  // unexpectedly exhausted code space.
  throw new Error(
    'Unable to generate a unique public code after 10 attempts - ' +
      'this is a critical error and should never occur in practice.',
  );
}
