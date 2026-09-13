import { NextRequest, NextResponse } from 'next/server';
import { checkGhostedLeads } from '@/lib/followup';

/**
 * Scheduled Cron Route: /api/cron/check-ghosted
 * Invoked by Vercel Cron or monitoring services to process ghosted leads.
 */
export async function GET(req: NextRequest) {
  return handleCron(req);
}

export async function POST(req: NextRequest) {
  return handleCron(req);
}

async function handleCron(req: NextRequest) {
  try {
    // Optional Vercel Cron authorization check
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret) {
      const authHeader = req.headers.get('authorization');
      if (authHeader !== `Bearer ${cronSecret}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }

    const summary = await checkGhostedLeads();

    return NextResponse.json({
      success: true,
      message: 'Ghosted leads re-engagement cycle executed successfully.',
      ...summary
    });
  } catch (err: any) {
    console.error('Cron check-ghosted error:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
