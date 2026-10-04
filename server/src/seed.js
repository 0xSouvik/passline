import bcrypt from 'bcryptjs';
import db from './db.js';

const hash = bcrypt.hashSync('password123', 10);
const addUser = db.prepare('INSERT OR IGNORE INTO users (name, email, password_hash, role) VALUES (?,?,?,?)');
addUser.run('Demo Organizer', 'organizer@demo.com', hash, 'organizer');
addUser.run('Asha Student', 'asha@demo.com', hash, 'student');
addUser.run('Rohan Student', 'rohan@demo.com', hash, 'student');

const org = db.prepare("SELECT id FROM users WHERE email = 'organizer@demo.com'").get().id;
const day = 86400000;
const add = db.prepare('INSERT INTO events (organizer_id, title, description, venue, starts_at, capacity) VALUES (?,?,?,?,?,?)');
if (!db.prepare('SELECT 1 FROM events').get()) {
  add.run(org, 'Tech Fest Keynote', 'Opening keynote of the annual tech fest.', 'Main Auditorium', new Date(Date.now() + 7 * day).toISOString(), 300);
  add.run(org, 'Intro to Cloud Workshop', 'Hands-on session. Bring your laptop.', 'Lab 3, ECE Block', new Date(Date.now() + 10 * day).toISOString(), 60);
  add.run(org, 'Hackathon Info Session', 'Everything about the upcoming hackathon.', 'Seminar Hall', new Date(Date.now() + 14 * day).toISOString(), 120);
}
console.log('Seeded. Organizer: organizer@demo.com / password123 | Students: asha@demo.com, rohan@demo.com (same password)');
