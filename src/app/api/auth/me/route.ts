import { NextResponse } from 'next/server';
import { getSessionUser } from '@/auth/get-session';

export async function GET(): Promise<NextResponse> {
  const user = await getSessionUser();
  return NextResponse.json({ user });
}
