import { db, getStudio } from './db';
import { extractField, extractStyleFromImage, generateReply } from './llm';
import { calculateQuote, calculateDeposit, QuoteResult } from './pricing';
import { randomUUID } from 'crypto';

interface StepResult {
  reply: string;
  newStage: string;
  handedOff: boolean;
}

/**
 * Gets (or creates) the conversation + lead row for a client on a studio's number.
 */
function getOrCreateConversation(studioId: string, clientPhone: string) {
  let convo: any = db
    .prepare('SELECT * FROM conversations WHERE studio_id = ? AND client_phone = ?')
    .get(studioId, clientPhone);

  if (!convo) {
    const leadId = randomUUID();
    const convoId = randomUUID();
    const now = new Date().toISOString();

    db.prepare(
      `INSERT INTO leads (id, studio_id, client_phone, status, created_at) VALUES (?, ?, ?, 'in_progress', ?)`
    ).run(leadId, studioId, clientPhone, now);

    db.prepare(
      `INSERT INTO conversations (id, studio_id, client_phone, stage, lead_id, last_message_at)
       VALUES (?, ?, ?, 'greeting', ?, ?)`
    ).run(convoId, studioId, clientPhone, leadId, now);

    convo = db.prepare('SELECT * FROM conversations WHERE id = ?').get(convoId);
  }
  return convo;
}

function logMessage(conversationId: string, role: 'client' | 'bot', text: string) {
  db.prepare(
    `INSERT INTO messages (conversation_id, role, text, at) VALUES (?, ?, ?, ?)`
  ).run(conversationId, role, text, new Date().toISOString());
}

function updateLead(leadId: string, fields: Record<string, any>) {
  const keys = Object.keys(fields);
  if (keys.length === 0) return;
  const setClause = keys.map((k) => `${k} = ?`).join(', ');
  db.prepare(`UPDATE leads SET ${setClause} WHERE id = ?`).run(
    ...keys.map((k) => fields[k]),
    leadId
  );
}

function setStage(conversationId: string, stage: string) {
  db.prepare(
    `UPDATE conversations SET stage = ?, last_message_at = ? WHERE id = ?`
  ).run(stage, new Date().toISOString(), conversationId);
}

/**
 * Main entry point: process one incoming client message and return the bot's reply.
 * This is what both the real WhatsApp webhook and the demo simulator call.
 */
export async function handleIncomingMessage(
  studioId: string,
  clientPhone: string,
  messageText: string,
  imageUrl?: string
): Promise<{ reply: string; stage: string; leadId: string }> {
  const studio = getStudio(studioId);
  if (!studio) throw new Error(`Unknown studio: ${studioId}`);

  const convo: any = getOrCreateConversation(studioId, clientPhone);
  const displayImageNote = imageUrl
    ? (imageUrl.startsWith('data:') ? '[Reference Photo Attached]' : `[Reference Photo: ${imageUrl}]`)
    : '';
  const loggedText = [messageText, displayImageNote].filter(Boolean).join(' ');
  logMessage(convo.id, 'client', loggedText);

  const lead: any = db.prepare('SELECT * FROM leads WHERE id = ?').get(convo.lead_id);

  // If a reference image is attached, preserve it on the lead immediately
  if (imageUrl) {
    updateLead(lead.id, { reference_image_url: imageUrl });
  }

  let result: StepResult;

  switch (convo.stage) {
    case 'greeting': {
      const reply = await generateReply(
        'greeting',
        { message: 'Client just messaged for the first time.' },
        studio.name
      );
      result = { reply, newStage: 'ask_placement', handedOff: false };
      break;
    }

    case 'ask_placement': {
      const extracted = await extractField('placement', messageText);
      if (extracted.value) updateLead(lead.id, { placement: extracted.value });

      const reply = await generateReply(
        'ask_placement',
        {
          placement_captured: extracted.value,
          instruction: extracted.value
            ? 'Confirm the placement briefly, then ask what size they are thinking (small / medium / large / full sleeve).'
            : 'Politely ask where on the body they want the tattoo.'
        },
        studio.name
      );
      result = {
        reply,
        newStage: extracted.value ? 'ask_size' : 'ask_placement',
        handedOff: false
      };
      break;
    }

    case 'ask_size': {
      const extracted = await extractField('size', messageText);
      if (extracted.value) updateLead(lead.id, { size_label: extracted.value });

      const reply = await generateReply(
        'ask_size',
        {
          size_captured: extracted.value,
          instruction: extracted.value
            ? 'Confirm the size briefly, then ask what style they want (fine line, traditional, realism, blackwork, etc.) — or if they have a reference image to describe.'
            : 'Ask them to clarify size — small, medium, large, or full sleeve.'
        },
        studio.name
      );
      result = {
        reply,
        newStage: extracted.value ? 'ask_style' : 'ask_size',
        handedOff: false
      };
      break;
    }

    case 'ask_style': {
      let extractedStyle: string | null = null;
      let visionDetails = '';

      // If an image was submitted, call vision extraction
      if (imageUrl) {
        const visionResult = await extractStyleFromImage(imageUrl, messageText);
        if (visionResult.style) {
          extractedStyle = visionResult.style;
          visionDetails = visionResult.details;
        }
      }

      // Fallback or text-based extraction if style not resolved from image
      if (!extractedStyle && messageText.trim()) {
        const extracted = await extractField('style', messageText);
        if (extracted.value) {
          extractedStyle = extracted.value;
        }
      }

      const noteText = [
        messageText.trim(),
        visionDetails ? `Vision: ${visionDetails}` : ''
      ].filter(Boolean).join(' | ');

      if (extractedStyle) {
        const leadUpdates: Record<string, any> = {
          style: extractedStyle,
          reference_note: noteText || messageText || extractedStyle
        };
        if (imageUrl) {
          leadUpdates.reference_image_url = imageUrl;
        }
        updateLead(lead.id, leadUpdates);

        const freshLead: any = db.prepare('SELECT * FROM leads WHERE id = ?').get(lead.id);
        const quote = calculateQuote(
          studioId,
          freshLead.size_label,
          freshLead.placement,
          extractedStyle
        );

        // Use the pricing engine, or generate a reasonable fallback range
        // so we never prematurely hand off to a human just because pricing
        // config is incomplete.
        const finalQuote: QuoteResult = quote ?? {
          low: 2000,
          high: 5000,
          breakdown: 'Estimated starting range (exact price confirmed in-person)'
        };

        updateLead(lead.id, {
          quoted_price_low: finalQuote.low,
          quoted_price_high: finalQuote.high,
          status: 'quoted'
        });

        const reply = await generateReply(
          'quoted',
          {
            placement: freshLead.placement,
            size: freshLead.size_label,
            style: extractedStyle,
            quote_low: finalQuote.low,
            quote_high: finalQuote.high,
            is_estimate: !quote,
            instruction: !quote
              ? 'Present the starting price range warmly, clearly mention this is an approximate starting range and the exact price will be confirmed by the artist during an in-person consultation. Ask if they\'d like to book a consultation slot.'
              : 'Present the price range warmly, mention the final price depends on the artist\'s in-person assessment, and ask if they\'d like to book a consultation slot.'
          },
          studio.name
        );
        result = { reply, newStage: 'ask_slot', handedOff: false };
      } else {
        if (imageUrl) {
          updateLead(lead.id, {
            reference_image_url: imageUrl,
            reference_note: noteText || 'Client uploaded reference photo'
          });
        }
        const reply = await generateReply(
          'ask_style',
          { instruction: 'Ask them to describe the style or vibe they want — or share a reference image.' },
          studio.name
        );
        result = { reply, newStage: 'ask_style', handedOff: false };
      }
      break;
    }

    case 'ask_slot': {
      updateLead(lead.id, { status: 'booking_requested' });
      const deposit = lead.quoted_price_high
        ? calculateDeposit(studioId, lead.quoted_price_high)
        : 0;

      const reply = await generateReply(
        'ask_slot',
        {
          instruction: `Let them know a team member will confirm exact slot availability and send a deposit link of ₹${deposit} to hold the booking. Keep it reassuring — a human will follow up within a few hours.`
        },
        studio.name
      );
      result = { reply, newStage: 'handed_off_to_human', handedOff: true };
      break;
    }

    case 'handed_off_to_human': {
      // Check if client is starting a fresh inquiry rather than asking for an update
      const normalizedMsg = messageText.trim().toLowerCase();
      const isNewInquiry =
        /^(hi|hey|hello|i want (a )?tattoo|want a tattoo|new tattoo|another tattoo|start over|restart)/i.test(normalizedMsg) ||
        normalizedMsg === 'hi' ||
        normalizedMsg === 'hello' ||
        normalizedMsg === 'hey';

      if (isNewInquiry) {
        // Create a new lead and restart the conversation from greeting
        const newLeadId = randomUUID();
        const now = new Date().toISOString();
        db.prepare(
          `INSERT INTO leads (id, studio_id, client_phone, status, created_at) VALUES (?, ?, ?, 'in_progress', ?)`
        ).run(newLeadId, studioId, clientPhone, now);

        db.prepare(
          `UPDATE conversations SET stage = 'greeting', lead_id = ?, last_message_at = ? WHERE id = ?`
        ).run(newLeadId, now, convo.id);

        const reply = await generateReply(
          'greeting',
          { message: 'Client wants to discuss a tattoo idea.' },
          studio.name
        );
        result = { reply, newStage: 'ask_placement', handedOff: false };
        break;
      }

      // Client messaged again after handoff for an ongoing status
      const reply = await generateReply(
        'handed_off_to_human',
        {
          instruction:
            'The client has already been connected with a team member. Acknowledge their message warmly, reassure them that their artist/team member has been notified and will get back to them soon. Keep it brief (1-2 sentences). Do NOT collect any new info.'
        },
        studio.name
      );
      result = { reply, newStage: 'handed_off_to_human', handedOff: false };
      break;
    }

    default: {
      // Unknown / stale stage — re-enter the flow instead of giving up.
      // Figure out what info we're still missing and resume from there.
      const freshLead: any = db.prepare('SELECT * FROM leads WHERE id = ?').get(convo.lead_id);
      let resumeStage = 'greeting';
      if (freshLead?.style) resumeStage = 'ask_slot';
      else if (freshLead?.size_label) resumeStage = 'ask_style';
      else if (freshLead?.placement) resumeStage = 'ask_size';
      else resumeStage = 'ask_placement';

      // Update stage and re-process this message through the correct handler
      setStage(convo.id, resumeStage);
      convo.stage = resumeStage;

      const reply = await generateReply(
        resumeStage,
        {
          instruction:
            'We seem to have lost track of our conversation. Apologize briefly and pick up where we left off by asking the next relevant question.'
        },
        studio.name
      );
      result = { reply, newStage: resumeStage, handedOff: false };
    }
  }

  setStage(convo.id, result.newStage);
  logMessage(convo.id, 'bot', result.reply);

  if (result.handedOff) {
    updateLead(lead.id, { status: lead.status === 'quoted' ? 'booking_requested' : 'handed_off' });
  }

  return { reply: result.reply, stage: result.newStage, leadId: lead.id };
}

export function resetConversationState(studioId: string, clientPhone: string) {
  const convo: any = db
    .prepare('SELECT * FROM conversations WHERE studio_id = ? AND client_phone = ?')
    .get(studioId, clientPhone);

  if (convo) {
    db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(convo.id);
    db.prepare('DELETE FROM conversations WHERE id = ?').run(convo.id);
  }
}
