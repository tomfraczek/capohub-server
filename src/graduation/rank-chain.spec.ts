import { buildNextIdById, orderChain, wouldCreateCycle } from './rank-chain';

describe('rank-chain', () => {
  describe('orderChain', () => {
    it('orders a chain purely by previousRankId, regardless of input order', () => {
      const nodes = [
        { id: 'c', previousRankId: 'b' },
        { id: 'a', previousRankId: null },
        { id: 'b', previousRankId: 'a' },
      ];

      expect(orderChain(nodes).map((n) => n.id)).toEqual(['a', 'b', 'c']);
    });

    it('returns an empty array for an empty track', () => {
      expect(orderChain([])).toEqual([]);
    });

    it('returns the single node when it is the only (first) rank', () => {
      const nodes = [{ id: 'a', previousRankId: null }];
      expect(orderChain(nodes).map((n) => n.id)).toEqual(['a']);
    });

    it('appends unreachable nodes rather than dropping them', () => {
      // Defensive case: should never happen given RanksService's write-time
      // invariants, but a corrupt/orphaned chain must not silently lose data.
      const nodes = [
        { id: 'a', previousRankId: null },
        { id: 'orphan', previousRankId: 'missing' },
      ];
      const ordered = orderChain(nodes).map((n) => n.id);
      expect(ordered).toContain('a');
      expect(ordered).toContain('orphan');
      expect(ordered).toHaveLength(2);
    });
  });

  describe('buildNextIdById', () => {
    it('maps each rank to its direct successor id, and the last rank to null', () => {
      const nodes = [
        { id: 'a', previousRankId: null },
        { id: 'b', previousRankId: 'a' },
        { id: 'c', previousRankId: 'b' },
      ];

      const nextById = buildNextIdById(nodes);
      expect(nextById.get('a')).toBe('b');
      expect(nextById.get('b')).toBe('c');
      expect(nextById.get('c')).toBeNull();
    });
  });

  describe('wouldCreateCycle', () => {
    it('is false when previousRankId is null', () => {
      expect(wouldCreateCycle('a', null, new Map())).toBe(false);
    });

    it('is true when a rank is pointed at itself', () => {
      expect(wouldCreateCycle('a', 'a', new Map())).toBe(true);
    });

    it('is true when the candidate previousRank is a descendant of the rank being moved', () => {
      // a -> b -> c ; moving `a` to point at `c` would close a loop
      // (a -> b -> c -> a).
      const previousRankIdById = new Map<string, string | null>([
        ['a', null],
        ['b', 'a'],
        ['c', 'b'],
      ]);
      expect(wouldCreateCycle('a', 'c', previousRankIdById)).toBe(true);
    });

    it('is false for a legitimate move to a non-descendant rank', () => {
      const previousRankIdById = new Map<string, string | null>([
        ['a', null],
        ['b', 'a'],
        ['c', 'b'],
        ['d', null],
      ]);
      expect(wouldCreateCycle('b', 'd', previousRankIdById)).toBe(false);
    });

    it('is false for a brand-new rank (id null) pointing at any existing rank', () => {
      const previousRankIdById = new Map<string, string | null>([
        ['a', null],
        ['b', 'a'],
      ]);
      expect(wouldCreateCycle(null, 'b', previousRankIdById)).toBe(false);
    });
  });
});
