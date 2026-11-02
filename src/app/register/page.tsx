import { redirect } from 'next/navigation';
import { getSessionUser } from '@/auth/get-session';
import { homeFor } from '@/auth/redirects';
import { RegisterForm } from '@/components/RegisterForm';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Join',
  description: 'Create a Comedically Online viewer or comedian account. 18+ only.',
  alternates: { canonical: '/register' },
};

export default async function RegisterPage() {
  const target = homeFor(await getSessionUser());
  if (target) redirect(target);
  return <RegisterForm />;
}
