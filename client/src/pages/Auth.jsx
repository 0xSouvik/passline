import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../App.jsx';

export default function Auth() {
  const [mode, setMode] = useState('login');
  const [f, setF] = useState({ name: '', email: '', password: '', role: 'student' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const { login } = useAuth();
  const nav = useNavigate();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const body = mode === 'login' ? { email: f.email, password: f.password } : f;
      const data = await api(`/auth/${mode === 'login' ? 'login' : 'register'}`, { method: 'POST', body });
      login(data);
      nav(data.user.role === 'organizer' ? '/organize' : '/');
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  return (
    <>
      <h1 style={{ marginTop: 40 }}>{mode === 'login' ? 'Sign in' : 'Create your account'}</h1>
      <form className="stack" onSubmit={submit}>
        {mode === 'register' && <label>Full name<input value={f.name} onChange={set('name')} required minLength={2} /></label>}
        <label>Email<input type="email" value={f.email} onChange={set('email')} required /></label>
        <label>Password<input type="password" value={f.password} onChange={set('password')} required minLength={mode === 'register' ? 8 : 1} /></label>
        {mode === 'register' && (
          <label>I am joining as
            <select value={f.role} onChange={set('role')}>
              <option value="student">An attendee</option>
              <option value="organizer">An organizer</option>
            </select>
          </label>
        )}
        {error && <div className="err" role="alert">{error}</div>}
        <div className="row">
          <button className="primary" disabled={busy}>{mode === 'login' ? 'Sign in' : 'Create account'}</button>
          <button type="button" className="ghost" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}>
            {mode === 'login' ? 'Need an account? Sign up' : 'Have an account? Sign in'}
          </button>
        </div>
      </form>
    </>
  );
}
