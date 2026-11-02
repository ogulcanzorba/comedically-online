import { redirect } from 'next/navigation';
import { getSessionUser } from '@/auth/get-session';
import { homeFor } from '@/auth/redirects';
import { LoginForm } from '@/components/LoginForm';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Log in',
  description: 'Log in to Comedically Online.',
  alternates: { canonical: '/login' },
};

export default async function LoginPage() {
  const target = homeFor(await getSessionUser());
  if (target) redirect(target);
  return <LoginForm />;
}
