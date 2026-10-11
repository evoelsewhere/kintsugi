// Domain of installation settings managed in the portal (admin.installation_setting). First
// setting: the commit identity — name and email of kintsugi-bot, author and committer of every
// commit the worker makes to a document repo (ADR-0019). Pure types and the port.

export interface CommitIdentity {
  name: string;
  email: string;
}

export interface CommitIdentityView extends CommitIdentity {
  /** True while no admin has set one: the built-in defaults apply. */
  isDefault: boolean;
  updatedBy?: string;
  updatedAt?: string;
}

export interface StoredSetting<T> {
  value: T;
  updatedBy?: string;
  updatedAt: string;
}

/** Port: where installation settings are kept. */
export abstract class InstallationSettings {
  abstract get<T>(key: string): Promise<StoredSetting<T> | undefined>;
  abstract put<T>(key: string, value: T, updatedBy: string): Promise<StoredSetting<T>>;
}
