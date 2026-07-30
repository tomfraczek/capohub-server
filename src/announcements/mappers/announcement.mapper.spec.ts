import { Announcement } from '../entities/announcement.entity';
import { AnnouncementRecipientType } from '../enums/announcement-recipient-type.enum';
import {
  isAnnouncementActive,
  toAnnouncementResponseDto,
} from './announcement.mapper';

function buildAnnouncement(
  overrides: Partial<Announcement> = {},
): Announcement {
  const announcement = new Announcement();
  announcement.id = 'announcement-1';
  announcement.community = { id: 'group-1' } as never;
  announcement.author = { id: 'user-1', displayName: 'Author' } as never;
  announcement.title = 'Title';
  announcement.body = 'Body';
  announcement.recipientType = AnnouncementRecipientType.GROUP;
  announcement.recipientGroup = null;
  announcement.isPinned = false;
  announcement.expiresAt = new Date('2026-08-01T00:00:00.000Z');
  announcement.createdAt = new Date('2026-07-01T00:00:00.000Z');
  announcement.updatedAt = new Date('2026-07-01T00:00:00.000Z');
  return Object.assign(announcement, overrides);
}

describe('isAnnouncementActive', () => {
  it('is true when expiresAt is in the future', () => {
    const announcement = buildAnnouncement({
      expiresAt: new Date('2026-08-01T00:00:00.000Z'),
    });
    expect(
      isAnnouncementActive(announcement, new Date('2026-07-15T00:00:00.000Z')),
    ).toBe(true);
  });

  it('is false once expiresAt has passed, even a moment after', () => {
    const announcement = buildAnnouncement({
      expiresAt: new Date('2026-08-01T00:00:00.000Z'),
    });
    expect(
      isAnnouncementActive(announcement, new Date('2026-08-01T00:00:00.001Z')),
    ).toBe(false);
  });
});

describe('toAnnouncementResponseDto', () => {
  it('sets publishedAt from createdAt and editedAt to null when never edited', () => {
    const announcement = buildAnnouncement({
      createdAt: new Date('2026-07-01T00:00:00.000Z'),
      updatedAt: new Date('2026-07-01T00:00:00.000Z'),
    });
    const dto = toAnnouncementResponseDto(announcement, {
      isRead: false,
      readAt: null,
    });

    expect(dto.publishedAt).toBe('2026-07-01T00:00:00.000Z');
    expect(dto.editedAt).toBeNull();
  });

  it('sets editedAt to updatedAt once it differs from createdAt', () => {
    const announcement = buildAnnouncement({
      createdAt: new Date('2026-07-01T00:00:00.000Z'),
      updatedAt: new Date('2026-07-05T00:00:00.000Z'),
    });
    const dto = toAnnouncementResponseDto(announcement, {
      isRead: false,
      readAt: null,
    });

    expect(dto.editedAt).toBe('2026-07-05T00:00:00.000Z');
  });

  it('carries isRead/readAt through exactly as given', () => {
    const announcement = buildAnnouncement();
    const readAt = new Date('2026-07-02T00:00:00.000Z');
    const dto = toAnnouncementResponseDto(announcement, {
      isRead: true,
      readAt,
    });

    expect(dto.isRead).toBe(true);
    expect(dto.readAt).toBe('2026-07-02T00:00:00.000Z');
  });

  it('only sets recipientGroupId when a Recipient Group is actually attached', () => {
    const withoutGroup = buildAnnouncement({ recipientGroup: null });
    const withGroup = buildAnnouncement({
      recipientType: AnnouncementRecipientType.RECIPIENT_GROUP,
      recipientGroup: { id: 'recipient-group-1' } as never,
    });

    expect(
      toAnnouncementResponseDto(withoutGroup, { isRead: false, readAt: null })
        .recipientGroupId,
    ).toBeNull();
    expect(
      toAnnouncementResponseDto(withGroup, { isRead: false, readAt: null })
        .recipientGroupId,
    ).toBe('recipient-group-1');
  });

  it('maps author to a minimal ref, or null when the author account is gone', () => {
    const withAuthor = buildAnnouncement();
    const withoutAuthor = buildAnnouncement({ author: null });

    expect(
      toAnnouncementResponseDto(withAuthor, { isRead: false, readAt: null })
        .author,
    ).toEqual({ id: 'user-1', displayName: 'Author' });
    expect(
      toAnnouncementResponseDto(withoutAuthor, {
        isRead: false,
        readAt: null,
      }).author,
    ).toBeNull();
  });
});
