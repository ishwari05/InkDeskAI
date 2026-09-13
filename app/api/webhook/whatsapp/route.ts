import { NextRequest, NextResponse } from 'next/server';
import { handleIncomingMessage } from '@/lib/stateMachine';
import { sendWhatsAppMessage } from '@/lib/whatsapp';

/**
 * WhatsApp Inbound Webhook Endpoint
 * Handles incoming text and media (image) messages from Interakt, Wati, or generic payloads.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Extract sender phone
    const from =
      body.from ||
      body.sender ||
      body.phone ||
      body.waId ||
      body.data?.customer?.phone_number ||
      (body.data?.customer?.country_code
        ? `${body.data.customer.country_code}${body.data.customer.phone_number}`
        : null);

    // Extract text / caption
    const text =
      body.text ||
      body.message ||
      body.caption ||
      body.data?.message?.captionText ||
      body.data?.message?.message ||
      '';

    // Extract image URL from Interakt, Wati, or generic media payloads
    let imageUrl: string | undefined =
      body.media_url ||
      body.imageUrl ||
      body.mediaUrl ||
      body.data?.message?.mediaUrl ||
      body.data?.message?.attachments?.[0]?.url ||
      (body.type === 'image' && typeof body.data === 'string' ? body.data : undefined);

    const studioId = body.studio_id || body.studioId || 'studio_demo';

    if (!from || (!text && !imageUrl)) {
      return NextResponse.json(
        { error: 'Missing from phone or message content (text or image) in payload' },
        { status: 400 }
      );
    }

    // Process through conversation state machine with image support
    const result = await handleIncomingMessage(studioId, from, text, imageUrl);

    // Actively dispatch the reply back to the client via WhatsApp provider API
    await sendWhatsAppMessage(from, result.reply);

    return NextResponse.json({
      ok: true,
      sent: result.reply,
      stage: result.stage,
      leadId: result.leadId
    });
  } catch (err: any) {
    console.error('WhatsApp Webhook error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// Verification challenge endpoint for webhook setup (Meta / Interakt / Wati)
export async function GET(req: NextRequest) {
  const challenge = req.nextUrl.searchParams.get('hub.challenge');
  if (challenge) return new NextResponse(challenge);
  return NextResponse.json({ status: 'webhook alive' });
}
