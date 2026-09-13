import { db, getStudio, getPricingConfig } from './db';
import { generateReply } from './llm';
import { sendWhatsAppMessage } from './whatsapp';

export interface FollowUpRunSummary {
  checkedAt: string;
  followUpsSent: number;
  discountsSent: number;
  markedLost: number;
  details: string[];
}

/**
 * Checks for ghosted leads and orchestrates the automated re-engagement flow:
 * 1. 48h since last message with no client reply -> Send warm follow-up
 * 2. discount_trigger_hours since follow-up with still no reply -> Send studio discount offer
 * 3. discount_trigger_hours since discount offer with still no reply -> Mark lead as 'lost'
 */
export async function checkGhostedLeads(targetStudioId?: string): Promise<FollowUpRunSummary> {
  const now = new Date();
  const summary: FollowUpRunSummary = {
    checkedAt: now.toISOString(),
    followUpsSent: 0,
    discountsSent: 0,
    markedLost: 0,
    details: []
  };

  const cutoff48h = new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString();

  // -------------------------------------------------------------
  // 1. Initial 48-hour Follow-up Check
  // -------------------------------------------------------------
  const ghostedQuery = `
    SELECT c.id as conversation_id, c.studio_id, c.client_phone, c.stage, c.last_message_at,
           l.id as lead_id, l.placement, l.size_label, l.style, l.quoted_price_low,
           l.quoted_price_high, l.status as lead_status, l.follow_up_sent_at, l.discount_sent_at
    FROM conversations c
    JOIN leads l ON c.lead_id = l.id
    WHERE c.stage NOT IN ('booked', 'handed_off_to_human')
      AND l.status NOT IN ('confirmed', 'lost')
      AND l.follow_up_sent_at IS NULL
      AND c.last_message_at <= ?
      ${targetStudioId ? 'AND c.studio_id = ?' : ''}
  `;

  const ghostedParams = targetStudioId ? [cutoff48h, targetStudioId] : [cutoff48h];
  const ghostedLeads: any[] = db.prepare(ghostedQuery).all(...ghostedParams);

  for (const item of ghostedLeads) {
    try {
      const studio = getStudio(item.studio_id);
      if (!studio) continue;

      const followUpText = await generateReply(
        'follow_up',
        {
          placement: item.placement,
          size: item.size_label,
          style: item.style,
          quoted_price_low: item.quoted_price_low,
          quoted_price_high: item.quoted_price_high,
          paused_stage: item.stage
        },
        studio.name
      );

      // Send outbound WhatsApp message
      await sendWhatsAppMessage(item.client_phone, followUpText);

      const timestamp = new Date().toISOString();

      // Log bot follow-up message
      db.prepare(
        `INSERT INTO messages (conversation_id, role, text, at) VALUES (?, 'bot', ?, ?)`
      ).run(item.conversation_id, followUpText, timestamp);

      // Record follow_up_sent_at and update last_message_at
      db.prepare(`UPDATE leads SET follow_up_sent_at = ? WHERE id = ?`).run(
        timestamp,
        item.lead_id
      );
      db.prepare(`UPDATE conversations SET last_message_at = ? WHERE id = ?`).run(
        timestamp,
        item.conversation_id
      );

      summary.followUpsSent++;
      summary.details.push(`Sent 48h follow-up to lead ${item.lead_id} (${item.client_phone})`);
    } catch (err: any) {
      console.error(`Error processing 48h follow-up for lead ${item.lead_id}:`, err);
    }
  }

  // -------------------------------------------------------------
  // 2. Discount Offer Check
  // -------------------------------------------------------------
  const discountCandidatesQuery = `
    SELECT c.id as conversation_id, c.studio_id, c.client_phone, c.stage, c.last_message_at,
           l.id as lead_id, l.placement, l.size_label, l.style, l.quoted_price_low,
           l.quoted_price_high, l.status as lead_status, l.follow_up_sent_at, l.discount_sent_at
    FROM conversations c
    JOIN leads l ON c.lead_id = l.id
    WHERE c.stage NOT IN ('booked', 'handed_off_to_human')
      AND l.status NOT IN ('confirmed', 'lost')
      AND l.follow_up_sent_at IS NOT NULL
      AND l.discount_sent_at IS NULL
      ${targetStudioId ? 'AND c.studio_id = ?' : ''}
  `;

  const discountParams = targetStudioId ? [targetStudioId] : [];
  const discountCandidates: any[] = db.prepare(discountCandidatesQuery).all(...discountParams);

  for (const item of discountCandidates) {
    try {
      const studio = getStudio(item.studio_id);
      const config = getPricingConfig(item.studio_id);
      if (!studio || !config) continue;

      // Studio must have discount enabled and configured
      if (!config.discount_enabled || !config.discount_percent || config.discount_percent <= 0) {
        continue;
      }

      const triggerHours = config.discount_trigger_hours ?? 24;
      const followUpSentDate = new Date(item.follow_up_sent_at);
      const hoursSinceFollowUp = (now.getTime() - followUpSentDate.getTime()) / (1000 * 60 * 60);

      // Must exceed discount_trigger_hours since the follow-up message
      if (hoursSinceFollowUp < triggerHours) {
        continue;
      }

      // Verify client has not replied since the follow-up
      const clientRepliesAfterFollowUp = db
        .prepare(
          `SELECT COUNT(*) as count FROM messages
           WHERE conversation_id = ? AND role = 'client' AND at > ?`
        )
        .get(item.conversation_id, item.follow_up_sent_at) as { count: number };

      if (clientRepliesAfterFollowUp.count > 0) {
        // Client re-engaged! Do not fire discount
        continue;
      }

      const discountText = await generateReply(
        'discount_offer',
        {
          discount_percent: config.discount_percent,
          quoted_price_low: item.quoted_price_low,
          quoted_price_high: item.quoted_price_high,
          placement: item.placement,
          size: item.size_label,
          style: item.style
        },
        studio.name
      );

      // Send outbound WhatsApp message
      await sendWhatsAppMessage(item.client_phone, discountText);

      const timestamp = new Date().toISOString();

      // Log bot discount message
      db.prepare(
        `INSERT INTO messages (conversation_id, role, text, at) VALUES (?, 'bot', ?, ?)`
      ).run(item.conversation_id, discountText, timestamp);

      // Record discount_sent_at and update last_message_at
      db.prepare(`UPDATE leads SET discount_sent_at = ? WHERE id = ?`).run(
        timestamp,
        item.lead_id
      );
      db.prepare(`UPDATE conversations SET last_message_at = ? WHERE id = ?`).run(
        timestamp,
        item.conversation_id
      );

      summary.discountsSent++;
      summary.details.push(
        `Sent ${config.discount_percent}% discount offer to lead ${item.lead_id} (${item.client_phone})`
      );
    } catch (err: any) {
      console.error(`Error processing discount offer for lead ${item.lead_id}:`, err);
    }
  }

  // -------------------------------------------------------------
  // 3. Mark As Lost Check
  // -------------------------------------------------------------
  const lostCandidatesQuery = `
    SELECT c.id as conversation_id, c.studio_id, c.client_phone,
           l.id as lead_id, l.status as lead_status, l.discount_sent_at
    FROM conversations c
    JOIN leads l ON c.lead_id = l.id
    WHERE l.status NOT IN ('confirmed', 'lost')
      AND l.discount_sent_at IS NOT NULL
      ${targetStudioId ? 'AND c.studio_id = ?' : ''}
  `;

  const lostParams = targetStudioId ? [targetStudioId] : [];
  const lostCandidates: any[] = db.prepare(lostCandidatesQuery).all(...lostParams);

  for (const item of lostCandidates) {
    try {
      const config = getPricingConfig(item.studio_id);
      const triggerHours = config?.discount_trigger_hours ?? 24;
      const discountSentDate = new Date(item.discount_sent_at);
      const hoursSinceDiscount = (now.getTime() - discountSentDate.getTime()) / (1000 * 60 * 60);

      // Check if another trigger window has elapsed since discount offer
      if (hoursSinceDiscount < triggerHours) {
        continue;
      }

      // Check if client sent any message after discount offer
      const clientRepliesAfterDiscount = db
        .prepare(
          `SELECT COUNT(*) as count FROM messages
           WHERE conversation_id = ? AND role = 'client' AND at > ?`
        )
        .get(item.conversation_id, item.discount_sent_at) as { count: number };

      if (clientRepliesAfterDiscount.count > 0) {
        // Client replied! Do not mark lost
        continue;
      }

      // Mark lead as lost
      db.prepare(`UPDATE leads SET status = 'lost' WHERE id = ?`).run(item.lead_id);
      summary.markedLost++;
      summary.details.push(
        `Marked lead ${item.lead_id} (${item.client_phone}) as lost after unresponsive discount period`
      );
    } catch (err: any) {
      console.error(`Error marking lead ${item.lead_id} as lost:`, err);
    }
  }

  return summary;
}
