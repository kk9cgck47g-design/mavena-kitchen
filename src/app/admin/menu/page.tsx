import { DemoBanner } from '@/components/admin/demo-banner';
import { PageHeader } from '@/components/admin/admin-ui';
import { MenuBoard } from '@/components/admin/menu-board';
import { demoMenu } from '@/server/demo/catalog';
import { listMenuForAdmin, type AdminMenuItem } from '@/server/services/admin-menu';
import { adminGate, Forbidden, Unconfigured } from '../guard';
import { ADMIN_TEXT } from '../strings';

/**
 * Price and availability.
 *
 * Read-only in the preview, and that is not a UI decision — the demo has no
 * database to write to, and the server actions behind these controls refuse in
 * demo mode before they reach a service. Showing the screen with its controls
 * disabled is what tells an owner what the panel does without pretending the
 * preview can do it.
 */
export default async function AdminMenuPage() {
  const gate = await adminGate();
  if (gate.mode === 'unconfigured') return <Unconfigured />;
  // Not reachable while this page asks for no particular role, and handled so
  // that adding one later cannot silently render the page to somebody it should
  // not.
  if (gate.mode === 'forbidden') return <Forbidden />;

  const items = gate.mode === 'demo' ? demoMenuForAdmin() : await listMenuForAdmin();

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
      {gate.mode === 'demo' && <DemoBanner />}

      <PageHeader
        title={ADMIN_TEXT.menu.title}
        subtitle={gate.mode === 'demo' ? ADMIN_TEXT.menu.demoBlocked : ADMIN_TEXT.menu.subtitle}
      />

      <p className="text-muted-foreground text-xs">{ADMIN_TEXT.menu.priceHint}</p>

      {/*
        The menu is the one screen both roles use and use differently. A manager
        works the stop list all evening; changing what a dish costs is the
        owner's. `canEditPrices` decides what is drawn, and `updateDishPrice`
        checks the role again for itself.
      */}
      <MenuBoard
        items={items}
        readOnly={gate.mode === 'demo'}
        canEditPrices={gate.mode === 'demo' || gate.admin.role === 'OWNER'}
      />
    </div>
  );
}

function demoMenuForAdmin(): AdminMenuItem[] {
  return demoMenu().flatMap((category) =>
    category.products.map((product) => ({
      id: product.id,
      slug: product.slug,
      name: product.name,
      categoryName: category.name,
      basePrice: product.basePrice,
      isAvailable: product.isAvailable,
      isActive: product.isActive,
      image: product.images[0] ?? null,
      hasOptions: product.optionGroups.length > 0,
    })),
  );
}
