import { randomUUID } from 'node:crypto';
import { getDb } from './client';

export type UserRole = 'comedian' | 'viewer';

export interface UserRow {
  id: string;
  role: UserRole;
  email: string;
  password_hash: string;
  display_name: string;
  stage_name: string | null;
  bio: string | null;
  comedy_styles: string | null;
  country: string | null;
  age_confirmed_at: string;
  created_at: string;
}

export interface PublicUser {
  id: string;
  role: UserRole;
  email: string;
  displayName: string;
  stageName: string | null;
  bio: string | null;
  comedyStyles: string[];
  country: string | null;
}

export function toPublic(row: UserRow): PublicUser {
  let comedyStyles: string[] = [];
  try {
    const parsed: unknown = JSON.parse(row.comedy_styles ?? '[]');
    if (Array.isArray(parsed)) comedyStyles = parsed.filter((s): s is string => typeof s === 'string');
  } catch {
    comedyStyles = [];
  }
  return {
    id: row.id,
    role: row.role,
    email: row.email,
    displayName: row.display_name,
    stageName: row.stage_name,
    bio: row.bio,
    comedyStyles,
    country: row.country,
  };
}

export interface CreateUserInput {
  id?: string;
  role: UserRole;
  email: string;
  passwordHash: string;
  displayName: string;
  stageName?: string | null;
  bio?: string | null;
  comedyStyles?: string[];
  country?: string | null;
}

export function createUser(input: CreateUserInput): UserRow {
  const now = new Date().toISOString();
  const row: UserRow = {
    id: input.id ?? randomUUID(),
    role: input.role,
    email: input.email.toLowerCase(),
    password_hash: input.passwordHash,
    display_name: input.displayName,
    stage_name: input.stageName ?? null,
    bio: input.bio ?? null,
    comedy_styles: JSON.stringify(input.comedyStyles ?? []),
    country: input.country ?? null,
    age_confirmed_at: now,
    created_at: now,
  };
  getDb()
    .prepare(
      `INSERT INTO users(id, role, email, password_hash, display_name, stage_name, bio,
        comedy_styles, country, age_confirmed_at, created_at)
       VALUES(@id, @role, @email, @password_hash, @display_name, @stage_name, @bio,
        @comedy_styles, @country, @age_confirmed_at, @created_at)`,
    )
    .run(row);
  return row;
}

export function findUserByEmail(email: string): UserRow | undefined {
  return getDb().prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase()) as
    | UserRow
    | undefined;
}

export function findUserById(id: string): UserRow | undefined {
  return getDb().prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
}

export interface UpdateUserPatch {
  display_name?: string;
  bio?: string | null;
  country?: string | null;
  stage_name?: string | null;
  comedy_styles?: string[];
}

export function updateUser(id: string, patch: UpdateUserPatch): UserRow | undefined {
  const fields: string[] = [];
  const values: Array<string | null> = [];
  if (patch.display_name !== undefined) {
    fields.push('display_name = ?');
    values.push(patch.display_name);
  }
  if (patch.bio !== undefined) {
    fields.push('bio = ?');
    values.push(patch.bio);
  }
  if (patch.country !== undefined) {
    fields.push('country = ?');
    values.push(patch.country);
  }
  if (patch.stage_name !== undefined) {
    fields.push('stage_name = ?');
    values.push(patch.stage_name);
  }
  if (patch.comedy_styles !== undefined) {
    fields.push('comedy_styles = ?');
    values.push(JSON.stringify(patch.comedy_styles));
  }
  if (fields.length > 0) {
    values.push(id);
    getDb().prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  }
  return findUserById(id);
}
