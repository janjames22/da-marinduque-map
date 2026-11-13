// /admin: people, types, forms and lists. Loaded only when opened, so the map doesn't carry it. The
// screens offer it to Admins only, and the database refuses everyone else whatever the screens do.
import type { ReactNode } from 'react';
import { Link, Navigate, NavLink, Route, Routes } from 'react-router-dom';
import { MAP_PATH } from '../lib/map-paths';
import type { AppUser, MapData } from '../data/types';
import { StoreContext } from '../state/store-context';
import { useMapData } from '../state/use-map-data';
import { AuditSection } from './AuditSection';
import { BarangayFieldsSection } from './BarangayFieldsSection';
import { LookupSection, type LookupRow } from './LookupSection';
import { TypeEditorRoute, TypesList } from './TypesSection';
import { UsersSection } from './UsersSection';
import '../overview/overview.css';
import '../records/records.css';
import './admin.css';
import { PageError, PageLoading, PageNoAccess } from '../overview/PageState';

// The sidebar has one link for each of these pages, and the pages that hold several lists have tabs.
interface Tab {
  path: string;
  label: string;
}

const TYPES_AND_FIELDS: Tab[] = [
  { path: '/admin/types', label: 'Intervention types' },
  { path: '/admin/barangay-fields', label: 'Barangay fields' },
];

const LISTS: Tab[] = [
  { path: '/admin/categories', label: 'Categories' },
  { path: '/admin/programs', label: 'Programs' },
  { path: '/admin/statuses', label: 'Statuses' },
  { path: '/admin/lists', label: 'Other lists' },
];

// One page in the new design: its header and tabs when it has several lists, then its cards. A page
// with one list gets its header from that list's section.
function AdminFrame({ title, description, tabs, children }: { title: string; description?: string; tabs?: Tab[]; children: ReactNode }) {
  return (
    <main className="overview-page admin-page" aria-label={title}>
      {tabs && (
        <>
          <header className="page-header">
            <h1>{title}</h1>
            {description && <p>{description}</p>}
          </header>
          <nav className="page-tabs" aria-label={title}>
            {tabs.map((tab) => (
              <NavLink key={tab.path} to={tab.path} className="page-tab">
                {tab.label}
              </NavLink>
            ))}
          </nav>
        </>
      )}
      {children}
    </main>
  );
}

function OtherLists({ data }: { data: MapData }) {
  const records = (key: 'beneficiary_type_id' | 'location_basis_id') => (row: LookupRow) => data.interventions.filter((record) => record[key] === row.id).length;
  return (
    <>
      <LookupSection
        title="Category groups"
        singular="group"
        description="How categories are grouped. A new category takes its group's icon."
        table="category_groups"
        rows={data.categoryGroups}
        fields={['icon']}
        data={data}
        hasCode
        canArchive={false}
        usage={(row) => data.categories.filter((category) => category.category_group_id === row.id).length}
        usageWord="category"
      />
      <LookupSection
        title="Beneficiary types"
        singular="beneficiary type"
        description="The kinds of beneficiary a record can have."
        table="beneficiary_types"
        rows={data.beneficiaryTypes}
        data={data}
        usage={records('beneficiary_type_id')}
      />
      <LookupSection
        title="Location bases"
        singular="location basis"
        description="What a record's coordinates actually mark."
        table="location_bases"
        rows={data.locationBases}
        fields={['color']}
        data={data}
        usage={records('location_basis_id')}
      />
      <LookupSection
        title="Icons"
        singular="icon"
        description="The drawings used on map markers and in KMZ files."
        table="icons"
        rows={data.icons}
        fields={['image']}
        data={data}
        canReorder={false}
        usage={(row) =>
          data.categories.filter((category) => category.icon_id === row.id).length + data.types.filter((type) => type.icon_id === row.id).length
        }
        usageWord="use"
      />
    </>
  );
}

function AdminWorkspace({ data }: { data: MapData }) {
  const types = (page: ReactNode) => (
    <AdminFrame title="Types and fields" description="The kinds of intervention, the form each one gets, and the fields kept for every barangay." tabs={TYPES_AND_FIELDS}>
      {page}
    </AdminFrame>
  );
  const lists = (page: ReactNode) => (
    <AdminFrame title="Lists" description="The choices offered on the forms, the filters and the map's legend." tabs={LISTS}>
      {page}
    </AdminFrame>
  );
  return (
    <Routes>
      <Route path="/admin" element={<Navigate to="/admin/users" replace />} />
      <Route
        path="/admin/users"
        element={
          <AdminFrame title="Users">
            <UsersSection />
          </AdminFrame>
        }
      />
      <Route path="/admin/types" element={types(<TypesList data={data} />)} />
      <Route path="/admin/types/:id" element={types(<TypeEditorRoute data={data} />)} />
      <Route path="/admin/barangay-fields" element={types(<BarangayFieldsSection data={data} />)} />
      <Route
        path="/admin/categories"
        element={lists(
          <LookupSection
            title="Categories"
            singular="category"
            description="What a record is, within its type. A new category takes its group's icon unless you choose one."
            table="categories"
            rows={data.categories}
            fields={['type', 'group', 'icon']}
            data={data}
            hasCode
            usage={(row) => data.interventions.filter((record) => record.category_id === row.id).length}
          />,
        )}
      />
      <Route
        path="/admin/programs"
        element={lists(
          <LookupSection
            title="Programs"
            singular="program"
            description="Banner programs. A program's color is the color of its markers everywhere, including exports."
            table="programs"
            rows={data.programs}
            fields={['color']}
            data={data}
            hasCode
            usage={(row) => data.interventions.filter((record) => record.banner_program_id === row.id).length}
          />,
        )}
      />
      <Route
        path="/admin/statuses"
        element={lists(
          <LookupSection
            title="Statuses"
            singular="status"
            description="All the status names, and whether each says a unit's condition has been checked. Which ones each type uses, and which count as operational, is set on its page, under Intervention types."
            table="statuses"
            rows={data.statuses}
            fields={['color', 'assessed']}
            data={data}
            usage={(row) => data.interventions.filter((record) => record.status_id === row.id).length}
          />,
        )}
      />
      <Route path="/admin/lists" element={lists(<OtherLists data={data} />)} />
      <Route
        path="/admin/signatures"
        element={
          <AdminFrame title="Signature blocks">
            <LookupSection
              asPage
              title="Signature blocks"
              singular="signature"
              description="The signature blocks at the foot of every report and printed map, left to right in this order. Archive one to leave it off."
              table="report_signatories"
              rows={data.signatories}
              fields={['label', 'position']}
              data={data}
            />
          </AdminFrame>
        }
      />
      <Route
        path="/admin/audit"
        element={
          <AdminFrame title="Audit log">
            <AuditSection data={data} />
          </AdminFrame>
        }
      />
      <Route path="*" element={<Navigate to="/admin/users" replace />} />
    </Routes>
  );
}

export function AdminPage({ user }: { user: AppUser }) {
  if (user.role !== 'admin') {
    return (
      <PageNoAccess title="This page is for Admins">
        Your account can't change these settings. <Link to={MAP_PATH}>Back to the map</Link>
      </PageNoAccess>
    );
  }
  return <AdminLoader user={user} />;
}

function AdminLoader({ user }: { user: AppUser }) {
  const state = useMapData(user);
  if (state.status === 'loading') return <PageLoading />;
  if (state.status === 'error') return <PageError error={state.error} onRetry={state.retry} />;
  return (
    <StoreContext.Provider value={{ store: state.store, places: state.places }}>
      <AdminWorkspace data={state.data} />
    </StoreContext.Provider>
  );
}
