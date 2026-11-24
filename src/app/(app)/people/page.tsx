import { PeopleScreen } from '@/components/PeopleScreen';

/** ?packet=1: only the people with a pass in that packet (from the Packets page). */
export default async function PeoplePage({ searchParams }: { searchParams: Promise<{ packet?: string | string[] }> }) {
  const { packet } = await searchParams;
  return <PeopleScreen packet={typeof packet === 'string' ? packet : ''} />;
}
