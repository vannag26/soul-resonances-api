import express from 'express';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const router = express.Router();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Map Stripe price IDs to subscription tiers
const PRICE_TIER_MAP = {
  'price_1THQh5HMl8HQn0IDqEyqdivc': 'seeker',    // $9/mo Basic
  'price_1TIeQ2HMl8HQn0IDgeqmtnjO': 'awakened',   // $19/mo Pro
  'price_1TIeQ6HMl8HQn0IDSCpBc0kW': 'enlightened' // $39/mo Enterprise
};

// POST /api/webhooks/stripe
router.post('/stripe', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log(`[Stripe Webhook] ${event.type}`);

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        if (session.mode === 'subscription') {
          await handleSubscriptionCreated(session.subscription, session.customer_email);
        }
        break;
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const subscription = event.data.object;
        await handleSubscriptionUpdate(subscription);
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        await handleSubscriptionCanceled(subscription);
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        await handlePaymentFailed(invoice);
        break;
      }

      default:
        console.log(`[Stripe Webhook] Unhandled event type: ${event.type}`);
    }
  } catch (err) {
    console.error('[Stripe Webhook] Handler error:', err.message);
    return res.status(500).json({ error: 'Handler failed' });
  }

  res.json({ received: true });
});

async function handleSubscriptionCreated(subscriptionId, email) {
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const priceId = subscription.items.data[0]?.price?.id;
  const tier = PRICE_TIER_MAP[priceId] || 'seeker';

  const { error } = await supabase
    .from('profiles')
    .update({
      stripe_subscription_id: subscriptionId,
      stripe_customer_id: subscription.customer,
      subscription_tier: tier,
      subscription_status: subscription.status,
      updated_at: new Date().toISOString()
    })
    .eq('email', email);

  if (error) console.error('[handleSubscriptionCreated] Supabase error:', error.message);
  else console.log(`[Stripe] Subscription created: ${tier} for ${email}`);
}

async function handleSubscriptionUpdate(subscription) {
  const priceId = subscription.items.data[0]?.price?.id;
  const tier = PRICE_TIER_MAP[priceId] || 'seeker';

  const { error } = await supabase
    .from('profiles')
    .update({
      subscription_tier: tier,
      subscription_status: subscription.status,
      stripe_subscription_id: subscription.id,
      updated_at: new Date().toISOString()
    })
    .eq('stripe_customer_id', subscription.customer);

  if (error) console.error('[handleSubscriptionUpdate] Supabase error:', error.message);
  else console.log(`[Stripe] Subscription updated: ${tier}, status: ${subscription.status}`);
}

async function handleSubscriptionCanceled(subscription) {
  const { error } = await supabase
    .from('profiles')
    .update({
      subscription_status: 'canceled',
      subscription_tier: null,
      updated_at: new Date().toISOString()
    })
    .eq('stripe_customer_id', subscription.customer);

  if (error) console.error('[handleSubscriptionCanceled] Supabase error:', error.message);
  else console.log(`[Stripe] Subscription canceled for customer: ${subscription.customer}`);
}

async function handlePaymentFailed(invoice) {
  const { error } = await supabase
    .from('profiles')
    .update({
      subscription_status: 'past_due',
      updated_at: new Date().toISOString()
    })
    .eq('stripe_customer_id', invoice.customer);

  if (error) console.error('[handlePaymentFailed] Supabase error:', error.message);
  else console.log(`[Stripe] Payment failed for customer: ${invoice.customer}`);
}

export default router;
