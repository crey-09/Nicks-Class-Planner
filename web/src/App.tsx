import { NavLink, Route, Routes } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import Todo from './pages/Todo';
import Calendar from './pages/Calendar';
import Planner from './pages/Planner';
import Courses from './pages/Courses';
import Sources from './pages/Sources';
import Settings from './pages/Settings';

const nav = [
  { to: '/', label: 'Today', icon: '☀️' },
  { to: '/todo', label: 'To-do', icon: '✅' },
  { to: '/calendar', label: 'Calendar', icon: '📅' },
  { to: '/planner', label: 'Planner', icon: '🗓️' },
  { to: '/courses', label: 'Courses', icon: '🎓' },
  { to: '/sources', label: 'Sources', icon: '🔗' },
  { to: '/settings', label: 'Settings', icon: '⚙️' },
];

export default function App() {
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">Nick Manager</div>
        <nav>
          {nav.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === '/'} className={({ isActive }) => (isActive ? 'active' : '')}>
              <span className="icon">{n.icon}</span>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">Runs locally. Nothing leaves this computer.</div>
      </aside>
      <main className="content">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/todo" element={<Todo />} />
          <Route path="/calendar" element={<Calendar />} />
          <Route path="/planner" element={<Planner />} />
          <Route path="/courses" element={<Courses />} />
          <Route path="/sources" element={<Sources />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
    </div>
  );
}
