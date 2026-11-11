import { redirect } from 'next/navigation';
import { SettingsScreen } from '@/components/SettingsScreen';
import { currentUser } from '@/server/session';

export default async function SettingsPage() {
  if (!(await currentUser())?.is_admin) redirect('/');
  return <SettingsScreen />;
}
