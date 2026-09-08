import { DemoBanner } from '@/components/admin/demo-banner';
import { OrderingPause } from '@/components/admin/ordering-pause';
import { PageHeader } from '@/components/admin/admin-ui';
import { TelegramSettings } from '@/components/admin/telegram-settings';
import { getSettings } from '@/server/services/settings';
import { botToken, webhookSecret } from '@/server/telegram/config';
import { adminGate, Forbidden, Unconfigured } from '../guard';
import { ADMIN_TEXT } from '../strings';

/**
 * Where the kitchen tickets go.
 *
 * The two secrets stay in the environment and are never shown here — the page
 * reports only whether they are set, because an admin screen that displays a
 * bot token is a bot token in a screenshot.
 */
export default async function AdminSettingsPage() {
  const gate = await adminGate({ require: 'OWNER' });
  if (gate.mode === 'unconfigured') return <Unconfigured />;
  if (gate.mode === 'forbidden') return <Forbidden />;

  const settings = await getSettings();

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
      {gate.mode === 'demo' && <DemoBanner />}

      <PageHeader
        title={ADMIN_TEXT.settings.title}
        subtitle={
          gate.mode === 'demo' ? ADMIN_TEXT.settings.demoBlocked : ADMIN_TEXT.settings.subtitle
        }
      />

      {/* First on the page, and above Telegram deliberately: this is the one
          control here that an owner opens the panel in a hurry to reach. */}
      <OrderingPause
        isAcceptingOrders={settings.isAcceptingOrders}
        readOnly={gate.mode === 'demo'}
      />

      <TelegramSettings
        chatIds={settings.telegramChatIds}
        readOnly={gate.mode === 'demo'}
        hasToken={botToken() !== null}
        hasWebhookSecret={webhookSecret() !== null}
      />
    </div>
  );
}
