import { Reflector } from '@nestjs/core';
import { GroupStatus } from '../enums/group-status.enum';
import {
  ALLOW_GROUP_STATUSES_KEY,
  AllowGroupStatuses,
} from './allow-group-statuses.decorator';

describe('AllowGroupStatuses', () => {
  it('sets the allow-group-statuses metadata to the given list', () => {
    class TestController {
      @AllowGroupStatuses(GroupStatus.ACTIVE, GroupStatus.READ_ONLY)
      handler(): void {}
    }

    const reflector = new Reflector();
    // eslint-disable-next-line @typescript-eslint/unbound-method -- used only as a metadata target, never invoked
    const handlerRef = new TestController().handler;
    const metadata = reflector.get<GroupStatus[]>(
      ALLOW_GROUP_STATUSES_KEY,
      handlerRef,
    );

    expect(metadata).toEqual([GroupStatus.ACTIVE, GroupStatus.READ_ONLY]);
  });

  it('leaves the metadata unset on an undecorated handler', () => {
    class TestController {
      handler(): void {}
    }

    const reflector = new Reflector();
    // eslint-disable-next-line @typescript-eslint/unbound-method -- used only as a metadata target, never invoked
    const handlerRef = new TestController().handler;
    const metadata = reflector.get<GroupStatus[]>(
      ALLOW_GROUP_STATUSES_KEY,
      handlerRef,
    );

    expect(metadata).toBeUndefined();
  });
});
