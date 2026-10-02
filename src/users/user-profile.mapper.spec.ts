import { Collection } from '@mikro-orm/core';
import { Group } from '../groups/entities/group.entity';
import { Section } from '../groups/entities/section.entity';
import { FormalGroupAffiliation } from '../groups/entities/formal-group-affiliation.entity';
import { CustomUserRank } from '../graduation/entities/custom-user-rank.entity';
import { CustomUserRankCordSegment } from '../graduation/entities/custom-user-rank-cord-segment.entity';
import { FormalRankAssignment } from '../graduation/entities/formal-rank-assignment.entity';
import { Rank } from '../graduation/entities/rank.entity';
import { RankCordSegment } from '../graduation/entities/rank-cord-segment.entity';
import { RankTrack } from '../graduation/enums/rank-track.enum';
import { GroupRole } from '../groups/enums/group-role.enum';
import { PublicUrlBuilder } from '../storage/image-url.util';
import { User } from './entities/user.entity';
import {
  toPublicUserProfileResponseDto,
  toUserProfileResponseDto,
  toUserSearchResultDto,
} from './user-profile.mapper';

// Trivial, structural stand-in for R2StorageService - same approach every
// other mapper spec in this module uses (see image-url.util.ts's own
// PublicUrlBuilder comment).
const urlBuilder: PublicUrlBuilder = {
  buildPublicUrl: (key: string) => `https://cdn.example.com/${key}`,
};

function buildUser(overrides: Partial<User> = {}): User {
  const user = new User();
  user.id = 'user-1';
  user.clerkUserId = 'clerk-1';
  user.email = 'ada@example.com';
  user.displayName = 'Ada Real Name'; // deliberately name-like, to prove it's never reused
  user.publicCode = 'ADA00001';
  user.numericCode = '042981';
  user.firstName = null;
  user.lastName = null;
  user.apelido = null;
  user.capoeiraStartedAt = null;
  user.birthDate = null;
  user.phoneNumber = null;
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

function buildFormalRankAssignment(
  overrides: Partial<FormalRankAssignment> = {},
): FormalRankAssignment {
  const rank = new Rank();
  rank.id = 'rank-1';
  rank.name = 'Corda Verde';
  rank.track = RankTrack.ADULT;
  const segment = new RankCordSegment();
  segment.position = 0;
  segment.colorHex = '#00FF00';
  segment.proportion = 1;
  rank.cordSegments = new Collection<RankCordSegment>(rank, [segment]);

  const assignment = new FormalRankAssignment();
  assignment.rank = rank;
  assignment.sourceGroup = buildGroup();
  assignment.startedOn = new Date('2021-03-01T00:00:00.000Z');
  assignment.endedOn = null;
  Object.assign(assignment, overrides);
  return assignment;
}

function buildCustomUserRank(
  overrides: Partial<CustomUserRank> = {},
): CustomUserRank {
  const customRank = new CustomUserRank();
  customRank.name = 'Corda Independente';
  customRank.track = RankTrack.ADULT;
  const segment = new CustomUserRankCordSegment();
  segment.position = 0;
  segment.colorHex = '#654321';
  segment.proportion = 1;
  customRank.cordSegments = new Collection<CustomUserRankCordSegment>(
    customRank,
    [segment],
  );
  Object.assign(customRank, overrides);
  return customRank;
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

  it('returns the numericCode verbatim and qrPayload null - never a fabricated placeholder - when no public web domain is configured', () => {
    const dto = toUserProfileResponseDto(buildUser(), null);
    expect(dto.numericCode).toBe('042981');
    expect(dto.qrPayload).toBeNull();
  });

  it('builds a public https:// qrPayload once a web base URL is passed through', () => {
    const dto = toUserProfileResponseDto(
      buildUser(),
      null,
      'https://capohub.pl',
    );
    expect(dto.qrPayload).toBe('https://capohub.pl/u/042981');
  });

  it('computes profileComplete=true once both names are set', () => {
    const dto = toUserProfileResponseDto(
      buildUser({ firstName: 'Ada', lastName: 'Lovelace' }),
      null,
    );
    expect(dto.profileComplete).toBe(true);
  });

  it('maps the private birthDate/phoneNumber on the own profile', () => {
    const dto = toUserProfileResponseDto(
      buildUser({
        birthDate: new Date('1990-03-15'),
        phoneNumber: '+48 600 100 200',
      }),
      null,
    );
    expect(dto.birthDate).toBe('1990-03-15');
    expect(dto.phoneNumber).toBe('+48 600 100 200');

    const empty = toUserProfileResponseDto(buildUser(), null);
    expect(empty.birthDate).toBeNull();
    expect(empty.phoneNumber).toBeNull();
  });

  it('reflects every privacy toggle verbatim - and has none for name/apelido', () => {
    const dto = toUserProfileResponseDto(
      buildUser({ showSections: true }),
      null,
    );
    expect(dto.privacy).toEqual({
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
    canSeeCapoeiraStartedAt: false,
    sections: null,
    sectionRoles: new Map<string, GroupRole[]>(),
    formalGroup: null,
    formalRank: null,
    independentRank: null,
    urlBuilder,
  };

  it('never reuses User.displayName, even though it could contain a real name', () => {
    const dto = toPublicUserProfileResponseDto(buildUser(), baseCtx);
    expect(dto.displayName).not.toBe('Ada Real Name');
  });

  it('always includes the avatar, unconditionally - never privacy-gated', () => {
    const dto = toPublicUserProfileResponseDto(
      buildUser({ presetAvatarId: 'avatar-01' }),
      baseCtx,
    );
    expect(dto.avatarType).toBe('CLERK');
    expect(dto.presetAvatarId).toBe('avatar-01');
  });

  it('always shows first name, last name and apelido - identity has no privacy toggle', () => {
    const user = buildUser({
      firstName: 'Ada',
      lastName: 'Lovelace',
      apelido: 'Formiga',
    });

    const dto = toPublicUserProfileResponseDto(user, baseCtx);

    expect(dto.displayName).toBe('Ada Lovelace');
    expect(dto.firstName).toBe('Ada');
    expect(dto.lastName).toBe('Lovelace');
    expect(dto.apelido).toBe('Formiga');
  });

  it('returns each name part as stored even when the other one is missing', () => {
    const dto = toPublicUserProfileResponseDto(
      buildUser({ firstName: 'Ada', lastName: null }),
      baseCtx,
    );
    expect(dto.firstName).toBe('Ada');
    expect(dto.lastName).toBeNull();
  });

  it('labels with apelido when no full name is set', () => {
    const dto = toPublicUserProfileResponseDto(
      buildUser({ apelido: 'Formiga' }),
      baseCtx,
    );
    expect(dto.displayName).toBe('Formiga');
  });

  it('falls back to the raw publicCode only when no name or apelido exists at all', () => {
    const dto = toPublicUserProfileResponseDto(buildUser(), baseCtx);
    expect(dto.displayName).toBe('ADA00001');
  });

  it('maps sections to id/name/logoUrl/roles, and formalGroup to id+name', () => {
    const dto = toPublicUserProfileResponseDto(buildUser(), {
      ...baseCtx,
      sections: [buildSection({ profileImageKey: 'sections/section-1.png' })],
      sectionRoles: new Map([
        ['section-1', [GroupRole.MEMBER, GroupRole.INSTRUCTOR]],
      ]),
      formalGroup: buildFormalGroupAffiliation(),
    });
    expect(dto.sections).toEqual([
      {
        id: 'section-1',
        name: 'Downtown Section',
        logoUrl: 'https://cdn.example.com/sections/section-1.png',
        // MEMBER is filtered out - it carries no information a viewer
        // doesn't already have from the section merely being listed.
        roles: [GroupRole.INSTRUCTOR],
      },
    ]);
    expect(dto.formalGroup).toEqual({ id: 'group-1', name: 'Cordao de Ouro' });
  });

  // The original, reversed design decision's actual concern (leaking who
  // holds administrative power over a Section) still fully applies to
  // OWNER/ADMIN - only INSTRUCTOR/ASSISTANT are capoeira-representative
  // enough to ever reach a profile.
  it("never includes OWNER/ADMIN in a section's public roles, even when the target genuinely holds them", () => {
    const dto = toPublicUserProfileResponseDto(buildUser(), {
      ...baseCtx,
      sections: [buildSection()],
      sectionRoles: new Map([
        ['section-1', [GroupRole.MEMBER, GroupRole.OWNER, GroupRole.ADMIN]],
      ]),
    });
    expect(dto.sections?.[0].roles).toEqual([]);
  });

  it('defaults a section missing from sectionRoles to an empty roles array, never throws', () => {
    const dto = toPublicUserProfileResponseDto(buildUser(), {
      ...baseCtx,
      sections: [buildSection()],
    });
    expect(dto.sections).toEqual([
      { id: 'section-1', name: 'Downtown Section', logoUrl: null, roles: [] },
    ]);
  });

  it('leaves sections/formalGroup/formalRank/independentRank null when not visible, distinct from an empty list', () => {
    const dto = toPublicUserProfileResponseDto(buildUser(), baseCtx);
    expect(dto.sections).toBeNull();
    expect(dto.formalGroup).toBeNull();
    expect(dto.formalRank).toBeNull();
    expect(dto.independentRank).toBeNull();
  });

  it('maps a visible formal rank to name/cordSegments/sourceGroup/startedOn only', () => {
    const dto = toPublicUserProfileResponseDto(buildUser(), {
      ...baseCtx,
      formalRank: buildFormalRankAssignment(),
    });
    expect(dto.formalRank).toEqual({
      name: 'Corda Verde',
      cordSegments: [{ position: 0, colorHex: '#00FF00', proportion: 1 }],
      sourceGroup: { id: 'group-1', name: 'Cordao de Ouro' },
      startedOn: '2021-03-01',
    });
  });

  it('maps a formal rank with no sourceGroup to sourceGroup: null', () => {
    const dto = toPublicUserProfileResponseDto(buildUser(), {
      ...baseCtx,
      formalRank: buildFormalRankAssignment({
        sourceGroup: undefined as never,
      }),
    });
    expect(dto.formalRank?.sourceGroup).toBeNull();
  });

  it('maps a visible independentRank to name/track/cordSegments only - no id/description/timestamps', () => {
    const dto = toPublicUserProfileResponseDto(buildUser(), {
      ...baseCtx,
      independentRank: buildCustomUserRank(),
    });
    expect(dto.independentRank).toEqual({
      name: 'Corda Independente',
      track: RankTrack.ADULT,
      cordSegments: [{ position: 0, colorHex: '#654321', proportion: 1 }],
    });
  });
});

describe('toUserSearchResultDto', () => {
  it('never reuses User.displayName, even though it could contain a real name', () => {
    const dto = toUserSearchResultDto(buildUser());
    expect(dto.displayName).not.toBe('Ada Real Name');
    expect(dto.displayName).toBe('ADA00001');
  });

  it('shows the full name whenever both parts are set - never the code instead', () => {
    const user = buildUser({ firstName: 'Ada', lastName: 'Lovelace' });
    expect(toUserSearchResultDto(user).displayName).toBe('Ada Lovelace');
  });

  it('falls back to apelido when no full name is set', () => {
    const user = buildUser({ apelido: 'Formiga' });
    expect(toUserSearchResultDto(user).displayName).toBe('Formiga');
  });

  it('always includes id and numericCode, and never private fields', () => {
    const dto = toUserSearchResultDto(buildUser());
    expect(dto.id).toBe('user-1');
    expect(dto.numericCode).toBe('042981');
    expect(Object.keys(dto).sort()).toEqual([
      'displayName',
      'id',
      'numericCode',
    ]);
  });
});
