import { redirect } from 'next/navigation';
import { UsersScreen } from '@/components/UsersScreen';
import { currentUser } from '@/server/session';

export default async function UsersPage() {
  if (!(await currentUser())?.is_admin) redirect('/');
  return <UsersScreen />;
}
