import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { StubPaymentScreen } from '@/components/payment/stub-payment-screen';
import { demoTokenFromReference, IS_DEMO } from '@/lib/demo';
import { configuredProvider } from '@/server/payments/registry';
import { getStubSession } from '@/server/payments/stub';
import { demoOrderByToken, demoTokenFor } from '@/server/demo/orders';

/**
 * The stub provider's payment page.
 *
 * A test fixture that has to behave like a production dependency, so it is gated
 * as carefully as one: it renders only while the stub is the configured provider,
 * or in the demo where there is no provider at all. On a deployment with a real
 * acquirer it does not exist, because a page that decides payment outcomes is not
 * something to leave lying around next to one that takes them.
 *
 * It lives under `[locale]` rather than beside the API routes because a customer
 * reads it, in whichever language they were shopping in. With a real provider this
 * page is on the bank's domain and none of this is ours to render — which is why
 * nothing outside this directory links to it by path. The URL comes back from
 * `createSession`, the way a real one would.
 */

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('pay');

  return {
    title: t('title'),
    // A payment page has no business in a search index, and the reference in the
    // URL has no business in a referrer header.
    robots: { index: false, follow: false },
    referrer: 'no-referrer',
  };
}

export default async function PayPage({
  params,
}: {
  params: Promise<{ locale: string; reference: string }>;
}) {
  const { reference } = await params;

  /*
    Demo first, and it never touches the database.

    The reference is the demo order's tracking token with a prefix, so the page can
    find the order it belongs to among the generated ones. Nothing is looked up,
    nothing is written, and the decision the customer makes here lives in a store
    in their own tab.
  */
  if (IS_DEMO) {
    const token = demoTokenFromReference(reference);
    const order = token ? demoOrderByToken(token) : null;

    if (!order || order.paymentMethod !== 'ONLINE') notFound();

    return (
      <StubPaymentScreen
        reference={reference}
        publicCode={order.publicCode}
        amount={order.total}
        settled={false}
        demo={{ trackingToken: demoTokenFor(order) }}
      />
    );
  }

  // Not the stub's deployment, so this page is not part of it.
  if (configuredProvider()?.name !== 'stub') notFound();

  const session = await getStubSession(reference);
  if (!session) notFound();

  return (
    <StubPaymentScreen
      reference={session.externalId}
      publicCode={session.label}
      amount={session.amount}
      // A decided session is shown rather than hidden: a customer who refreshes
      // after paying should see what happened, not a 404 suggesting they imagined
      // it.
      settled={session.state !== 'PENDING'}
      demo={null}
    />
  );
}
