import { createContext, useContext, useEffect, useState } from 'react';
import { Link, NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { api, getToken, setToken } from './api.js';
import Events, { EventDetail } from './pages/Events.jsx';
import Auth from './pages/Auth.jsx';
import Tickets from './pages/Tickets.jsx';
import Organize, { Manage } from './pages/Organize.jsx';
import Verify from './pages/Verify.jsx';

const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(!getToken());
  useEffect(() => {
    if (!getToken()) return;
    api('/auth/me').then((d) => setUser(d.user)).catch(() => setToken(null)).finally(() => setReady(true));
  }, []);
  const login = ({ token, user }) => { setToken(token); setUser(user); };
  const logout = () => { setToken(null); setUser(null); };
  return <AuthCtx.Provider value={{ user, ready, login, logout }}>{children}</AuthCtx.Provider>;
}

function Guard({ role, children }) {
  const { user, ready } = useAuth();
  if (!ready) return null;
  if (!user) return <Navigate to="/login" replace />;
  if (role && user.role !== role) return <Navigate to="/" replace />;
  return children;
}

function Bar() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  return (
    <header className="bar">
      <div className="wrap">
        <Link to="/" className="brand">Pass<span>line</span></Link>
        <nav>
          <NavLink className="nav" to="/" end>Events</NavLink>
          {user?.role === 'student' && <NavLink className="nav" to="/tickets">My tickets</NavLink>}
          {user?.role === 'organizer' && <NavLink className="nav" to="/organize">Organize</NavLink>}
          {user ? (
            <button className="ghost" onClick={() => { logout(); nav('/'); }}>Sign out ({user.name.split(' ')[0]})</button>
          ) : (
            <NavLink className="nav" to="/login">Sign in</NavLink>
          )}
        </nav>
      </div>
    </header>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Bar />
      <main className="wrap">
        <Routes>
          <Route path="/" element={<Events />} />
          <Route path="/events/:id" element={<EventDetail />} />
          <Route path="/login" element={<Auth />} />
          <Route path="/tickets" element={<Guard role="student"><Tickets /></Guard>} />
          <Route path="/organize" element={<Guard role="organizer"><Organize /></Guard>} />
          <Route path="/organize/:id" element={<Guard role="organizer"><Manage /></Guard>} />
          <Route path="/verify/:id" element={<Verify />} />
          <Route path="*" element={<p>That page does not exist. <Link to="/">See upcoming events</Link>.</p>} />
        </Routes>
      </main>
    </AuthProvider>
  );
}
