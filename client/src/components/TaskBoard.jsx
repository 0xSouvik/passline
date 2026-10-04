import { useEffect, useState, useCallback } from 'react';
import { api } from '../api.js';

const COLS = [['todo', 'To do'], ['doing', 'In progress'], ['done', 'Done']];

// canManage = organizer view (create, assign, delete). Volunteers can only move their own tasks.
export default function TaskBoard({ eventId, canManage }) {
  const [tasks, setTasks] = useState([]);
  const [volunteers, setVolunteers] = useState([]);
  const [title, setTitle] = useState('');
  const [assignee, setAssignee] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setTasks(await api(`/events/${eventId}/tasks`));
      if (canManage) setVolunteers(await api(`/events/${eventId}/volunteers`));
    } catch (e) { setError(e.message); }
  }, [eventId, canManage]);
  useEffect(() => { load(); }, [load]);

  const run = async (fn) => { try { setError(''); await fn(); await load(); } catch (e) { setError(e.message); } };
  const patch = (t, body) => run(() => api(`/tasks/${t.id}`, { method: 'PATCH', body }));

  const add = (e) => {
    e.preventDefault();
    run(async () => {
      await api(`/events/${eventId}/tasks`, { method: 'POST', body: { title, assignee_id: assignee ? Number(assignee) : null } });
      setTitle(''); setAssignee('');
    });
  };

  return (
    <>
      {error && <p className="err" role="alert">{error}</p>}
      {canManage && (
        <form className="row" onSubmit={add} style={{ marginBottom: 24 }}>
          <input style={{ flex: '2 1 220px', width: 'auto' }} placeholder="New task, e.g. Set up registration desk" value={title} onChange={(e) => setTitle(e.target.value)} required minLength={2} aria-label="Task title" />
          <select style={{ flex: '1 1 160px', width: 'auto' }} value={assignee} onChange={(e) => setAssignee(e.target.value)} aria-label="Assign to">
            <option value="">Unassigned</option>
            {volunteers.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
          <button className="primary">Add task</button>
        </form>
      )}
      {canManage && volunteers.length === 0 && <p className="note">No volunteers yet. Attendees can join the team from the event page.</p>}
      <div className="board">
        {COLS.map(([key, label]) => (
          <div className="col" key={key}>
            <h3>{label} ({tasks.filter((t) => t.status === key).length})</h3>
            {tasks.filter((t) => t.status === key).map((t) => (
              <div className="task" key={t.id}>
                <b>{t.title}</b>
                <span className="muted">{t.assignee_name ? `Assigned to ${t.assignee_name}` : 'Unassigned'}</span>
                <select value={t.status} onChange={(e) => patch(t, { status: e.target.value })} aria-label={`Status of ${t.title}`}>
                  {COLS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
                {canManage && (
                  <div className="row">
                    <select value={t.assignee_id ?? ''} onChange={(e) => patch(t, { assignee_id: e.target.value ? Number(e.target.value) : null })} aria-label={`Assignee of ${t.title}`}>
                      <option value="">Unassigned</option>
                      {volunteers.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                    </select>
                    <button className="ghost" onClick={() => run(() => api(`/tasks/${t.id}`, { method: 'DELETE' }))}>Delete</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}
