import { notFound } from 'next/navigation';
import { SheetScreen } from '@/components/SheetScreen';
import { isPassType } from '@/shared/types';

export default async function SheetPage({ params }: { params: Promise<{ type: string }> }) {
  const { type } = await params;
  if (!isPassType(type)) notFound();
  return <SheetScreen key={type} type={type} />;
}
