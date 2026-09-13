import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const leads = db
    .prepare('SELECT * FROM leads ORDER BY created_at DESC')
    .all();
  return NextResponse.json({ leads });
}
