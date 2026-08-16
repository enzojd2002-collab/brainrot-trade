import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import multer from 'multer';
import Database from 'better-sqlite3';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = http.createServer(app);
const io = new Server(server);
const db = new Database(process.env.DB_FILE || path.join(__dirname,'brainrot.db'));
const ADMIN_CODE = process.env.ADMIN_CODE || '007890';
const PORT = process.env.PORT || 3000;

db.exec(`CREATE TABLE IF NOT EXISTS ads(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,description TEXT,looking TEXT,owner TEXT NOT NULL,photo TEXT,certified INTEGER DEFAULT 0,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS chats(id INTEGER PRIMARY KEY AUTOINCREMENT,ad_id INTEGER NOT NULL,visitor TEXT NOT NULL,owner TEXT NOT NULL,closed INTEGER DEFAULT 0,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY AUTOINCREMENT,chat_id INTEGER NOT NULL,sender TEXT NOT NULL,text TEXT NOT NULL,fortnite TEXT,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS ratings(id INTEGER PRIMARY KEY AUTOINCREMENT,chat_id INTEGER UNIQUE NOT NULL,rater TEXT NOT NULL,stars INTEGER NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS reports(id INTEGER PRIMARY KEY AUTOINCREMENT,ad_id INTEGER NOT NULL,reporter TEXT NOT NULL,reason TEXT NOT NULL,created_at TEXT NOT NULL);`);

const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:5*1024*1024}});
app.use(express.json({limit:'1mb'}));
app.use(express.static(path.join(__dirname,'public')));
function now(){return new Date().toISOString()}
function token(){return crypto.randomBytes(24).toString('hex')}
const adminSessions=new Set();

app.get('/api/ads',(req,res)=>{
 const ads=db.prepare('SELECT * FROM ads ORDER BY id DESC').all();
 for(const a of ads){a.certified=!!a.certified;a.rating=db.prepare('SELECT ROUND(AVG(stars),1) avg, COUNT(*) count FROM ratings r JOIN chats c ON c.id=r.chat_id WHERE c.owner=?').get(a.owner)}
 res.json(ads);
});
app.post('/api/ads',upload.single('photo'),(req,res)=>{
 const {name,description='',looking='À discuter',owner='Joueur'}=req.body;
 if(!name?.trim()) return res.status(400).json({error:'Nom requis'});
 const photo=req.file ? `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}` : '';
 const info=db.prepare('INSERT INTO ads(name,description,looking,owner,photo,created_at) VALUES(?,?,?,?,?,?)').run(name.trim(),description.trim(),looking.trim(),owner.trim().slice(0,30),photo,now());
 const ad=db.prepare('SELECT * FROM ads WHERE id=?').get(info.lastInsertRowid); io.emit('ads:update'); res.json(ad);
});
app.post('/api/admin/login',(req,res)=>{if(req.body?.code!==ADMIN_CODE)return res.status(401).json({error:'Code incorrect'});const t=token();adminSessions.add(t);res.json({token:t})});
function admin(req,res,next){if(!adminSessions.has(req.headers.authorization?.replace('Bearer ','')||''))return res.status(401).json({error:'Admin requis'});next()}
app.get('/api/admin/reports',admin,(req,res)=>res.json(db.prepare('SELECT reports.*,ads.name FROM reports JOIN ads ON ads.id=reports.ad_id ORDER BY reports.id DESC').all()));
app.delete('/api/admin/ads/:id',admin,(req,res)=>{db.prepare('DELETE FROM ads WHERE id=?').run(req.params.id);io.emit('ads:update');res.json({ok:true})});
app.post('/api/admin/ads/:id/certify',admin,(req,res)=>{db.prepare('UPDATE ads SET certified=? WHERE id=?').run(req.body.certified?1:0,req.params.id);io.emit('ads:update');res.json({ok:true})});
app.post('/api/admin/reports',admin,(req,res)=>res.json({ok:true}));

app.post('/api/reports',(req,res)=>{const {adId,reporter='Joueur',reason}=req.body;if(!reason)return res.status(400).json({error:'Motif requis'});db.prepare('INSERT INTO reports(ad_id,reporter,reason,created_at) VALUES(?,?,?,?)').run(adId,reporter,reason,now());res.json({ok:true})});
app.post('/api/chats', (req,res)=>{const {adId,visitor='Joueur'}=req.body;const ad=db.prepare('SELECT * FROM ads WHERE id=?').get(adId);if(!ad)return res.status(404).json({error:'Annonce introuvable'});let c=db.prepare('SELECT * FROM chats WHERE ad_id=? AND visitor=? AND closed=0').get(adId,visitor);if(!c){const x=db.prepare('INSERT INTO chats(ad_id,visitor,owner,created_at) VALUES(?,?,?,?)').run(adId,visitor,ad.owner,now());c=db.prepare('SELECT * FROM chats WHERE id=?').get(x.lastInsertRowid)}res.json(c)});
app.get('/api/chats/:id',(req,res)=>{const c=db.prepare('SELECT * FROM chats WHERE id=?').get(req.params.id);if(!c)return res.status(404).json({error:'Chat introuvable'});const messages=db.prepare('SELECT * FROM messages WHERE chat_id=? ORDER BY id ASC').all(req.params.id);const rating=db.prepare('SELECT * FROM ratings WHERE chat_id=?').get(req.params.id);res.json({chat:c,messages,rating})});
app.post('/api/chats/:id/close',(req,res)=>{const c=db.prepare('SELECT * FROM chats WHERE id=?').get(req.params.id);if(!c)return res.status(404).json({error:'Chat introuvable'});db.prepare('UPDATE chats SET closed=1 WHERE id=?').run(req.params.id);io.to('chat:'+req.params.id).emit('chat:closed');res.json({ok:true})});
app.post('/api/chats/:id/rate',(req,res)=>{const stars=Number(req.body.stars);if(stars<1||stars>5)return res.status(400).json({error:'Note invalide'});try{db.prepare('INSERT INTO ratings(chat_id,rater,stars,created_at) VALUES(?,?,?,?)').run(req.params.id,req.body.rater||'Joueur',stars,now());res.json({ok:true})}catch{res.status(409).json({error:'Déjà noté'})}});

io.on('connection',socket=>{socket.on('chat:join',id=>socket.join('chat:'+id));socket.on('chat:send',({chatId,sender,text,fortnite})=>{const c=db.prepare('SELECT * FROM chats WHERE id=?').get(chatId);if(!c||c.closed||!text?.trim())return;const x=db.prepare('INSERT INTO messages(chat_id,sender,text,fortnite,created_at) VALUES(?,?,?,?,?)').run(chatId,sender||'Joueur',text.trim(),(fortnite||'').trim(),now());const m=db.prepare('SELECT * FROM messages WHERE id=?').get(x.lastInsertRowid);io.to('chat:'+chatId).emit('chat:message',m)})});
server.listen(PORT,()=>console.log(`Brainrot Trade running on port ${PORT}`));
