import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';

const CONTENT_MAX_LENGTH = 10000;

export const setSongNoteSchema = z.object({
  content: z.string().trim().min(1).max(CONTENT_MAX_LENGTH),
});

export class SetSongNoteDto extends createZodDto(setSongNoteSchema) {}

export type SetSongNoteInput = z.infer<typeof setSongNoteSchema>;
