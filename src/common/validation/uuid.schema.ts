import { z } from 'zod';

// Shared across modules (groups, events, rhythms, announcements, songs, ...)
// that accept a UUID path/body param - kept in this neutral module so none
// of them has to reach into another feature module just for this primitive.
export const uuidSchema = z.string().trim().uuid('Must be a valid UUID');
