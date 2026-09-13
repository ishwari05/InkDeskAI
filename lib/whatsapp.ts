// Outbound WhatsApp message dispatcher supporting Interakt, Wati, and local mock.
import { randomUUID } from 'crypto';

export interface WhatsAppSendResult {
  success: boolean;
  messageId?: string;
  simulated?: boolean;
  error?: string;
}

/**
 * Sends an outbound WhatsApp message to a client phone number.
 * Supports Interakt and Wati provider endpoints, or logs simulated delivery in dev.
 */
export async function sendWhatsAppMessage(
  toPhone: string,
  messageText: string
): Promise<WhatsAppSendResult> {
  const apiKey = process.env.WHATSAPP_PROVIDER_API_KEY;
  const provider = (process.env.WHATSAPP_PROVIDER || 'interakt').toLowerCase();

  // Normalize phone number (e.g. "+91-98765-43210" -> "+919876543210")
  const cleanPhone = toPhone.replace(/[\s\-]/g, '');

  if (!apiKey) {
    // In local development / demo mode, log simulated outbound dispatch
    console.log(
      `[WhatsApp Dispatcher] (Simulated - no WHATSAPP_PROVIDER_API_KEY) Outbound to ${cleanPhone}: "${messageText}"`
    );
    return {
      success: true,
      messageId: `sim_${randomUUID().slice(0, 8)}`,
      simulated: true
    };
  }

  try {
    if (provider === 'wati') {
      const watiEndpoint = process.env.WATI_API_ENDPOINT || 'https://api.wati.io';
      const cleanWaId = cleanPhone.replace(/^\+/, '');
      const url = `${watiEndpoint}/api/v1/sendSessionMessage/${cleanWaId}?messageText=${encodeURIComponent(messageText)}`;

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      });

      if (!res.ok) {
        const errText = await res.text();
        console.error(`[WhatsApp Dispatcher] Wati error (${res.status}):`, errText);
        return { success: false, error: `Wati error: ${errText}` };
      }

      const data = await res.json();
      return { success: true, messageId: data.messageId || data.id };
    }

    // Default: Interakt API
    // https://api.interakt.ai/v1/public/message/
    let countryCode = '+91';
    let localNumber = cleanPhone;

    if (cleanPhone.startsWith('+91')) {
      countryCode = '+91';
      localNumber = cleanPhone.slice(3);
    } else if (cleanPhone.startsWith('+')) {
      countryCode = cleanPhone.slice(0, 3);
      localNumber = cleanPhone.slice(3);
    }

    const interaktUrl = 'https://api.interakt.ai/v1/public/message/';
    const res = await fetch(interaktUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        countryCode,
        phoneNumber: localNumber,
        type: 'Text',
        data: {
          message: messageText
        }
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error(`[WhatsApp Dispatcher] Interakt error (${res.status}):`, errText);
      return { success: false, error: `Interakt error: ${errText}` };
    }

    const data = await res.json();
    return { success: true, messageId: data.id || data.messageId };
  } catch (err: any) {
    console.error('[WhatsApp Dispatcher] Network/request error:', err);
    return { success: false, error: err.message };
  }
}
