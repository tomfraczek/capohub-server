import { Group } from '../groups/entities/group.entity';
import { Section } from '../groups/entities/section.entity';
import { FormalGroupAffiliation } from '../groups/entities/formal-group-affiliation.entity';
import { User } from './entities/user.entity';
import {
  toPublicUserProfileResponseDto,
  toUserProfileResponseDto,
} from './user-profile.mapper';

function buildUser(overrides: Partial<User> = {}): User {
  const user = new User();
  user.id = 'user-1';
  user.clerkUserId = 'clerk-1';
  user.email = 'ada@example.com';
  user.displayName = 'Ada Real Name'; // deliberately name-like, to prove it's never reused
  user.publicCode = 'ADA00001';
  user.firstName = null;
  user.lastName = null;
  user.apelido = null;
  user.city = null;
  user.country = null;
  user.capoeiraStartedAt = null;
  user.showFullName = false;
  user.showApelido = false;
  user.showLocation = false;
  user.showCapoeiraStartedAt = false;
  user.showSections = false;
  user.showFormalGroup = false;
  user.showFormalRank = false;
  user.showCareerTimeline = false;
  user.showEventParticipation = false;
  Object.assign(user, overrides);
  return user;
}

function buildGroup(overrides: Partial<Group> = {}): Group {
  const group = new Group();
  group.id = 'group-1';
  group.name = 'Cordao de Ouro';
  Object.assign(group, overrides);
  return group;
}

function buildSection(overrides: Partial<Section> = {}): Section {
  const section = new Section();
  section.id = 'section-1';
  section.name = 'Downtown Section';
  Object.assign(section, overrides);
  return section;
}

function buildFormalGroupAffiliation(
  overrides: Partial<FormalGroupAffiliation> = {},
): FormalGroupAffiliation {
  const affiliation = new FormalGroupAffiliation();
  affiliation.group = buildGroup();
  affiliation.startedOn = new Date('2020-01-01T00:00:00.000Z');
  affiliation.endedOn = null;
  Object.assign(affiliation, overrides);
  return affiliation;
}

describe('toUserProfileResponseDto', () => {
  it('computes profileComplete=false when either name is missing', () => {
    expect(
      toUserProfileResponseDto(buildUser({ firstName: 'Ada' }), null)
        .profileComplete,
    ).toBe(false);
    expect(
      toUserProfileResponseDto(buildUser({ lastName: 'Lovelace' }), null)
        .profileComplete,
    ).toBe(false);
    expect(toUserProfileResponseDto(buildUser(), null).profileComplete).toBe(
      false,
    );
  });

  it('computes profileComplete=true once both names are set', () => {
    const dto = toUserProfileResponseDto(
      buildUser({ firstName: 'Ada', lastName: 'Lovelace' }),
      null,
    );
    expect(dto.profileComplete).toBe(true);
  });

  it('reflects every privacy toggle verbatim, unfiltered for the owner', () => {
    const dto = toUserProfileResponseDto(
      buildUser({ showFullName: true, showSections: true }),
      null,
    );
    expect(dto.privacy).toEqual({
      showFullName: true,
      showApelido: false,
      showLocation: false,
      showCapoeiraStartedAt: false,
      showSections: true,
      showFormalGroup: false,
      showFormalRank: false,
      showCareerTimeline: false,
      showEventParticipation: false,
    });
  });

  it('maps the active formal group with its real-world dates, null when none', () => {
    expect(toUserProfileResponseDto(buildUser(), null).formalGroup).toBeNull();

    const affiliation = buildFormalGroupAffiliation({
      endedOn: new Date('2022-06-15T00:00:00.000Z'),
    });
    const dto = toUserProfileResponseDto(buildUser(), affiliation);
    expect(dto.formalGroup).toEqual({
      groupId: 'group-1',
      name: 'Cordao de Ouro',
      startedOn: '2020-01-01',
      endedOn: '2022-06-15',
    });
  });
});

describe('toPublicUserProfileResponseDto', () => {
  const baseCtx = {
    canSeeFullName: false,
    canSeeApelido: false,
    canSeeLocation: false,
    canSeeCapoeiraStartedAt: false,
    sections: null,
    formalGroup: null,
  };

  it('never reuses User.displayName, even though it could contain a real name', () => {
    const dto = toPublicUserProfileResponseDto(buildUser(), baseCtx);
    expect(dto.displayName).not.toBe('Ada Real Name');
  });

  it('shows the full name only when visible and both parts are set', () => {
    const user = buildUser({ firstName: 'Ada', lastName: 'Lovelace' });

    const visible = toPublicUserProfileResponseDto(user, {
      ...baseCtx,
      canSeeFullName: true,
    });
    expect(visible.displayName).toBe('Ada Lovelace');
    expect(visible.firstName).toBe('Ada');
    expect(visible.lastName).toBe('Lovelace');

    const hidden = toPublicUserProfileResponseDto(user, baseCtx);
    expect(hidden.displayName).not.toBe('Ada Lovelace');
    expect(hidden.firstName).toBeNull();
    expect(hidden.lastName).toBeNull();
  });

  it('does not treat the name as known when visible but never actually filled in', () => {
    const user = buildUser({ firstName: 'Ada', lastName: null });
    const dto = toPublicUserProfileResponseDto(user, {
      ...baseCtx,
      canSeeFullName: true,
    });
    expect(dto.firstName).toBeNull();
    expect(dto.lastName).toBeNull();
  });

  it('falls back to apelido when the name is hidden but apelido is visible', () => {
    const user = buildUser({
      firstName: 'Ada',
      lastName: 'Lovelace',
      apelido: 'Formiga',
    });
    const dto = toPublicUserProfileResponseDto(user, {
      ...baseCtx,
      canSeeApelido: true,
    });
    expect(dto.displayName).toBe('Formiga');
    expect(dto.apelido).toBe('Formiga');
  });

  it('falls back to the raw publicCode, with no localized prefix, when both are hidden', () => {
    const user = buildUser({
      firstName: 'Ada',
      lastName: 'Lovelace',
      apelido: 'Formiga',
    });
    const dto = toPublicUserProfileResponseDto(user, baseCtx);
    expect(dto.displayName).toBe('ADA00001');
    expect(dto.apelido).toBeNull();
  });

  it('gates city and country together behind showLocation', () => {
    const user = buildUser({ city: 'Recife', country: 'BR' });

    const hidden = toPublicUserProfileResponseDto(user, baseCtx);
    expect(hidden.city).toBeNull();
    expect(hidden.country).toBeNull();

    const visible = toPublicUserProfileResponseDto(user, {
      ...baseCtx,
      canSeeLocation: true,
    });
    expect(visible.city).toBe('Recife');
    expect(visible.country).toBe('BR');
  });

  it('maps sections/formalGroup to id+name refs only, never role/status data', () => {
    const dto = toPublicUserProfileResponseDto(buildUser(), {
      ...baseCtx,
      sections: [buildSection()],
      formalGroup: buildFormalGroupAffiliation(),
    });
    expect(dto.sections).toEqual([
      { id: 'section-1', name: 'Downtown Section' },
    ]);
    expect(dto.formalGroup).toEqual({ id: 'group-1', name: 'Cordao de Ouro' });
  });

  it('leaves sections/formalGroup null when not visible, distinct from an empty list', () => {
    const dto = toPublicUserProfileResponseDto(buildUser(), baseCtx);
    expect(dto.sections).toBeNull();
    expect(dto.formalGroup).toBeNull();
  });
});
