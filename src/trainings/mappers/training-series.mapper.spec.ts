import { PublicUrlBuilder } from '../../storage/image-url.util';
import { Section } from '../../groups/entities/section.entity';
import { GroupStatus } from '../../groups/enums/group-status.enum';
import { User } from '../../users/entities/user.entity';
import { TrainingSeries } from '../entities/training-series.entity';
import { TrainingVisibility } from '../enums/training-visibility.enum';
import { toTrainingSeriesResponseDto } from './training-series.mapper';

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

function buildSeries(overrides: Partial<TrainingSeries> = {}): TrainingSeries {
  const series = new TrainingSeries();
  series.id = 'series-1';
  series.section = buildSection();
  series.dayOfWeek = 1;
  series.startTime = '18:00';
  series.durationMinutes = 60;
  series.locationName = null;
  series.locationAddress = null;
  series.defaultTrainer = Object.assign(new User(), {
    id: 'trainer-1',
    displayName: 'mestre.bimba',
    apelido: 'Mestre Bimba',
  });
  series.defaultDescription = null;
  series.visibility = TrainingVisibility.MEMBERS_ONLY;
  series.startDate = new Date('2026-01-01T00:00:00.000Z');
  series.endDate = new Date('2026-12-31T00:00:00.000Z');
  return Object.assign(series, overrides);
}

describe('toTrainingSeriesResponseDto', () => {
  it('prefers the R2 public URL derived from profileImageKey over the legacy logoUrl', () => {
    const series = buildSeries({
      section: buildSection({
        logoUrl: 'https://legacy.example.com/old-logo.png',
        profileImageKey: 'sections/section-1/profile/uuid.webp',
      }),
    });

    const dto = toTrainingSeriesResponseDto(series, 0, buildUrlBuilder());

    expect(dto.section.logoUrl).toBe(
      'https://cdn.example.com/sections/section-1/profile/uuid.webp',
    );
  });

  it('falls back to the legacy logoUrl when profileImageKey is unset', () => {
    const series = buildSeries({
      section: buildSection({
        logoUrl: 'https://legacy.example.com/old-logo.png',
      }),
    });

    const dto = toTrainingSeriesResponseDto(series, 0, buildUrlBuilder());

    expect(dto.section.logoUrl).toBe('https://legacy.example.com/old-logo.png');
  });

  it('returns null when neither profileImageKey nor the legacy logoUrl is set', () => {
    const series = buildSeries({ section: buildSection() });

    const dto = toTrainingSeriesResponseDto(series, 0, buildUrlBuilder());

    expect(dto.section.logoUrl).toBeNull();
  });
});
