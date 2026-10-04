import { useEffect, useState, useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, fmtDate } from '../api.js';
import { useAuth } from '../App.jsx';
import TaskBoard from '../components/TaskBoard.jsx';

export default function Events() {
  const [events, setEvents] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api('/events').then(setEvents).catch((e) => setError(e.message)); }, []);
  return (
    <>
      <section className="hero">
        <h1>Find the next thing worth showing up for.</h1>
        <p>Register in one tap, get a QR ticket, and collect a verifiable certificate after you check in.</p>
      </section>
      {error && <p className="err">{error}</p>}
      {events && events.length === 0 && <p className="muted">No events yet. Organizers can publish one from the Organize page.</p>}
      {events?.map((e) => {
        const d = new Date(e.starts_at);
        const left = e.capacity - e.registered;
        return (
          <Link className="event" key={e.id} to={`/events/${e.id}`}>
            <div className="date">{d.getDate()}<small>{d.toLocaleString('en-IN', { month: 'short' })}</small></div>
            <div><h3>{e.title}</h3><span className="muted">{e.venue} | {fmtDate(e.starts_at)}</span></div>
            <div className={`seats ${left <= 10 ? 'low' : ''}`}>{left > 0 ? `${left} seats left` : 'Full'}</div>
          </Link>
        );
      })}
    </>
  );
}

export function EventDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const [ev, setEv] = useState(null);
  const [mine, setMine] = useState({ registered: false, volunteer: false, checked_in: false });
  const [msg, setMsg] = useState({ text: '', bad: false });

  const load = useCallback(async () => {
    try {
      setEv(await api(`/events/${id}`));
      if (user) setMine(await api(`/events/${id}/mine`));
    } catch (e) { setMsg({ text: e.message, bad: true }); }
  }, [id, user]);
  useEffect(() => { load(); }, [load]);

  async function act(method, path, okText) {
    try { await api(path, { method }); setMsg({ text: okText, bad: false }); await load(); }
    catch (e) { setMsg({ text: e.message, bad: true }); }
  }

  if (!ev) return <p>{msg.text || 'Loading...'}</p>;
  const full = ev.registered >= ev.capacity;
  return (
    <>
      <h1 style={{ marginTop: 40 }}>{ev.title}</h1>
      <p className="muted">{ev.venue} | {fmtDate(ev.starts_at)} | by {ev.organizer_name}</p>
      <p style={{ maxWidth: 620 }}>{ev.description || 'No description yet.'}</p>
      <p><b>{ev.registered}</b> of {ev.capacity} seats taken</p>

      {!user && <p className="note">Sign in as an attendee to register. <Link to="/login">Sign in</Link></p>}
      {user?.role === 'organizer' && <Link className="btn" to="/organize">Go to organizer tools</Link>}
      {user?.role === 'student' && (
        <div className="row">
          {mine.registered ? (
            <>
              <Link className="btn primary" to="/tickets">View my ticket</Link>
              {!mine.checked_in && <button className="danger" onClick={() => act('DELETE', `/events/${id}/register`, 'Registration cancelled.')}>Cancel registration</button>}
            </>
          ) : (
            <button className="primary" disabled={full} onClick={() => act('POST', `/events/${id}/register`, 'You are in. Your ticket is ready.')}>
              {full ? 'Event is full' : 'Register'}
            </button>
          )}
          {mine.volunteer
            ? <button onClick={() => act('DELETE', `/events/${id}/volunteer`, 'You left the volunteer team.')}>Leave volunteer team</button>
            : <button onClick={() => act('POST', `/events/${id}/volunteer`, 'You joined the volunteer team.')}>Volunteer</button>}
        </div>
      )}
      {msg.text && <p className={msg.bad ? 'err' : ''} role="status">{msg.text}</p>}

      {mine.volunteer && (
        <section style={{ marginTop: 40 }}>
          <h2>Your volunteer tasks</h2>
          <TaskBoard eventId={ev.id} canManage={false} />
        </section>
      )}
    </>
  );
}
