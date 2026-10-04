import { useEffect, useRef, useState, useCallback } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, fmtDate, fmtTime, getToken, toLocalInput } from '../api.js';
import TaskBoard from '../components/TaskBoard.jsx';

function EventForm({ initial, submitLabel, onSubmit }) {
  const [f, setF] = useState(initial || { title: '', description: '', venue: '', starts_at: '', capacity: 100 });
  const [error, setError] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  async function submit(e) {
    e.preventDefault(); setError('');
    try {
      await onSubmit({ ...f, capacity: Number(f.capacity), starts_at: new Date(f.starts_at).toISOString() });
      if (!initial) setF({ title: '', description: '', venue: '', starts_at: '', capacity: 100 });
    } catch (err) { setError(err.message); }
  }
  return (
    <form className="stack" onSubmit={submit}>
      <label>Event name<input value={f.title} onChange={set('title')} required minLength={3} /></label>
      <label>Description<textarea rows={3} value={f.description} onChange={set('description')} /></label>
      <label>Venue<input value={f.venue} onChange={set('venue')} required /></label>
      <label>Starts<input type="datetime-local" value={f.starts_at} onChange={set('starts_at')} required /></label>
      <label>Capacity<input type="number" min={1} value={f.capacity} onChange={set('capacity')} required /></label>
      {error && <div className="err" role="alert">{error}</div>}
      <div><button className="primary">{submitLabel}</button></div>
    </form>
  );
}

export default function Organize() {
  const [events, setEvents] = useState([]);
  const load = useCallback(() => api('/organizer/events').then(setEvents), []);
  useEffect(() => { load(); }, [load]);
  return (
    <>
      <h1 style={{ marginTop: 40 }}>Your events</h1>
      {events.length === 0 && <p className="muted">Nothing yet. Create your first event below.</p>}
      {events.map((e) => (
        <Link className="event" key={e.id} to={`/organize/${e.id}`}>
          <div className="date">{new Date(e.starts_at).getDate()}<small>{new Date(e.starts_at).toLocaleString('en-IN', { month: 'short' })}</small></div>
          <div><h3>{e.title}</h3><span className="muted">{e.venue} | {fmtDate(e.starts_at)}</span></div>
          <div className="seats">{e.registered} / {e.capacity} registered</div>
        </Link>
      ))}
      <h2 style={{ marginTop: 48 }}>Create an event</h2>
      <EventForm submitLabel="Publish event" onSubmit={async (body) => { await api('/events', { method: 'POST', body }); await load(); }} />
    </>
  );
}

const TABS = [['checkin', 'Check-in'], ['live', 'Live stats'], ['attendees', 'Attendees'], ['tasks', 'Volunteer tasks'], ['details', 'Details']];

export function Manage() {
  const { id } = useParams();
  const [ev, setEv] = useState(null);
  const [tab, setTab] = useState('checkin');
  const load = useCallback(() => api(`/events/${id}`).then(setEv), [id]);
  useEffect(() => { load(); }, [load]);
  if (!ev) return <p>Loading...</p>;
  return (
    <>
      <p style={{ marginTop: 32 }}><Link to="/organize">All events</Link></p>
      <h1>{ev.title}</h1>
      <p className="muted">{ev.venue} | {fmtDate(ev.starts_at)}</p>
      <div className="tabs" role="tablist">
        {TABS.map(([k, label]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{label}</button>)}
      </div>
      {tab === 'checkin' && <CheckIn eventId={id} />}
      {tab === 'live' && <Live eventId={id} />}
      {tab === 'attendees' && <Attendees eventId={id} />}
      {tab === 'tasks' && <TaskBoard eventId={id} canManage />}
      {tab === 'details' && <Details ev={ev} reload={load} />}
    </>
  );
}

function CheckIn({ eventId }) {
  const [code, setCode] = useState('');
  const [result, setResult] = useState(null);
  const [recent, setRecent] = useState([]);
  const [scanning, setScanning] = useState(false);
  const last = useRef({ code: '', at: 0 });

  const submit = useCallback(async (raw) => {
    const value = raw.trim();
    // Camera scanners fire many times per second; ignore repeats of the same code within 3s.
    if (!value || (last.current.code === value && Date.now() - last.current.at < 3000)) return;
    last.current = { code: value, at: Date.now() };
    try {
      const r = await api(`/events/${eventId}/checkin`, { method: 'POST', body: { code: value } });
      setResult({ kind: 'ok', text: `${r.name} is checked in.` });
      setRecent((x) => [{ name: r.name, at: new Date().toISOString() }, ...x].slice(0, 6));
    } catch (e) {
      if (e.data?.result === 'already') setResult({ kind: 'already', text: `${e.data.name} already checked in at ${fmtTime(e.data.checked_in_at)}.` });
      else setResult({ kind: 'invalid', text: e.message });
    }
    setCode('');
  }, [eventId]);

  useEffect(() => {
    if (!scanning) return;
    let scanner;
    (async () => {
      const { Html5Qrcode } = await import('html5-qrcode'); // loaded only when the camera is used
      scanner = new Html5Qrcode('reader');
      try { await scanner.start({ facingMode: 'environment' }, { fps: 10, qrbox: 240 }, (text) => submit(text)); }
      catch { setResult({ kind: 'invalid', text: 'Camera unavailable. Allow camera access or type the code instead.' }); setScanning(false); }
    })();
    return () => { scanner?.stop().then(() => scanner.clear()).catch(() => {}); };
  }, [scanning, submit]);

  return (
    <>
      <form className="row" onSubmit={(e) => { e.preventDefault(); submit(code); }}>
        <input style={{ flex: '1 1 260px', width: 'auto' }} value={code} onChange={(e) => setCode(e.target.value)} placeholder="Scan with a USB scanner or paste the ticket code" autoFocus aria-label="Ticket code" />
        <button className="primary">Check in</button>
        <button type="button" onClick={() => setScanning(!scanning)}>{scanning ? 'Stop camera' : 'Scan with camera'}</button>
      </form>
      {scanning && <div id="reader" />}
      {result && <div className={`scan ${result.kind}`} role="status">{result.text}</div>}
      {recent.length > 0 && (
        <>
          <h3 style={{ marginTop: 28 }}>Checked in this session</h3>
          {recent.map((r, i) => <div key={i}>{r.name} <span className="muted">at {fmtTime(r.at)}</span></div>)}
        </>
      )}
    </>
  );
}

function Live({ eventId }) {
  const [s, setS] = useState(null);
  const load = useCallback(() => api(`/events/${eventId}/analytics`).then(setS), [eventId]);
  useEffect(() => {
    load();
    // Server-Sent Events: the server pushes a message on every check-in, we refetch.
    const es = new EventSource(`/api/events/${eventId}/stream?token=${getToken()}`);
    es.onmessage = () => load();
    return () => es.close();
  }, [eventId, load]);
  if (!s) return <p>Loading...</p>;
  const max = Math.max(1, ...s.checkinsBySlot.map((b) => b.count));
  const bw = 600 / Math.max(s.checkinsBySlot.length, 1);
  return (
    <>
      <div className="stats">
        <div className="stat"><b>{s.registered}</b>registered of {s.capacity}</div>
        <div className="stat"><b>{s.checked_in}</b>checked in</div>
        <div className="stat"><b>{s.not_checked_in}</b>yet to arrive</div>
      </div>
      <div>Check-in rate: {Math.round(s.checkin_rate * 100)}%</div>
      <div className="meter" aria-hidden="true"><i style={{ width: `${s.checkin_rate * 100}%` }} /></div>
      <h3>Arrivals every 15 minutes</h3>
      {s.checkinsBySlot.length === 0 ? <p className="muted">No check-ins yet. Bars appear as people arrive.</p> : (
        <svg viewBox="0 0 600 190" role="img" aria-label="Check-ins per 15 minutes" style={{ width: '100%', maxWidth: 640 }}>
          {s.checkinsBySlot.map((b, i) => {
            const h = (b.count / max) * 130;
            return (
              <g key={b.slot}>
                <rect x={i * bw + 6} y={150 - h} width={Math.max(bw - 12, 4)} height={h} fill="#f5b301" />
                <text x={i * bw + bw / 2} y={144 - h} textAnchor="middle" fontSize="12" fill="#1e1b4b">{b.count}</text>
                <text x={i * bw + bw / 2} y={172} textAnchor="middle" fontSize="11" fill="#5b5f7a">{fmtTime(b.slot + ':00Z')}</text>
              </g>
            );
          })}
          <line x1="0" x2="600" y1="150" y2="150" stroke="#1e1b4b" strokeWidth="2" />
        </svg>
      )}
      {s.recent.length > 0 && (
        <>
          <h3 style={{ marginTop: 24 }}>Latest arrivals</h3>
          {s.recent.map((r, i) => <div key={i}>{r.name} <span className="muted">at {fmtTime(r.checked_in_at)}</span></div>)}
        </>
      )}
    </>
  );
}

function Attendees({ eventId }) {
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState('');
  useEffect(() => { api(`/events/${eventId}/attendees`).then(setRows); }, [eventId]);
  if (!rows) return <p>Loading...</p>;
  const shown = rows.filter((r) => (r.name + r.email).toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <div className="row" style={{ marginBottom: 14 }}>
        <input style={{ maxWidth: 320 }} placeholder="Search by name or email" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search attendees" />
        <span className="muted">{shown.length} of {rows.length}</span>
      </div>
      {rows.length === 0 ? <p className="muted">No registrations yet.</p> : (
        <div className="scroll">
          <table>
            <thead><tr><th>Name</th><th>Email</th><th>Registered</th><th>Status</th></tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id}>
                  <td>{r.name}</td><td>{r.email}</td><td>{fmtDate(r.registered_at)}</td>
                  <td>{r.checked_in_at ? <span className="chip go">Checked in</span> : <span className="chip">Registered</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function Details({ ev, reload }) {
  const nav = useNavigate();
  const [error, setError] = useState('');
  return (
    <>
      <EventForm
        initial={{ title: ev.title, description: ev.description, venue: ev.venue, starts_at: toLocalInput(ev.starts_at), capacity: ev.capacity }}
        submitLabel="Save changes"
        onSubmit={async (body) => { await api(`/events/${ev.id}`, { method: 'PUT', body }); await reload(); }}
      />
      <h3 style={{ marginTop: 40 }}>Delete this event</h3>
      <p className="muted">This removes the event, all registrations and tasks.</p>
      {error && <p className="err">{error}</p>}
      <button className="danger" onClick={async () => {
        if (!confirm('Delete this event for good?')) return;
        try { await api(`/events/${ev.id}`, { method: 'DELETE' }); nav('/organize'); } catch (e) { setError(e.message); }
      }}>Delete event</button>
    </>
  );
}
