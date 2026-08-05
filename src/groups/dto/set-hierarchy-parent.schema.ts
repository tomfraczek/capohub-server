import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';
import { uuidSchema } from '../../songs/dto/song-validation.helpers';

// Body for attaching-or-moving a Group/Section under a new parent Group -
// see HierarchyManagementService.setGroupParent/setSectionParent. The same
// primitive covers both "attach" (no previous parent) and "move" (had a
// different parent) - GroupHierarchyService.attachChildGroup/attachSection
// already unconditionally overwrite parentGroup regardless of its previous
// value.
export const setHierarchyParentSchema = z
  .object({
    parentGroupId: uuidSchema,
  })
  .strict();

export class SetHierarchyParentDto extends createZodDto(
  setHierarchyParentSchema,
) {}

export type SetHierarchyParentInput = z.infer<typeof setHierarchyParentSchema>;
