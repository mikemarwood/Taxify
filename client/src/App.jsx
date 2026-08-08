import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './lib/AuthContext.jsx';
import { useEntities } from './lib/EntityContext.jsx';
import { homePathFor } from './lib/home.js';
import Layout from './components/Layout.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import StartupScreen from './components/StartupScreen.jsx';
import PublicShell from './components/PublicShell.jsx';
import Landing from './pages/Landing.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import Terms from './pages/Terms.jsx';
import Privacy from './pages/Privacy.jsx';
import Activate from './pages/Activate.jsx';
import ForgotPassword from './pages/ForgotPassword.jsx';
import ResetPassword from './pages/ResetPassword.jsx';
import AcceptInvite from './pages/AcceptInvite.jsx';
import ConfirmEmail from './pages/ConfirmEmail.jsx';
import ClientPicker from './pages/ClientPicker.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Expenses from './pages/Expenses.jsx';
import AddExpense from './pages/AddExpense.jsx';
import Categories from './pages/Categories.jsx';
import Books from './pages/Books.jsx';
import Reports from './pages/Reports.jsx';
import Deductions from './pages/Deductions.jsx';
import Admin from './pages/Admin.jsx';
import Account from './pages/Account.jsx';
import Support, { SupportTicket, SupportTicketByToken } from './pages/Support.jsx';
import SubscriptionRequired from './pages/SubscriptionRequired.jsx';

// Nothing, on purpose.
//
// index.html paints the boot screen before any JavaScript runs, and it now sits
// *over* the app rather than inside #root — so it is still there, unbroken,
// while this returns. Drawing a second copy of the same logo underneath it is
// what made the app appear to load twice.
//
// StartupScreen is still used where a splash is genuinely a new event rather
// than a continuation of the first paint.
function Splash() {
  return null;
}

// Support is the one page reachable either way, so it needs both shells.
//
// Signed in it belongs inside the app, with the navigation and the books
// picker, because it is a page of the app like any other. Signed out there is
// no navigation to give it — but it still needs to look like Taxify rather
// than a bare form floating on a background, which is what it did before.
function SupportShell({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <Splash />;

  if (user) {
    return (
      <ErrorBoundary key="shell|support">
        <Layout>
          <ErrorBoundary key="page|support">{children}</ErrorBoundary>
        </Layout>
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary key="public|support">
      <PublicShell>{children}</PublicShell>
    </ErrorBoundary>
  );
}

// Inside a client's books an accountant reads, and reads only these.
const CLIENT_VIEW_PATHS = ['/', '/expenses', '/reports', '/account'];

function Protected({ children, adminOnly }) {
  const { user, loading } = useAuth();
  const { selectedId } = useEntities();
  const location = useLocation();
  if (loading) return <Splash />;
  if (!user) return <Navigate to="/login" replace />;
  if (adminOnly && !user.isAdmin) return <Navigate to="/" replace />;

  // Inside a client's books: held to reading, and to the pages that mean
  // something for someone else's tax.
  if (user.actingAsClient) {
    if (!CLIENT_VIEW_PATHS.includes(location.pathname)) return <Navigate to="/" replace />;
  } else if (user.role === 'accountant') {
    // Invited purely as an accountant and not inside a client — they have no
    // books of their own yet, so the only things here are the client picker
    // and their own profile.
    if (location.pathname !== '/account') return <Navigate to="/clients" replace />;
  }

  if (!adminOnly && user.accessLocked && location.pathname !== '/account') {
    return (
      <ErrorBoundary key={`shell|${location.pathname}`}>
        <Layout>
          <SubscriptionRequired />
        </Layout>
      </ErrorBoundary>
    );
  }
  // Two boundaries, because they catch different things.
  //
  // The outer one wraps Layout itself. Layout renders the nav, the books
  // picker and the notification bell, and a throw in any of them used to take
  // the whole page with it — a white screen with no message, and nothing sent
  // to /api/app/client-error either, because the only boundary was inside. The
  // one failure that gives you nothing to go on was the one it could not catch.
  //
  // The inner one keeps a page error from costing you the navigation, and is
  // keyed on the books as well as the path so switching between them remounts
  // the page and it refetches.
  return (
    <ErrorBoundary key={`shell|${location.pathname}`}>
      <Layout>
        <ErrorBoundary key={`${location.pathname}|${selectedId ?? 'all'}`}>{children}</ErrorBoundary>
      </Layout>
    </ErrorBoundary>
  );
}

function PublicOnly({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <Splash />;
  if (user) return <Navigate to={homePathFor(user)} replace />;
  return children;
}

// The picker sits outside Protected: it is the one page reachable before a
// client has been chosen, which is the state Protected sends people here from.
function AccountantOnly({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <Splash />;
  if (!user) return <Navigate to="/login" replace />;
  // Anyone who acts for a client can be here, including account holders who
  // keep their own books as well.
  if (!user.isAccountant && user.role !== 'accountant') return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/landing" element={<Landing />} />
      <Route path="/login" element={<PublicOnly><Login /></PublicOnly>} />
      <Route path="/register" element={<PublicOnly><Register /></PublicOnly>} />
      <Route path="/terms" element={<Terms />} />
      <Route path="/privacy" element={<Privacy />} />
      <Route path="/forgot-password" element={<PublicOnly><ForgotPassword /></PublicOnly>} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/activate" element={<Activate />} />
      <Route path="/accept-invite" element={<AcceptInvite />} />
      <Route path="/confirm-email" element={<ConfirmEmail />} />
      <Route path="/clients" element={<AccountantOnly><ClientPicker /></AccountantOnly>} />
      <Route path="/" element={<Protected><Dashboard /></Protected>} />
      <Route path="/expenses" element={<Protected><Expenses /></Protected>} />
      <Route path="/add" element={<Protected><AddExpense /></Protected>} />
      <Route path="/categories" element={<Protected><Categories /></Protected>} />
      <Route path="/books" element={<Protected><Books /></Protected>} />
      <Route path="/reports" element={<Protected><Reports /></Protected>} />
      <Route path="/deductions" element={<Protected><Deductions /></Protected>} />
      <Route path="/account" element={<Protected><Account /></Protected>} />

      {/* Support is reachable signed in or not. Somebody who cannot get into
          their account is exactly who most needs it, so it sits outside
          Protected and decides for itself what to show. */}
      <Route path="/support" element={<SupportShell><Support /></SupportShell>} />
      <Route
        path="/support/ticket/:token"
        element={
          <SupportShell>
            <SupportTicketByToken />
          </SupportShell>
        }
      />
      <Route path="/support/:id" element={<Protected><SupportTicket /></Protected>} />
      <Route path="/admin" element={<Protected adminOnly><Admin /></Protected>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
