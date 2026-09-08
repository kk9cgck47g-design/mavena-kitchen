import { EmptyState, PageHeader } from '@/components/admin/admin-ui';
import { DemoBanner } from '@/components/admin/demo-banner';
import { StaffBoard } from '@/components/admin/staff-board';
import { listStaff } from '@/server/services/admin-staff';
import { adminGate, Forbidden, Unconfigured } from '../guard';
import { ADMIN_TEXT } from '../strings';

/**
 * Staff accounts. Owner only, at both ends: this gate decides whether the page
 * renders, and every action it offers checks the role again for itself.
 */
export default async function AdminStaffPage() {
  const gate = await adminGate({ require: 'OWNER' });

  if (gate.mode === 'unconfigured') return <Unconfigured />;
  if (gate.mode === 'forbidden') return <Forbidden />;

  /*
    The preview has no database and no accounts, and inventing fake staff would
    be the one demo screen where a visitor could not tell the difference between
    a demonstration and a real list of people. It says so instead.
  */
  if (gate.mode === 'demo') {
    return (
      <div className="mx-auto max-w-4xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
        <DemoBanner />
        <PageHeader title={ADMIN_TEXT.staff.title} subtitle={ADMIN_TEXT.staff.subtitle} />
        <EmptyState title={ADMIN_TEXT.staff.errors.DEMO_MODE} />
      </div>
    );
  }

  const staff = await listStaff();

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
      <PageHeader title={ADMIN_TEXT.staff.title} subtitle={ADMIN_TEXT.staff.subtitle} />
      <StaffBoard staff={staff} currentUserId={gate.admin.id} />
    </div>
  );
}
