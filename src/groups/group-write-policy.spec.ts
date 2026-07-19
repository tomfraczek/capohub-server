import { ConflictException } from '@nestjs/common';
import { GroupStatus } from './enums/group-status.enum';
import {
  assertGroupIsWritable,
  assertGroupStatusAllowed,
} from './group-write-policy';

function caught(fn: () => void): unknown {
  try {
    fn();
    return undefined;
  } catch (error) {
    return error;
  }
}

describe('assertGroupStatusAllowed', () => {
  it('does not throw when the current status is in the allow-list', () => {
    expect(() =>
      assertGroupStatusAllowed({ status: GroupStatus.READ_ONLY }, [
        GroupStatus.ACTIVE,
        GroupStatus.READ_ONLY,
      ]),
    ).not.toThrow();
  });

  it.each([
    [GroupStatus.ACTIVE, 'GROUP_ACTIVE'],
    [GroupStatus.READ_ONLY, 'GROUP_READ_ONLY'],
    [GroupStatus.ARCHIVED, 'GROUP_ARCHIVED'],
  ])(
    'throws a %s ConflictException with code %s when the status is not in the allow-list',
    (status, code) => {
      const error = caught(() =>
        assertGroupStatusAllowed({ status }, []),
      ) as ConflictException;

      expect(error).toBeInstanceOf(ConflictException);
      expect(error.getResponse()).toMatchObject({ code });
    },
  );
});

describe('assertGroupIsWritable', () => {
  it('does not throw for an ACTIVE group', () => {
    expect(() =>
      assertGroupIsWritable({ status: GroupStatus.ACTIVE }),
    ).not.toThrow();
  });

  it('throws a GROUP_READ_ONLY ConflictException for a READ_ONLY group', () => {
    const error = caught(() =>
      assertGroupIsWritable({ status: GroupStatus.READ_ONLY }),
    ) as ConflictException;

    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getResponse()).toMatchObject({ code: 'GROUP_READ_ONLY' });
  });

  it('throws a GROUP_ARCHIVED ConflictException for an ARCHIVED group', () => {
    const error = caught(() =>
      assertGroupIsWritable({ status: GroupStatus.ARCHIVED }),
    ) as ConflictException;

    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getResponse()).toMatchObject({ code: 'GROUP_ARCHIVED' });
  });
});
