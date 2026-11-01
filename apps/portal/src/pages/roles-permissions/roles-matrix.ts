// The permission × role matrix of Roles & Permissions: what a screen reader says for each cell, which shows only a box.

/** The accessible name of the cell that grants `permission` to `role`: "Grant runs.start to Developer". */
export const grantLabel = (permission: string, role: string): string => `Grant ${permission} to ${role}`;
