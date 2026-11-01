'use client';

import { useRouter } from 'next/navigation';

export function LogoutButton() {
  const router = useRouter();
  async function logout(): Promise<void> {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/');
    router.refresh();
  }
  return (
    <button onClick={() => void logout()} className="text-sm text-neutral-400 hover:text-neutral-200">
      Log out
    </button>
  );
}
