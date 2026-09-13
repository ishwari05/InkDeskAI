export type ConversationStage =
  | 'greeting'
  | 'ask_placement'
  | 'ask_size'
  | 'ask_style'
  | 'ask_reference'
  | 'quoted'
  | 'ask_slot'
  | 'awaiting_deposit'
  | 'booked'
  | 'handed_off_to_human'
  | 'follow_up'
  | 'discount_offer';

export interface Studio {
  id: string;
  name: string;
  location: string;
  whatsapp_number: string;
}

export interface PricingConfig {
  studio_id: string;
  base_rate_per_sq_in: number; // ₹ per sq inch, rough proxy for size
  placement_multipliers: Record<string, number>; // e.g. { ribs: 1.3, forearm: 1.0 }
  style_multipliers: Record<string, number>; // e.g. { fine_line: 1.1, realism: 1.5 }
  min_price: number;
  deposit_percent: number; // e.g. 20
  discount_enabled?: boolean;
  discount_percent?: number; // e.g. 10 for 10%
  discount_trigger_hours?: number; // e.g. 24 hours after follow-up
}

export interface SizeEstimate {
  label: 'small' | 'medium' | 'large' | 'sleeve';
  approx_sq_in: number;
}

export interface Lead {
  id: string;
  studio_id: string;
  client_phone: string;
  client_name: string | null;
  placement: string | null;
  size_label: string | null;
  style: string | null;
  reference_note: string | null;
  reference_image_url?: string | null;
  quoted_price_low: number | null;
  quoted_price_high: number | null;
  status: 'in_progress' | 'quoted' | 'booking_requested' | 'confirmed' | 'lost' | 'handed_off';
  follow_up_sent_at?: string | null;
  discount_sent_at?: string | null;
  created_at: string;
}

export interface ConversationState {
  id: string;
  studio_id: string;
  client_phone: string;
  stage: ConversationStage;
  lead_id: string;
  last_message_at: string;
}

export interface ChatTurn {
  role: 'client' | 'bot';
  text: string;
  at: string;
}
