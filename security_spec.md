# Security Specification - StageMaster Rally Engine

## Data Invariants
1. A driver must have a unique `carNumber`.
2. `stageTimes` and `stagePenalties` keys must be strings representing stage numbers "1" through "12".
3. `totalTimeSeconds` must be a positive number.
4. Only authenticated users can update results (assuming a professional setting). For this app, I'll allow any signed-in user to update for demo purposes, or restrict if I had an admin concept. The user prompt says "You are a Professional Rally Timing Engine", implying the *system* manages it. I'll allow update if signed in.

## The Dirty Dozen Payloads (Rejection Targets)
1. Missing name/class on creation.
2. Invalid `carNumber` format (too long).
3. `totalTimeSeconds` negative or not a number.
4. Setting someone else's `driverId` (if we had ownership, but this is a central ledger).
5. Injecting a massive string into a stage time field.
6. Updating `updatedAt` with a client-side timestamp instead of `request.time`.
7. `stageTimes` keys outside "1"-"12".
8. Deleting the collection (blanket delete).
9. Spoofing `totalTimeSeconds` without updating stages.
10. Anonymous user trying to write (if restricted).
11. Very long strings for name or class (exhaustion attack).
12. Attempting to bypass `isValidId` for document path.

## Firestore Rules Draft
Stored in `firestore.rules`.
