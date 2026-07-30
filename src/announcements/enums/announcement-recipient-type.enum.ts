// Which audience an Announcement targets - immutable once published (see
// announcement.entity.ts). GROUP/SECTION mean "every currently-active
// member of the owning community itself" (the same Group/Section resolved
// from the route, see Announcement.community) - resolved dynamically,
// never snapshotted. RECIPIENT_GROUP means "whoever was a member of one
// specific Recipient Group at publish time" - snapshotted (see
// AnnouncementRecipient), since a Recipient Group's membership can change
// after the fact and an already-published Announcement's audience must
// not change with it.
export enum AnnouncementRecipientType {
  GROUP = 'GROUP',
  SECTION = 'SECTION',
  RECIPIENT_GROUP = 'RECIPIENT_GROUP',
}
