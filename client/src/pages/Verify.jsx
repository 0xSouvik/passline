import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, fmtDate } from '../api.js';

export default function Verify() {
  const { id } = useParams();
  const [res, setRes] = useState(null);
  useEffect(() => { api(`/verify/${id}`).then(setRes).catch(() => setRes({ valid: false })); }, [id]);
  if (!res) return <p>Checking...</p>;
  return (
    <div style={{ marginTop: 40 }}>
      <h1>{res.valid ? 'Certificate is valid' : 'Certificate not found'}</h1>
      {res.valid
        ? <p><b>{res.name}</b> attended <b>{res.title}</b> on {fmtDate(res.starts_at)}.</p>
        : <p className="muted">No certificate matches ID {id}. Check the ID and try again.</p>}
    </div>
  );
}
