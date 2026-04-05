import express from 'express';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';

const router = express.Router();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// GET /api/content/articles?category=wealth&lang=en
router.get('/articles', async (req, res) => {
  const { category, lang = 'en', tier = 'free', limit = 20 } = req.query;

  let query = supabase
    .from('articles')
    .select('id, title, slug, summary, category, language, featured_image_url, tags, access_tier, published_at')
    .eq('published', true)
    .eq('language', lang)
    .order('published_at', { ascending: false })
    .limit(parseInt(limit));

  if (category) query = query.eq('category', category);
  if (tier === 'free') query = query.eq('access_tier', 'free');

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ articles: data });
});

// GET /api/content/resources
router.get('/resources', async (req, res) => {
  const { lang = 'en', limit = 20 } = req.query;

  const { data, error } = await supabase
    .from('free_resources')
    .select('*')
    .eq('published', true)
    .eq('language', lang)
    .eq('access_tier', 'free')
    .order('created_at', { ascending: false })
    .limit(parseInt(limit));

  if (error) return res.status(500).json({ error: error.message });
  res.json({ resources: data });
});

// POST /api/content/generate — internal use, requires service key
router.post('/generate', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { topic, category, language = 'en', type = 'article' } = req.body;

  if (!topic || !category) {
    return res.status(400).json({ error: 'topic and category required' });
  }

  try {
    const systemPrompt = `You are a spiritual wellness content creator for Soul Resonances,
    a brand focused on Feng Shui, astrology, and spiritual guidance.
    Brand voice: soft feminine luxe, calm authority, warm and elegant.
    Audience: women seeking abundance, love, and alignment.
    Tone: soothing, confident, spiritual but practical. No fear language.
    Language: ${language === 'es' ? 'Spanish' : 'English'}.`;

    const userPrompt = `Write a ${type} about: "${topic}" in the category: ${category}.
    Include: title, 150-word article body, 3 key takeaways, and 5 SEO tags.
    Format as JSON: { "title": "", "content": "", "summary": "", "tags": [], "seo_title": "" }`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      response_format: { type: 'json_object' }
    });

    const generated = JSON.parse(completion.choices[0].message.content);
    const slug = generated.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

    const { data, error } = await supabase
      .from('articles')
      .insert({
        title: generated.title,
        slug: `${slug}-${Date.now()}`,
        content: generated.content,
        summary: generated.summary,
        category,
        language,
        tags: generated.tags,
        access_tier: 'free',
        published: true,
        published_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true, article: data });

  } catch (err) {
    console.error('[content/generate] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/content/daily-batch — called by cron, generates content calendar
router.post('/daily-batch', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const topics = [
    { topic: '2026 Wealth Windows for Your Rising Sign', category: 'wealth' },
    { topic: 'Flying Stars March 2026: Activate Your Money Corner', category: 'flying_stars' },
    { topic: 'Venus in Taurus: Feng Shui Your Love Corner', category: 'love' },
    { topic: 'Full Moon Energy Clearing Ritual', category: 'moon_rituals' },
    { topic: 'Career Feng Shui: Your Office Layout for Success', category: 'career' },
    { topic: 'Protection Crystals and Energy Shields for 2026', category: 'protection' }
  ];

  const today = new Date().toISOString().split('T')[0];
  const results = [];

  for (const t of topics) {
    const { data, error } = await supabase
      .from('content_calendar')
      .insert({
        title: t.topic,
        platform: 'youtube',
        content_type: 'short',
        language: 'en',
        scheduled_date: today,
        status: 'planned',
        category: t.category
      })
      .select()
      .single();

    if (!error) results.push(data);
  }

  res.json({ success: true, created: results.length });
});

export default router;
