import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, downloadFile, fmtDate, fmtTime } from '../api.js';

export default function Tickets() {
  const [tickets, setTickets] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api('/me/tickets').then(setTickets).catch((e) => setError(e.message)); }, []);

  return (
    <>
      <h1 style={{ marginTop: 40 }}>My tickets</h1>
      {error && <p className="err">{error}</p>}
      {tickets?.length === 0 && <p className="muted">No tickets yet. <Link to="/">Browse events</Link> and register.</p>}
      {tickets?.map((t) => (
        <article className="ticket" key={t.event_id}>
          <div className="info">
            <h3>{t.title}</h3>
            <span className="muted">{t.venue} | {fmtDate(t.starts_at)}</span>
            {t.checked_in_at
              ? <span className="chip go">Checked in at {fmtTime(t.checked_in_at)}</span>
              : <span className="chip">Not checked in</span>}
            {t.checked_in_at && (
              <div style={{ marginTop: 10 }}>
                <button className="primary" onClick={() => downloadFile(`/events/${t.event_id}/certificate`, 'certificate.pdf').catch((e) => setError(e.message))}>
                  Download certificate
                </button>
              </div>
            )}
          </div>
          <div className="stub">
            <img src={t.qr} alt={`QR code for ${t.title}`} />
            <span className="muted">Show this at the door</span>
          </div>
        </article>
      ))}
    </>
  );
}
