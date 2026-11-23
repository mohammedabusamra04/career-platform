import { describe, it, expect } from 'vitest';
import {
  UserStatus,
  canTransition,
  assertValidTransition,
  isUserEligibleForDigest,
  InvalidStateTransitionError,
} from '../../../src/modules/users/index.js';

describe('User Lifecycle State Machine', () => {
  describe('canTransition & assertValidTransition', () => {
    it('allows valid transitions from ACTIVE', () => {
      expect(canTransition(UserStatus.ACTIVE, UserStatus.ACTIVE)).toBe(true);
      expect(canTransition(UserStatus.ACTIVE, UserStatus.PAUSED)).toBe(true);
      expect(canTransition(UserStatus.ACTIVE, UserStatus.BLOCKED)).toBe(true);
      expect(canTransition(UserStatus.ACTIVE, UserStatus.DELETED)).toBe(true);

      expect(() => assertValidTransition(UserStatus.ACTIVE, UserStatus.PAUSED)).not.toThrow();
    });

    it('allows valid transitions from PAUSED', () => {
      expect(canTransition(UserStatus.PAUSED, UserStatus.ACTIVE)).toBe(true);
      expect(canTransition(UserStatus.PAUSED, UserStatus.PAUSED)).toBe(true);
      expect(canTransition(UserStatus.PAUSED, UserStatus.BLOCKED)).toBe(true);
      expect(canTransition(UserStatus.PAUSED, UserStatus.DELETED)).toBe(true);

      expect(() => assertValidTransition(UserStatus.PAUSED, UserStatus.ACTIVE)).not.toThrow();
    });

    it('allows valid transitions from BLOCKED and forbids invalid transitions', () => {
      expect(canTransition(UserStatus.BLOCKED, UserStatus.ACTIVE)).toBe(true);
      expect(canTransition(UserStatus.BLOCKED, UserStatus.DELETED)).toBe(true);
      expect(canTransition(UserStatus.BLOCKED, UserStatus.BLOCKED)).toBe(true);

      // Illegal: cannot go from BLOCKED to PAUSED directly
      expect(canTransition(UserStatus.BLOCKED, UserStatus.PAUSED)).toBe(false);
      expect(() => assertValidTransition(UserStatus.BLOCKED, UserStatus.PAUSED)).toThrow(
        InvalidStateTransitionError,
      );
    });

    it('allows reactivation from DELETED and forbids other transitions', () => {
      expect(canTransition(UserStatus.DELETED, UserStatus.ACTIVE)).toBe(true);
      expect(canTransition(UserStatus.DELETED, UserStatus.DELETED)).toBe(true);

      // Illegal: cannot go from DELETED to PAUSED or BLOCKED directly
      expect(canTransition(UserStatus.DELETED, UserStatus.PAUSED)).toBe(false);
      expect(() => assertValidTransition(UserStatus.DELETED, UserStatus.PAUSED)).toThrow(
        InvalidStateTransitionError,
      );
      expect(canTransition(UserStatus.DELETED, UserStatus.BLOCKED)).toBe(false);
      expect(() => assertValidTransition(UserStatus.DELETED, UserStatus.BLOCKED)).toThrow(
        InvalidStateTransitionError,
      );
    });
  });

  describe('isUserEligibleForDigest', () => {
    const fixedNow = new Date('2026-10-25T12:00:00Z');

    it('returns true for ACTIVE users', () => {
      expect(
        isUserEligibleForDigest(
          { status: UserStatus.ACTIVE, pausedUntil: null },
          fixedNow,
        ),
      ).toBe(true);
    });

    it('returns false for BLOCKED users', () => {
      expect(
        isUserEligibleForDigest(
          { status: UserStatus.BLOCKED, pausedUntil: null },
          fixedNow,
        ),
      ).toBe(false);
    });

    it('returns false for DELETED users', () => {
      expect(
        isUserEligibleForDigest(
          { status: UserStatus.DELETED, pausedUntil: null },
          fixedNow,
        ),
      ).toBe(false);
    });

    it('returns false for PAUSED user when pausedUntil is null (indefinite pause)', () => {
      expect(
        isUserEligibleForDigest(
          { status: UserStatus.PAUSED, pausedUntil: null },
          fixedNow,
        ),
      ).toBe(false);
    });

    it('returns false for PAUSED user when pausedUntil is in the future', () => {
      const futureDate = new Date('2026-10-25T14:00:00Z');
      expect(
        isUserEligibleForDigest(
          { status: UserStatus.PAUSED, pausedUntil: futureDate },
          fixedNow,
        ),
      ).toBe(false);
    });

    it('returns true for PAUSED user when pausedUntil has elapsed (in the past or now)', () => {
      const pastDate = new Date('2026-10-25T10:00:00Z');
      expect(
        isUserEligibleForDigest(
          { status: UserStatus.PAUSED, pausedUntil: pastDate },
          fixedNow,
        ),
      ).toBe(true);

      expect(
        isUserEligibleForDigest(
          { status: UserStatus.PAUSED, pausedUntil: fixedNow },
          fixedNow,
        ),
      ).toBe(true);
    });
  });
});
