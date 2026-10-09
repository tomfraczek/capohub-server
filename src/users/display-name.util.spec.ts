import {
  DisplayNameSource,
  resolveDisplayName,
  resolveDisplayNameVariants,
  resolveFullName,
} from './display-name.util';
import { User } from './entities/user.entity';
import { DisplayNameMode } from './enums/display-name-mode.enum';

function buildSource(
  overrides: Partial<DisplayNameSource> = {},
): DisplayNameSource {
  return {
    firstName: 'Tomasz',
    lastName: 'Frączek',
    apelido: 'Lagarto',
    publicCode: 'U000001',
    displayNameMode: DisplayNameMode.FULL_NAME,
    currentRankTitle: 'Graduado',
    showFormalRank: true,
    ...overrides,
  };
}

describe('resolveDisplayName', () => {
  describe('FULL_NAME', () => {
    it('shows the full first + last name, never just the first name', () => {
      expect(resolveDisplayName(buildSource())).toBe('Tomasz Frączek');
    });

    it('ignores the rank title and apelido while a full name exists', () => {
      expect(
        resolveDisplayName(buildSource({ currentRankTitle: 'Mestre' })),
      ).toBe('Tomasz Frączek');
    });

    it('keeps the existing fallbacks: apelido, then publicCode', () => {
      expect(
        resolveDisplayName(buildSource({ firstName: null, lastName: null })),
      ).toBe('Lagarto');
      expect(
        resolveDisplayName(
          buildSource({ firstName: null, lastName: null, apelido: null }),
        ),
      ).toBe('U000001');
    });
  });

  describe('default preference', () => {
    it('treats a source with no displayNameMode as FULL_NAME', () => {
      expect(
        resolveDisplayName(buildSource({ displayNameMode: undefined })),
      ).toBe('Tomasz Frączek');
    });

    it('defaults a new User entity to FULL_NAME', () => {
      const user = new User();
      expect(user.displayNameMode).toBe(DisplayNameMode.FULL_NAME);
      Object.assign(user, {
        firstName: 'Tomasz',
        lastName: 'Frączek',
        apelido: 'Lagarto',
        currentRankTitle: 'Graduado',
      });
      expect(resolveDisplayName(user)).toBe('Tomasz Frączek');
    });
  });

  describe('TITLE_APELIDO', () => {
    const titled = (overrides: Partial<DisplayNameSource> = {}) =>
      buildSource({
        displayNameMode: DisplayNameMode.TITLE_APELIDO,
        ...overrides,
      });

    it('shows the current rank title + apelido', () => {
      expect(resolveDisplayName(titled())).toBe('Graduado Lagarto');
    });

    // currentRankTitle is source-agnostic: the @Formula resolves it from
    // the active FormalRankAssignment or else the active independent
    // CustomUserRank (covered against a real DB in
    // test/display-name-mode.e2e-spec.ts) - both read the same here.
    it.each([
      ['a formal rank', 'Professor'],
      ['an independent rank', 'Corda Verde'],
    ])('uses the title of %s verbatim', (_label, title) => {
      expect(resolveDisplayName(titled({ currentRankTitle: title }))).toBe(
        `${title} Lagarto`,
      );
    });

    it('follows the current rank - a promotion changes the name with nothing else stored', () => {
      const source = titled({ currentRankTitle: 'Graduado' });
      expect(resolveDisplayName(source)).toBe('Graduado Lagarto');
      source.currentRankTitle = 'Instrutor';
      expect(resolveDisplayName(source)).toBe('Instrutor Lagarto');
    });

    it('shows just the apelido when there is no rank title', () => {
      expect(resolveDisplayName(titled({ currentRankTitle: null }))).toBe(
        'Lagarto',
      );
      expect(resolveDisplayName(titled({ currentRankTitle: undefined }))).toBe(
        'Lagarto',
      );
      expect(resolveDisplayName(titled({ currentRankTitle: '  ' }))).toBe(
        'Lagarto',
      );
    });

    it('never shows a title the user hides with showFormalRank', () => {
      expect(resolveDisplayName(titled({ showFormalRank: false }))).toBe(
        'Lagarto',
      );
    });

    it('falls back to the full name when there is no apelido', () => {
      expect(resolveDisplayName(titled({ apelido: null }))).toBe(
        'Tomasz Frączek',
      );
    });

    it('falls back through FULL_NAME rules when neither apelido nor name exist', () => {
      expect(
        resolveDisplayName(
          titled({ apelido: null, firstName: null, lastName: null }),
        ),
      ).toBe('U000001');
    });
  });
});

describe('resolveDisplayNameVariants', () => {
  it('returns both variants by the exact resolveDisplayName rules, whatever the stored mode', () => {
    for (const mode of Object.values(DisplayNameMode)) {
      expect(
        resolveDisplayNameVariants(buildSource({ displayNameMode: mode })),
      ).toEqual({
        FULL_NAME: 'Tomasz Frączek',
        TITLE_APELIDO: 'Graduado Lagarto',
      });
    }
  });

  it('reflects the fallbacks in the TITLE_APELIDO variant', () => {
    expect(
      resolveDisplayNameVariants(buildSource({ apelido: null })).TITLE_APELIDO,
    ).toBe('Tomasz Frączek');
  });
});

describe('resolveFullName', () => {
  it('ignores TITLE_APELIDO - used only by the full profile screen', () => {
    expect(
      resolveFullName(
        buildSource({ displayNameMode: DisplayNameMode.TITLE_APELIDO }),
      ),
    ).toBe('Tomasz Frączek');
  });
});
