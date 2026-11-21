# Stratum Firestore Security Specification

## 1. Data Invariants
1. **Owner-Scoped User Profiles (`/users/{userId}`)**: A user profile document may only be read or created/updated by the verified user whose `request.auth.uid == userId`. Listing the root `/users` collection is strictly denied to prevent PII enumeration.
2. **Workspace Lineage (`/users/{userId}/workspaces/{workspaceId}`)**: A saved curation workspace cannot exist without an active parent `/users/{userId}` document, and `ownerId` must permanently match `userId` and `request.auth.uid`.
3. **Chat Session & Message Integrity (`/users/{userId}/chatSessions/{sessionId}/messages/{messageId}`)**: A chat message cannot exist without a valid parent `chatSession` owned by `userId`. Messages are append-only (`update` is denied) and strictly validated for sender enum (`user` | `assistant`) and bounded text length (`<= 16000`).
4. **Governance, VCS & Archive Integrity (`/users/{userId}/governanceRecords`, `vcsCommits`, `archiveVaults`)**: Governance metadata records enforce strict standard/classification/retention enums and bounded keywords (`<= 10`). VCS commits are strictly immutable (`update` is denied). Archive vault records preserve immutable `sha256Digest` and `createdAt`, restricting updates to lifecycle `storageTier`, `retentionHold`, `lastVerifiedIso`, and `updatedAt`.
5. **Temporal & Identity Immutability**: `createdAt` must equal `request.time` on creation and remain immutable on updates. `updatedAt` must equal `request.time` on both creation and updates. `uid`, `ownerId`, `workspaceId`, and `sessionId` are immutable once created.

## 2. Adversarial "Dirty Dozen" Payloads (Expected: PERMISSION_DENIED)
1. **Unauthenticated Read**: `get(/users/userA)` with `auth = null`.
2. **Cross-User PII Read**: `get(/users/userA)` authenticated as `userB`.
3. **Blanket User List Enumeration**: `list(/users)` authenticated as `userA`.
4. **Unverified Email Write**: `create(/users/userA, validUser)` with `email_verified = false`.
5. **Shadow Field Injection**: `create(/users/userA/workspaces/ws1, { ...validWorkspace, isAdmin: true })`.
6. **Identity Spoofing on Workspace Create**: `create(/users/userA/workspaces/ws1, { ...validWorkspace, ownerId: 'userB' })` as `userA`.
7. **Orphaned Subcollection Write**: `create(/users/userA/workspaces/ws1, validWorkspace)` when `/users/userA` does not exist.
8. **ID Poisoning**: `create(/users/userA/workspaces/bad$id!overflow, validWorkspace)`.
9. **Client Timestamp Forgery**: `create(/users/userA/workspaces/ws1, { ...validWorkspace, createdAt: Timestamp(2020-01-01) })`.
10. **Immutable Field Mutation**: `update(/users/userA/workspaces/ws1, { ownerId: 'userB', updatedAt: serverTimestamp() })`.
11. **Oversized String / Resource Exhaustion**: `create(/users/userA/chatSessions/s1/messages/m1, { ...validMsg, text: 'x'.repeat(20000) })`.
12. **Message History Tampering**: `update(/users/userA/chatSessions/s1/messages/m1, { text: 'edited' })`.
