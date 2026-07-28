import { ConflictException } from '@nestjs/common';
import type { EntityManager } from '@mikro-orm/postgresql';
import { Event } from './entities/event.entity';
import { EventStatus } from './enums/event-status.enum';
import {
  assertEventStatusAllowed,
  reconcileEventFinished,
} from './event-write-policy';

function buildEvent(overrides: Partial<Event> = {}): Event {
  const event = new Event();
  event.id = 'event-1';
  event.status = EventStatus.PUBLISHED;
  event.startsAt = new Date('2026-01-01T10:00:00.000Z');
  event.endsAt = new Date('2026-01-01T18:00:00.000Z');
  return Object.assign(event, overrides);
}

describe('assertEventStatusAllowed', () => {
  it('does not throw when the current status is allowed', () => {
    const event = buildEvent({ status: EventStatus.DRAFT });
    expect(() =>
      assertEventStatusAllowed(event, [
        EventStatus.DRAFT,
        EventStatus.PUBLISHED,
      ]),
    ).not.toThrow();
  });

  it('throws a status-specific ConflictException when not allowed', () => {
    const event = buildEvent({ status: EventStatus.CANCELLED });
    expect(() =>
      assertEventStatusAllowed(event, [EventStatus.PUBLISHED]),
    ).toThrow(ConflictException);
    try {
      assertEventStatusAllowed(event, [EventStatus.PUBLISHED]);
      fail('expected to throw');
    } catch (error) {
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'EVENT_CANCELLED',
      });
    }
  });

  it.each([
    [EventStatus.DRAFT, 'EVENT_DRAFT'],
    [EventStatus.PUBLISHED, 'EVENT_PUBLISHED'],
    [EventStatus.CANCELLED, 'EVENT_CANCELLED'],
    [EventStatus.FINISHED, 'EVENT_FINISHED'],
  ])('maps status %s to code %s', (status, code) => {
    const event = buildEvent({ status });
    try {
      assertEventStatusAllowed(event, []);
      fail('expected to throw');
    } catch (error) {
      expect((error as ConflictException).getResponse()).toMatchObject({
        code,
      });
    }
  });
});

describe('reconcileEventFinished', () => {
  function buildEm() {
    const persist = jest
      .fn<
        { flush: jest.Mock },
        [{ fromStatus: EventStatus; toStatus: EventStatus; actor: unknown }]
      >()
      .mockReturnValue({ flush: jest.fn().mockResolvedValue(undefined) });
    return { em: { persist } as unknown as EntityManager, persist };
  }

  it('is a no-op when status is not PUBLISHED', async () => {
    const { em, persist } = buildEm();
    const event = buildEvent({
      status: EventStatus.DRAFT,
      endsAt: new Date('2020-01-01'),
    });

    await reconcileEventFinished(em, event);

    expect(event.status).toBe(EventStatus.DRAFT);
    expect(persist).not.toHaveBeenCalled();
  });

  it('is a no-op when endsAt has not yet passed', async () => {
    const { em, persist } = buildEm();
    const future = new Date(Date.now() + 60_000);
    const event = buildEvent({ status: EventStatus.PUBLISHED, endsAt: future });

    await reconcileEventFinished(em, event);

    expect(event.status).toBe(EventStatus.PUBLISHED);
    expect(persist).not.toHaveBeenCalled();
  });

  it('transitions PUBLISHED to FINISHED once endsAt has passed, with no actor', async () => {
    const { em, persist } = buildEm();
    const past = new Date(Date.now() - 60_000);
    const event = buildEvent({ status: EventStatus.PUBLISHED, endsAt: past });

    await reconcileEventFinished(em, event);

    expect(event.status).toBe(EventStatus.FINISHED);
    expect(persist).toHaveBeenCalledTimes(1);
    const historyRow = persist.mock.calls[0][0];
    expect(historyRow.fromStatus).toBe(EventStatus.PUBLISHED);
    expect(historyRow.toStatus).toBe(EventStatus.FINISHED);
    expect(historyRow.actor).toBeNull();
  });
});
