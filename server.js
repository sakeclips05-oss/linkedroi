// ═══════════════════════════════════════════
// LINKEDROI — CLICK TRACKING REDIRECT SERVER
// Deploy this on Railway or Render (free tier)
// ═══════════════════════════════════════════

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Supabase (use SERVICE ROLE key here for server-side writes) ──
const db = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

app.use(cors({ origin: '*' }));
app.use(express.json());

// ── HEALTH CHECK ──
app.get('/', (req, res) => {
  res.json({ status: 'LinkedROI redirect server running' });
});

// ── SMART LINK REDIRECT + CLICK TRACKING ──
app.get('/r/:slug', async (req, res) => {
  const { slug } = req.params;

  try {
    // Find post by slug
    const { data: post, error } = await db
      .from('posts')
      .select('id, destination_url, clicks_count')
      .eq('slug', slug)
      .single();

    if (error || !post) {
      return res.status(404).send('Link not found');
    }

    // Log the click (fire and forget — don't delay redirect)
    db.from('clicks').insert({
      post_id: post.id,
      ip_address: req.ip || req.headers['x-forwarded-for'],
      user_agent: req.headers['user-agent'],
      referrer: req.headers['referer'] || null
    }).then(() => {
      // Increment click count
      return db.from('posts')
        .update({ clicks_count: (post.clicks_count || 0) + 1 })
        .eq('id', post.id);
    }).catch(err => console.error('Click log error:', err));

    // Redirect immediately
    const dest = post.destination_url || '/';
    return res.redirect(302, dest);

  } catch (err) {
    console.error('Redirect error:', err);
    return res.status(500).send('Server error');
  }
});

// ── LEAD CAPTURE WEBHOOK (from your landing page form) ──
// Call POST /webhook/lead from your landing page when someone fills a form
app.post('/webhook/lead', async (req, res) => {
  const { post_id, name, email, user_id } = req.body;
  if (!name || !email || !user_id) {
    return res.status(400).json({ error: 'name, email, user_id required' });
  }

  try {
    // Insert lead
    const { data: lead, error } = await db.from('leads').insert({
      user_id,
      post_id: post_id || null,
      name, email,
      stage: 'New lead',
      deal_value: 0
    }).select().single();

    if (error) return res.status(400).json({ error: error.message });

    // Update leads_count on post
    if (post_id) {
      const { data: post } = await db.from('posts').select('leads_count').eq('id', post_id).single();
      if (post) {
        await db.from('posts').update({ leads_count: (post.leads_count || 0) + 1 }).eq('id', post_id);
      }
    }

    return res.json({ success: true, lead_id: lead.id });
  } catch (err) {
    console.error('Webhook error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

app.listen(PORT, () => {
  console.log(`LinkedROI server running on port ${PORT}`);
});
