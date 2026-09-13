// LLM wrapper supporting Groq (default) and Anthropic via LLM_PROVIDER env var.

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_TEXT_MODELS = [
  process.env.GROQ_TEXT_MODEL,
  'qwen/qwen3.8-27b',
  'openai/gpt-oss-20b',
  'openai/gpt-oss-120b'
].filter(Boolean) as string[];

const GROQ_VISION_MODEL = process.env.GROQ_VISION_MODEL || 'llama-3.2-90b-vision-preview';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_TEXT_MODEL = 'claude-3-5-sonnet-20241022';
const ANTHROPIC_VISION_MODEL = 'claude-3-5-sonnet-20241022';

// Retry config
const MAX_RETRIES = 2;
const INITIAL_BACKOFF_MS = 1000; // 1s, 2s
const RETRYABLE_STATUS_CODES = new Set([429, 503, 529]);

export interface ImageInput {
  url?: string;
  base64?: string;
  mimeType?: string;
}

export interface StyleExtractionResult {
  style: string | null;
  value: string | null;
  complexity: 'low' | 'medium' | 'high';
  details: string;
  confidence: 'high' | 'low';
}

function getProvider(): 'groq' | 'anthropic' {
  const provider = (process.env.LLM_PROVIDER || '').toLowerCase().trim();
  if (provider === 'anthropic' || (!process.env.GROQ_API_KEY && process.env.ANTHROPIC_API_KEY)) {
    return 'anthropic';
  }
  return 'groq';
}

/**
 * Retry wrapper with exponential backoff for transient API errors (429, 503, 529).
 * Also handles Retry-After headers from rate-limited APIs.
 */
async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastError = err;

      // Only retry on overload / rate-limit errors
      const isRetryable =
        err.retryable === true ||
        (err.statusCode && RETRYABLE_STATUS_CODES.has(err.statusCode)) ||
        /overloaded|rate.?limit|too many requests|529|503|429/i.test(err.message);

      if (!isRetryable || attempt === MAX_RETRIES) {
        throw err;
      }

      // Respect Retry-After header if present, otherwise use exponential backoff
      const backoff = err.retryAfterMs || INITIAL_BACKOFF_MS * Math.pow(2, attempt);
      console.warn(
        `[LLM ${label}] Attempt ${attempt + 1}/${MAX_RETRIES + 1} failed (${err.message}). Retrying in ${backoff}ms...`
      );
      await new Promise((resolve) => setTimeout(resolve, backoff));
    }
  }

  throw lastError;
}

/**
 * Text-only call dispatching to Groq or Anthropic based on LLM_PROVIDER
 */
async function callTextLLM(system: string, userMessage: string, maxTokens = 400): Promise<string> {
  const provider = getProvider();

  if (provider === 'anthropic') {
    return withRetry(async () => {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        throw new Error('ANTHROPIC_API_KEY is not set. Add it to .env.local.');
      }

      const res = await fetch(ANTHROPIC_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: ANTHROPIC_TEXT_MODEL,
          max_tokens: maxTokens,
          system,
          messages: [{ role: 'user', content: userMessage }]
        })
      });

      if (!res.ok) {
        const errText = await res.text();
        const err: any = new Error(`Anthropic API error (${res.status}): ${errText}`);
        err.statusCode = res.status;
        err.retryAfterMs = parseRetryAfter(res);
        err.retryable = RETRYABLE_STATUS_CODES.has(res.status);
        throw err;
      }

      const data = await res.json();
      return data.content?.[0]?.text ?? '';
    }, 'AnthropicTextLLM');
  }

  // Default: Groq with automatic model fallback
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error('GROQ_API_KEY is not set. Add it to .env.local (see .env.example).');
  }

  let lastErr: any = null;
  // Try available models in order
  for (const model of GROQ_TEXT_MODELS) {
    try {
      return await withRetry(async () => {
        const res = await fetch(GROQ_API_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model,
            max_tokens: maxTokens,
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: userMessage }
            ]
          })
        });

        if (!res.ok) {
          const errText = await res.text();
          const err: any = new Error(`Groq API error (${res.status}): ${errText}`);
          err.statusCode = res.status;
          err.retryAfterMs = parseRetryAfter(res);
          err.retryable = RETRYABLE_STATUS_CODES.has(res.status);
          throw err;
        }

        const data = await res.json();
        return data.choices?.[0]?.message?.content ?? '';
      }, `GroqTextLLM(${model})`);
    } catch (err: any) {
      lastErr = err;
      console.warn(`[Groq] Model ${model} failed (${err.message}), trying next model...`);
    }
  }

  throw lastErr || new Error('All configured Groq models failed.');
}

/** Parse Retry-After header (seconds) into milliseconds */
function parseRetryAfter(res: Response): number | undefined {
  const header = res.headers.get('retry-after');
  if (!header) return undefined;
  const seconds = Number(header);
  return isNaN(seconds) ? undefined : seconds * 1000;
}

/**
 * Multimodal vision call dispatching to Groq (llama-3.2-90b-vision-preview) or Anthropic
 */
async function callVisionLLM(
  system: string,
  userPrompt: string,
  imageInput: ImageInput | string,
  maxTokens = 400
): Promise<string> {
  // Pre-process image outside the retry loop (no need to re-fetch on each attempt)
  let imageUrl = typeof imageInput === 'string' ? imageInput : imageInput.url;
  let base64 = typeof imageInput === 'object' ? imageInput.base64 : undefined;
  let mimeType = (typeof imageInput === 'object' ? imageInput.mimeType : undefined) || 'image/jpeg';

  // If provided a data URI directly in string
  if (typeof imageInput === 'string' && imageInput.startsWith('data:')) {
    const match = imageInput.match(/^data:([^;]+);base64,(.+)$/);
    if (match) {
      mimeType = match[1];
      base64 = match[2];
      imageUrl = imageInput;
    }
  }

  return withRetry(async () => {
    const provider = getProvider();

    if (provider === 'anthropic') {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        throw new Error('ANTHROPIC_API_KEY is not set for Anthropic vision.');
      }

      // Anthropic requires base64. If we only have an HTTP URL, fetch it.
      let finalBase64 = base64;
      if (!finalBase64 && imageUrl && imageUrl.startsWith('http')) {
        try {
          const imgRes = await fetch(imageUrl);
          const arrayBuf = await imgRes.arrayBuffer();
          finalBase64 = Buffer.from(arrayBuf).toString('base64');
          const ct = imgRes.headers.get('content-type');
          if (ct) mimeType = ct;
        } catch (err: any) {
          throw new Error(`Failed to fetch image URL for Anthropic vision: ${err.message}`);
        }
      }

      if (!finalBase64) {
        throw new Error('No valid image data or URL provided for vision analysis.');
      }

      const res = await fetch(ANTHROPIC_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: ANTHROPIC_VISION_MODEL,
          max_tokens: maxTokens,
          system,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: mimeType,
                    data: finalBase64
                  }
                },
                { type: 'text', text: userPrompt }
              ]
            }
          ]
        })
      });

      if (!res.ok) {
        const errText = await res.text();
        const err: any = new Error(`Anthropic Vision error (${res.status}): ${errText}`);
        err.statusCode = res.status;
        err.retryAfterMs = parseRetryAfter(res);
        err.retryable = RETRYABLE_STATUS_CODES.has(res.status);
        throw err;
      }

      const data = await res.json();
      return data.content?.[0]?.text ?? '';
    }

    // Default: Groq Vision
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      throw new Error('GROQ_API_KEY is not set. Add it to .env.local.');
    }

    const finalImageUrl = base64 ? `data:${mimeType};base64,${base64}` : imageUrl;
    if (!finalImageUrl) {
      throw new Error('No valid image data or URL provided for Groq vision.');
    }

    const res = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: GROQ_VISION_MODEL,
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: system },
          {
            role: 'user',
            content: [
              { type: 'text', text: userPrompt },
              { type: 'image_url', image_url: { url: finalImageUrl } }
            ]
          }
        ]
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      const err: any = new Error(`Groq Vision API error (${res.status}): ${errText}`);
      err.statusCode = res.status;
      err.retryAfterMs = parseRetryAfter(res);
      err.retryable = RETRYABLE_STATUS_CODES.has(res.status);
      throw err;
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content ?? '';
  }, 'VisionLLM');
}

/**
 * Extracts a single structured field from a free-form client reply.
 */
export async function extractField(
  field: 'placement' | 'size' | 'style',
  clientMessage: string
): Promise<{ value: string | null; confidence: 'high' | 'low' }> {
  const fieldGuides: Record<string, string> = {
    placement:
      'Body placement for a tattoo (e.g. forearm, bicep, calf, back, chest, ribs, neck, hand, sleeve). Map casual phrasing ("on my arm") to the closest standard term.',
    size: 'Tattoo size bucket: one of "small" (few inches), "medium" (palm-to-forearm size), "large" (large back/thigh piece), or "sleeve" (full arm/leg sleeve).',
    style:
      'Tattoo style: one of fine_line, minimalist, traditional, neo_traditional, blackwork, realism, watercolor, geometric. Infer from description if not named directly.'
  };

  const system = `You extract a single structured field from a tattoo client's WhatsApp message for a booking bot.
Field to extract: ${field}. Guide: ${fieldGuides[field]}
Respond with ONLY valid JSON, no markdown fences, no preamble, in this exact shape:
{"value": "<the extracted value, snake_case, or null if not mentioned>", "confidence": "high" | "low"}`;

  const raw = await callTextLLM(system, clientMessage, 150);

  try {
    const cleaned = raw.replace(/```json|```/g, '').trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : cleaned);
    return { value: parsed.value ?? null, confidence: parsed.confidence ?? 'low' };
  } catch {
    return { value: null, confidence: 'low' };
  }
}

/**
 * Analyzes a client-submitted reference photo (URL or base64) plus accompanying text
 * to determine tattoo style, complexity, and visual elements.
 */
export async function extractStyleFromImage(
  imageInput: ImageInput | string,
  accompanyingText?: string
): Promise<StyleExtractionResult> {
  const system = `You are an expert tattoo artist and studio booking assistant analyzing a client's reference image.
Identify the tattoo style into exactly one of these canonical categories:
- fine_line (delicate single-needle lines, detailed botanical, fine cursive, micro-tattoos)
- minimalist (simple contours, tiny icons, minimal shading)
- traditional (classic Americana, heavy black outlines, limited primary color flash style)
- neo_traditional (modern evolution of traditional with varied line weights and rich shading)
- blackwork (heavy solid black ink, dotwork, geometric patterns, tribal/ornamental)
- realism (photorealistic portraiture, realistic animal/nature render, high-fidelity shading)
- watercolor (fluid wash effects, splatters, gradient bleeds, no harsh black borders)
- geometric (sacred geometry, mandalas, precise mathematical symmetry and lines)

Also assess design complexity (low | medium | high) and summarize key visual details.
Respond with ONLY valid JSON, no markdown fences, no preamble, in this exact format:
{
  "style": "<canonical_style_snake_case or null>",
  "complexity": "low" | "medium" | "high",
  "details": "<brief summary of key motifs and elements>",
  "confidence": "high" | "low"
}`;

  const userPrompt = accompanyingText?.trim()
    ? `Analyze this tattoo reference image. Accompanying client message: "${accompanyingText}".`
    : 'Analyze this tattoo reference image and classify its style, complexity, and details.';

  try {
    const raw = await callVisionLLM(system, userPrompt, imageInput, 250);
    const cleaned = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(cleaned);

    const validStyles = [
      'fine_line',
      'minimalist',
      'traditional',
      'neo_traditional',
      'blackwork',
      'realism',
      'watercolor',
      'geometric'
    ];

    let detectedStyle = parsed.style ?? parsed.value ?? null;
    if (detectedStyle && !validStyles.includes(detectedStyle)) {
      const match = validStyles.find((s) => detectedStyle.includes(s));
      detectedStyle = match ?? null;
    }

    return {
      style: detectedStyle,
      value: detectedStyle,
      complexity: parsed.complexity || 'medium',
      details: parsed.details || '',
      confidence: parsed.confidence === 'high' ? 'high' : 'low'
    };
  } catch (err) {
    console.warn('Vision API call note:', err);
    // If vision provider encounters an issue (e.g. rate limit or model deprecation),
    // gracefully extract style from the accompanying text description to preserve flow
    if (accompanyingText?.trim()) {
      const textStyle = await extractField('style', accompanyingText);
      return {
        style: textStyle.value,
        value: textStyle.value,
        complexity: 'medium',
        details: accompanyingText.trim(),
        confidence: textStyle.confidence
      };
    }
    return {
      style: null,
      value: null,
      complexity: 'medium',
      details: '',
      confidence: 'low'
    };
  }
}

/**
 * Generates the bot's next natural-language reply given the conversation stage
 * and context. Keeps tone warm and human.
 */
export async function generateReply(
  stage: string,
  context: Record<string, any>,
  studioName: string
): Promise<string> {
  let stageGuide = '';

  if (stage === 'follow_up') {
    stageGuide =
      'The client stopped replying 48 hours ago. Write a gentle, low-pressure check-in (1-2 sentences). Ask if they still want to discuss their tattoo ideas or have any questions. Keep it friendly and zero-pressure.';
  } else if (stage === 'discount_offer') {
    stageGuide = `The client did not respond to the previous follow-up. Offer a limited-time incentive of ${context.discount_percent}% off their quoted price or consultation if they book this week. Be enthusiastic, polite, and reassuring.`;
  }

  const system = `You are the WhatsApp booking assistant for "${studioName}", a tattoo studio in Mumbai/Thane, India.
Tone: warm, casual-professional, brief (2-4 sentences max), like a helpful studio manager texting — not corporate, not robotic.
Never invent pricing, availability, or artist names beyond what's given in context.
Current conversation stage: ${stage}.
Stage guidance: ${stageGuide}
Context: ${JSON.stringify(context)}
Write ONLY the message to send to the client. No preamble, no quotes around it.`;

  return (await callTextLLM(system, 'Generate the next reply.', 250)).trim();
}
