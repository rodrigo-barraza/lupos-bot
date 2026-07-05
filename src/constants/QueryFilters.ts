/**
 * QueryFilters — Reusable MongoDB query filter fragments.
 *
 * Centralises shared filter predicates so every Messages-collection
 * consumer excludes soft-deleted documents consistently.
 */

/**
 * Standard filter to exclude soft-deleted documents.
 * Spread into any MongoDB `find()`, `aggregate $match`, or
 * `countDocuments()` query against the Messages collection:
 *
 *   collection.find({ guildId, ...EXCLUDE_SOFT_DELETED })
 */
export const EXCLUDE_SOFT_DELETED = Object.freeze({ isDeleted: { $ne: true } });
