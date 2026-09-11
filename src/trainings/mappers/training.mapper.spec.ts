import { PublicUrlBuilder } from '../../storage/image-url.util';
import { Section } from '../../groups/entities/section.entity';
import { GroupStatus } from '../../groups/enums/group-status.enum';
import { User } from '../../users/entities/user.entity';
import { Training } from '../entities/training.entity';
import { TrainingRsvpStatus } from '../enums/training-rsvp-status.enum';
import { TrainingStatus } from '../enums/training-status.enum';
import { TrainingVisibility } from '../enums/training-visibility.enum';
import { toTrainingResponseDto } from './training.mapper';

function buildUrlBuilder(): PublicUrlBuilder {
  return { buildPublicUrl: (key) => `https://cdn.example.com/${key}` };
}

function buildSection(overrides: Partial<Section> = {}): Section {
  const section = new Section();
  section.id = 'section-1';
  section.name = 'Capoeira Angola SP';
  section.status = GroupStatus.ACTIVE;
  return Object.assign(section, overrides);
}

function buildTraining(overrides: Partial<Training> = {}): Training {
  const training = new Training();
  training.id = 'training-1';
  training.section = buildSection();
  training.series = null;
  training.startsAt = new Date('2026-03-01T18:00:00.000Z');
  training.endsAt = new Date('2026-03-01T19:00:00.000Z');
  training.locationName = null;
  training.locationAddress = null;
  training.trainer = Object.assign(new User(), {
    id: 'trainer-1',
    displayName: 'Mestre Bimba',
  });
  training.description = null;
  training.visibility = TrainingVisibility.MEMBERS_ONLY;
  training.status = TrainingStatus.SCHEDULED;
  return Object.assign(training, overrides);
}

const CONTEXT = {
  rsvpCounts: { yes: 0, no: 0, maybe: 0 },
  viewerRsvp: null as TrainingRsvpStatus | null,
  management: null,
  capabilities: {
    canEdit: false,
    canCancel: false,
    canManageAttendance: false,
    canManagePlanNotes: false,
  },
};

describe('toTrainingResponseDto', () => {
  it('prefers the R2 public URL derived from profileImageKey over the legacy logoUrl', () => {
    const training = buildTraining({
      section: buildSection({
        logoUrl: 'https://legacy.example.com/old-logo.png',
        profileImageKey: 'sections/section-1/profile/uuid.webp',
      }),
    });

    const dto = toTrainingResponseDto(training, CONTEXT, buildUrlBuilder());

    expect(dto.section.logoUrl).toBe(
      'https://cdn.example.com/sections/section-1/profile/uuid.webp',
    );
  });

  it('falls back to the legacy logoUrl when profileImageKey is unset', () => {
    const training = buildTraining({
      section: buildSection({
        logoUrl: 'https://legacy.example.com/old-logo.png',
      }),
    });

    const dto = toTrainingResponseDto(training, CONTEXT, buildUrlBuilder());

    expect(dto.section.logoUrl).toBe('https://legacy.example.com/old-logo.png');
  });

  it('returns null when neither profileImageKey nor the legacy logoUrl is set', () => {
    const training = buildTraining({ section: buildSection() });

    const dto = toTrainingResponseDto(training, CONTEXT, buildUrlBuilder());

    expect(dto.section.logoUrl).toBeNull();
  });
});
