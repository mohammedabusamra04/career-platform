import { UserStatus, type User } from './user.types.js';

export class InvalidStateTransitionError extends Error {
  constructor(
    public readonly from: UserStatus,
    public readonly to: UserStatus,
  ) {
    super(`Illegal user state transition from "${from}" to "${to}"`);
    this.name = 'InvalidStateTransitionError';
  }
}

/**
 * Explicit map of permitted lifecycle state transitions.
 */
export const VALID_TRANSITIONS: Record<UserStatus, readonly UserStatus[]> = {
  [UserStatus.ACTIVE]: [
    UserStatus.ACTIVE,
    UserStatus.PAUSED,
    UserStatus.BLOCKED,
    UserStatus.DELETED,
  ],
  [UserStatus.PAUSED]: [
    UserStatus.ACTIVE,
    UserStatus.PAUSED,
    UserStatus.BLOCKED,
    UserStatus.DELETED,
  ],
  [UserStatus.BLOCKED]: [
    UserStatus.ACTIVE,
    UserStatus.DELETED,
    UserStatus.BLOCKED,
  ],
  [UserStatus.DELETED]: [
    UserStatus.ACTIVE,
    UserStatus.DELETED,
  ],
};

/**
 * Validates whether a state transition is permitted.
 */
export function canTransition(from: UserStatus, to: UserStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Asserts that a state transition is legal, throwing InvalidStateTransitionError if illegal.
 */
export function assertValidTransition(from: UserStatus, to: UserStatus): void {
  if (!canTransition(from, to)) {
    throw new InvalidStateTransitionError(from, to);
  }
}

/**
 * Determines whether a user is currently eligible to receive job digest notifications.
 *
 * Eligibility Rules:
 * - ACTIVE: Eligible immediately.
 * - BLOCKED: Ineligible.
 * - DELETED: Ineligible.
 * - PAUSED: Eligible only if pausedUntil has elapsed (now >= pausedUntil).
 *           Indefinite pause (pausedUntil == null) remains ineligible.
 */
export function isUserEligibleForDigest(
  user: Pick<User, 'status' | 'pausedUntil'>,
  now: Date = new Date(),
): boolean {
  switch (user.status) {
    case UserStatus.ACTIVE:
      return true;

    case UserStatus.PAUSED:
      if (!user.pausedUntil) {
        return false;
      }
      return now.getTime() >= user.pausedUntil.getTime();

    case UserStatus.BLOCKED:
    case UserStatus.DELETED:
    default:
      return false;
  }
}
