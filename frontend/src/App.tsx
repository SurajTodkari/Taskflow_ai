import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './lib/auth';
import Layout from './components/Layout';
import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';
import Today from './pages/Today';
import Tomorrow from './pages/Tomorrow';
import Tasks from './pages/Tasks';
import Calendar from './pages/Calendar';
import Projects from './pages/Projects';
import ProjectDetail from './pages/ProjectDetail';
import Kanban from './pages/Kanban';
import Notifications from './pages/Notifications';
import Reports from './pages/Reports';
import Analytics from './pages/Analytics';
import AI from './pages/AI';
import Settings from './pages/Settings';
import Inbox from './pages/Inbox';
import Landing from './pages/Landing';

function Protected() {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <div className="flex min-h-screen items-center justify-center text-sm text-fg-muted" role="status">Loading...</div>;
  if (!user && loc.pathname === '/') return <Landing />;
  if (!user) return <Navigate to="/login" state={{ from: loc.pathname }} replace />;
  return <Layout />;
}

export default function App() {
  const { user, loading } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={!loading && user ? <Navigate to="/" replace /> : <Login />} />
      <Route path="/register" element={!loading && user ? <Navigate to="/" replace /> : <Register />} />
      <Route element={<Protected />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/today" element={<Today />} />
        <Route path="/tomorrow" element={<Tomorrow />} />
        <Route path="/inbox" element={<Inbox />} />
        <Route path="/tasks" element={<Tasks />} />
        <Route path="/calendar" element={<Calendar />} />
        <Route path="/projects" element={<Projects />} />
        <Route path="/projects/:id" element={<ProjectDetail />} />
        <Route path="/kanban" element={<Kanban />} />
        <Route path="/notifications" element={<Notifications />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/analytics" element={<Analytics />} />
        <Route path="/ai" element={<AI />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
