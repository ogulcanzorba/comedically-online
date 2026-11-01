import bcrypt from 'bcryptjs';

/** Passwords are hashed with bcrypt and never logged anywhere. */
export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}
