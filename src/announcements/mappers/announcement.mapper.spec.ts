import { MembershipRequestTarget } from '../../groups/enums/membership-request-target.enum';
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
  // Root Group by default (parentGroup: null) - tests that need a Section
  // pass a non-null parentGroup explicitly (see communityResourceType
  // tests below).
  announcement.community = { id: 'group-1', parentGroup: null } as never;
  announcement.author = { id: 'user-1', displayName: 'Author' } as never;
  announcement.title = 'Title';
  announcement.body = 'Body';
  announcement.recipientType = AnnouncementRecipientType.GROUP;
  announcement.recipientGroup = null;
  announcement.isPinned = false;
  announcement.expiresAt = new Date('2026-08-01T00:00:00.000Z');
  announcement.deletedAt = null;
  announcement.editedAt = null;
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
  it('sets publishedAt from createdAt, regardless of editedAt', () => {
    const announcement = buildAnnouncement({
      createdAt: new Date('2026-07-01T00:00:00.000Z'),
      updatedAt: new Date('2026-07-01T00:00:00.000Z'),
    });
    const dto = toAnnouncementResponseDto(announcement, {
      isRead: false,
      readAt: null,
    });

    expect(dto.publishedAt).toBe('2026-07-01T00:00:00.000Z');
  });

  it('reads editedAt straight from the entity field - null when never edited', () => {
    const announcement = buildAnnouncement({ editedAt: null });
    const dto = toAnnouncementResponseDto(announcement, {
      isRead: false,
      readAt: null,
    });

    expect(dto.editedAt).toBeNull();
  });

  it('reads editedAt straight from the entity field once set - never derived from updatedAt', () => {
    const announcement = buildAnnouncement({
      // updatedAt intentionally left equal to createdAt (e.g. a technical
      // touch that isn't a real content edit) - editedAt must still come
      // from its own field, not from comparing these two.
      createdAt: new Date('2026-07-01T00:00:00.000Z'),
      updatedAt: new Date('2026-07-01T00:00:00.000Z'),
      editedAt: new Date('2026-07-05T00:00:00.000Z'),
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

  it('sets communityResourceType to GROUP when the community is a root Group (parentGroup: null)', () => {
    const announcement = buildAnnouncement({
      community: { id: 'group-1', parentGroup: null } as never,
    });
    const dto = toAnnouncementResponseDto(announcement, {
      isRead: false,
      readAt: null,
    });

    expect(dto.communityResourceType).toBe(MembershipRequestTarget.GROUP);
  });

  it('sets communityResourceType to SECTION when the community has a non-null parentGroup', () => {
    const announcement = buildAnnouncement({
      community: {
        id: 'section-1',
        parentGroup: { id: 'group-1' },
      } as never,
    });
    const dto = toAnnouncementResponseDto(announcement, {
      isRead: false,
      readAt: null,
    });

    expect(dto.communityResourceType).toBe(MembershipRequestTarget.SECTION);
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
