// /admin: people, types, forms and lists. Loaded only when opened, so the map doesn't carry it. The
// screens offer it to Admins only, and the database refuses everyone else whatever the screens do.
import { Link, Navigate, NavLink, Route, Routes } from 'react-router-dom';
import type { AppUser, MapData } from '../data/types';
import { StoreContext } from '../state/store-context';
import { useMapData } from '../state/use-map-data';
import { AuditSection } from './AuditSection';
import { BarangayFieldsSection } from './BarangayFieldsSection';
import { LookupSection, type LookupRow } from './LookupSection';
import { TypeEditorRoute, TypesList } from './TypesSection';
import { UsersSection } from './UsersSection';

const SECTIONS = [
  { path: 'users', label: 'Users' },
  { path: 'types', label: 'Intervention types' },
  { path: 'categories', label: 'Categories' },
  { path: 'programs', label: 'Programs' },
  { path: 'statuses', label: 'Statuses' },
  { path: 'lists', label: 'Other lists' },
  { path: 'barangay-fields', label: 'Barangay fields' },
  { path: 'audit', label: 'Audit log' },
];

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
  return (
    <main className="admin-page">
      <nav className="admin-nav" aria-label="Admin">
        {SECTIONS.map((section) => (
          <NavLink key={section.path} to={`/admin/${section.path}`} className={({ isActive }) => `admin-nav-link${isActive ? ' active' : ''}`}>
            {section.label}
          </NavLink>
        ))}
      </nav>
      <div className="admin-content">
        <Routes>
          <Route path="/admin" element={<Navigate to="/admin/users" replace />} />
          <Route path="/admin/users" element={<UsersSection />} />
          <Route path="/admin/types" element={<TypesList data={data} />} />
          <Route path="/admin/types/:id" element={<TypeEditorRoute data={data} />} />
          <Route
            path="/admin/categories"
            element={
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
              />
            }
          />
          <Route
            path="/admin/programs"
            element={
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
              />
            }
          />
          <Route
            path="/admin/statuses"
            element={
              <LookupSection
                title="Statuses"
                singular="status"
                description="All the status names. Which ones each type uses is set on its page, under Intervention types."
                table="statuses"
                rows={data.statuses}
                fields={['color']}
                data={data}
                usage={(row) => data.interventions.filter((record) => record.status_id === row.id).length}
              />
            }
          />
          <Route path="/admin/lists" element={<OtherLists data={data} />} />
          <Route path="/admin/barangay-fields" element={<BarangayFieldsSection data={data} />} />
          <Route path="/admin/audit" element={<AuditSection data={data} />} />
          <Route path="*" element={<Navigate to="/admin/users" replace />} />
        </Routes>
      </div>
    </main>
  );
}

export function AdminPage({ user }: { user: AppUser }) {
  if (user.role !== 'admin') {
    return (
      <div className="page-message" role="alert">
        <h2>This page is for Admins</h2>
        <p>
          Your account can't change these settings. <Link to="/">Back to the map</Link>
        </p>
      </div>
    );
  }
  return <AdminLoader user={user} />;
}

function AdminLoader({ user }: { user: AppUser }) {
  const state = useMapData(user);
  if (state.status === 'loading') return <p className="page-message">Loading…</p>;
  if (state.status === 'error') {
    return (
      <div className="page-message" role="alert">
        <h2>This page could not load</h2>
        <p>{state.error.message}</p>
      </div>
    );
  }
  return (
    <StoreContext.Provider value={{ store: state.store, places: state.places }}>
      <AdminWorkspace data={state.data} />
    </StoreContext.Provider>
  );
}
