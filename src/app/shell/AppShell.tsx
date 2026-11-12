// The frame around every signed-in page: the sidebar, the top bar and the sources line. On a phone
// the sidebar is a drawer, opened from the top bar.
import { ChartColumn, ChevronDown, ClipboardList, FileText, FileUp, Gauge, History, House, KeyRound, List, ListChecks, LogOut, Map as MapIcon, MapPin, Menu, PenLine, Shapes, Users, X, type LucideIcon } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import type { AppUser } from '../../modules/intervention-map/data/types';
import { ROLE_LABELS } from '../../modules/intervention-map/lib/permissions';
import { APP_NAME, OFFICE_NAME } from '../brand';
import { isCurrent, navGroups, type NavIcon } from './nav';

const ICONS: Record<NavIcon, LucideIcon> = {
  home: House,
  dashboard: ChartColumn,
  map: MapIcon,
  records: ClipboardList,
  qa: ListChecks,
  condition: Gauge,
  import: FileUp,
  reports: FileText,
  users: Users,
  types: Shapes,
  lists: List,
  signatures: PenLine,
  audit: History,
};

export interface Account {
  changePassword(): void;
  signOut(): void;
}

function initials(name: string | null): string {
  const words = (name ?? '').split(/\s+/).filter((word) => /^\p{L}/u.test(word));
  if (words.length === 0) return '?';
  return (words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words[words.length - 1][0]).toUpperCase();
}

function Sidebar({ user, open, onClose }: { user: AppUser; open: boolean; onClose(): void }) {
  const { pathname } = useLocation();
  const headingId = useId();
  return (
    <nav id="main-menu" className={`sidebar${open ? ' is-open' : ''}`} aria-label="Main">
      <div className="sidebar-top">
        <Link to="/" className="sidebar-brand" onClick={onClose}>
          <span className="sidebar-logo">
            <MapPin aria-hidden="true" strokeWidth={2.25} />
          </span>
          <span className="sidebar-name">
            <strong>{APP_NAME}</strong>
            <span>{OFFICE_NAME}</span>
          </span>
        </Link>
        <button type="button" className="sidebar-close" aria-label="Close the menu" onClick={onClose}>
          <X aria-hidden="true" />
        </button>
      </div>
      {navGroups(user.role).map((group, index) => (
        <div key={group.label} className="sidebar-group">
          <div className="sidebar-heading" id={`${headingId}-${index}`}>
            {group.label}
          </div>
          <ul aria-labelledby={`${headingId}-${index}`}>
            {group.items.map((item) => {
              const Icon = ICONS[item.icon];
              const current = isCurrent(item, pathname);
              return (
                <li key={item.to}>
                  <Link to={item.to} className="sidebar-link" aria-current={current ? 'page' : undefined} onClick={onClose}>
                    <Icon aria-hidden="true" />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function AccountMenu({ user, account }: { user: AppUser; account: Account }) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !box.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', close);
    document.addEventListener('pointerdown', close);
    return () => {
      document.removeEventListener('keydown', close);
      document.removeEventListener('pointerdown', close);
    };
  }, [open]);

  const choose = (action: () => void) => () => {
    setOpen(false);
    action();
  };

  return (
    <div className="account" ref={box}>
      <button
        type="button"
        className="account-button"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={`Account: ${user.full_name ?? 'Signed in'}, ${ROLE_LABELS[user.role]}`}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="avatar" aria-hidden="true">
          {initials(user.full_name)}
        </span>
        <span className="account-who" aria-hidden="true">
          <strong>{user.full_name ?? 'Signed in'}</strong>
          <span>{ROLE_LABELS[user.role]}</span>
        </span>
        <ChevronDown aria-hidden="true" className="account-chevron" />
      </button>
      <div id={menuId} className="account-menu" hidden={!open}>
        <button type="button" onClick={choose(account.changePassword)}>
          <KeyRound aria-hidden="true" />
          Change password
        </button>
        <button type="button" onClick={choose(account.signOut)}>
          <LogOut aria-hidden="true" />
          Sign out
        </button>
      </div>
    </div>
  );
}

function TopBar({ user, account, menuOpen, onMenu }: { user: AppUser; account?: Account; menuOpen: boolean; onMenu(): void }) {
  return (
    <header className="topbar">
      <button type="button" className="topbar-menu" aria-label="Open the menu" aria-controls="main-menu" aria-expanded={menuOpen} onClick={onMenu}>
        <Menu aria-hidden="true" />
      </button>
      <span className="topbar-title">{APP_NAME}</span>
      {account ? (
        <AccountMenu user={user} account={account} />
      ) : (
        <span className="topbar-local">
          {user.full_name ?? 'Local user'} · {ROLE_LABELS[user.role]}
        </span>
      )}
    </header>
  );
}

export function AppShell({ user, account, footer, children }: { user: AppUser; account?: Account; footer: ReactNode; children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const { pathname } = useLocation();

  // Following a link closes the drawer. The links close it themselves too, for a link to the page
  // already open, which leaves the address as it was.
  useEffect(() => setMenuOpen(false), [pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [menuOpen]);

  return (
    <div className="shell">
      <a className="skip-link" href="#main-content">
        Skip to the page
      </a>
      <Sidebar user={user} open={menuOpen} onClose={() => setMenuOpen(false)} />
      {menuOpen && <div className="shell-backdrop" aria-hidden="true" onClick={() => setMenuOpen(false)} />}
      <div className="shell-main">
        <TopBar user={user} account={account} menuOpen={menuOpen} onMenu={() => setMenuOpen(true)} />
        <div className="shell-content" id="main-content" tabIndex={-1}>
          {children}
        </div>
        <footer className="app-footer">{footer}</footer>
      </div>
    </div>
  );
}
