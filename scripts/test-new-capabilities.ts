import { extractStyleFromImage, extractField, generateReply } from '../lib/llm';
import { db, getStudio, getPricingConfig } from '../lib/db';
import { checkGhostedLeads } from '../lib/followup';
import { handleIncomingMessage } from '../lib/stateMachine';
import { randomUUID } from 'crypto';

async function runTests() {
  console.log('=== TEST 1: Vision Style Extraction ===');
  const sampleImageUrl = 'https://images.unsplash.com/photo-1598371839696-5c5bb00bdc28?w=500&auto=format&fit=crop&q=60';
  const visionResult = await extractStyleFromImage(
    sampleImageUrl,
    'delicate single needle floral branch for forearm'
  );
  console.log('Vision output:', JSON.stringify(visionResult, null, 2));

  console.log('\n=== TEST 2: State Machine Ask Style with Image ===');
  const testPhone = `+91-99999-${Math.floor(10000 + Math.random() * 90000)}`;
  // 1. greeting
  await handleIncomingMessage('studio_demo', testPhone, 'hi, want a tattoo');
  // 2. placement
  await handleIncomingMessage('studio_demo', testPhone, 'on my forearm');
  // 3. size
  await handleIncomingMessage('studio_demo', testPhone, 'medium');
  // 4. ask_style with image!
  const styleStep = await handleIncomingMessage(
    'studio_demo',
    testPhone,
    'fine line botanical style like this reference image',
    sampleImageUrl
  );
  console.log('Style step response:', styleStep);

  const leadRow: any = db.prepare('SELECT * FROM leads WHERE id = ?').get(styleStep.leadId);
  console.log('Lead record style:', leadRow.style, '| image:', leadRow.reference_image_url);
  if (!leadRow.reference_image_url) {
    throw new Error('reference_image_url was not stored!');
  }

  console.log('\n=== TEST 3: Ghosted Leads Re-engagement Lifecycle ===');
  const ghostPhone = `+91-88888-${Math.floor(10000 + Math.random() * 90000)}`;
  const ghostLeadId = randomUUID();
  const ghostConvoId = randomUUID();
  // 50 hours ago
  const tMinus50Hours = new Date(Date.now() - 50 * 60 * 60 * 1000).toISOString();

  db.prepare(`
    INSERT INTO leads (id, studio_id, client_phone, placement, size_label, style, quoted_price_low, quoted_price_high, status, created_at)
    VALUES (?, 'studio_demo', ?, 'forearm', 'medium', 'fine_line', 3100, 4000, 'quoted', ?)
  `).run(ghostLeadId, ghostPhone, tMinus50Hours);

  db.prepare(`
    INSERT INTO conversations (id, studio_id, client_phone, stage, lead_id, last_message_at)
    VALUES (?, 'studio_demo', ?, 'ask_slot', ?, ?)
  `).run(ghostConvoId, ghostPhone, ghostLeadId, tMinus50Hours);

  // Step 3a: Run checkGhostedLeads -> should send 48h follow up
  console.log('Triggering checkGhostedLeads for 48h follow-up...');
  const cycle1 = await checkGhostedLeads('studio_demo');
  console.log('Cycle 1 result:', cycle1);
  const leadAfterFollowUp: any = db.prepare('SELECT * FROM leads WHERE id = ?').get(ghostLeadId);
  console.log('Follow-up sent at:', leadAfterFollowUp.follow_up_sent_at);
  if (!leadAfterFollowUp.follow_up_sent_at) {
    throw new Error('follow_up_sent_at was not recorded!');
  }

  // Step 3b: Simulate 25 hours elapsed since follow-up -> should send discount offer
  console.log('Simulating 25 hours elapsed since follow-up...');
  const tMinus25Hours = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
  db.prepare(`UPDATE leads SET follow_up_sent_at = ? WHERE id = ?`).run(tMinus25Hours, ghostLeadId);

  const cycle2 = await checkGhostedLeads('studio_demo');
  console.log('Cycle 2 result:', cycle2);
  const leadAfterDiscount: any = db.prepare('SELECT * FROM leads WHERE id = ?').get(ghostLeadId);
  console.log('Discount sent at:', leadAfterDiscount.discount_sent_at);
  if (!leadAfterDiscount.discount_sent_at) {
    throw new Error('discount_sent_at was not recorded!');
  }

  // Step 3c: Simulate 25 hours elapsed since discount -> should mark lead as lost
  console.log('Simulating 25 hours elapsed since discount...');
  db.prepare(`UPDATE leads SET discount_sent_at = ? WHERE id = ?`).run(tMinus25Hours, ghostLeadId);

  const cycle3 = await checkGhostedLeads('studio_demo');
  console.log('Cycle 3 result:', cycle3);
  const leadAfterLost: any = db.prepare('SELECT * FROM leads WHERE id = ?').get(ghostLeadId);
  console.log('Final lead status:', leadAfterLost.status);
  if (leadAfterLost.status !== 'lost') {
    throw new Error(`Expected status 'lost', got '${leadAfterLost.status}'`);
  }

  console.log('\n ALL TESTS PASSED SUCCESSFULLY!');
}

runTests().catch((e) => {
  console.error('Test failed:', e);
  process.exit(1);
});
