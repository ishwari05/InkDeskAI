import { NextRequest, NextResponse } from 'next/server';
import { handleIncomingMessage, resetConversationState } from '@/lib/stateMachine';

export async function POST(req: NextRequest) {
  try {
    const { studioId, clientPhone, message, imageUrl, reset } = await req.json();

    if (reset && studioId && clientPhone) {
      resetConversationState(studioId, clientPhone);
      return NextResponse.json({ ok: true, reset: true });
    }

    const effectiveMessage = (message || '').trim() || (imageUrl ? 'Here is a reference photo for my tattoo.' : '');

    if (!studioId || !clientPhone || (!effectiveMessage && !imageUrl)) {
      return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
    }

    const result = await handleIncomingMessage(studioId, clientPhone, effectiveMessage, imageUrl);
    return NextResponse.json(result);
  } catch (err: any) {
    console.error('Simulate error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

