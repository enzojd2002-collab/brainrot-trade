const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_CODE = "007890";
const DATA_DIR = path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "db.json");

fs.mkdirSync(DATA_DIR, { recursive: true });

const emptyDB = {
  ads: [],
  chats: [],
  reports: [],
  nextAd: 1,
  nextChat: 1,
  nextReport: 1
};

function loadDB() {
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  } catch {
    fs.writeFileSync(DB_FILE, JSON.stringify(emptyDB, null, 2));
    return structuredClone(emptyDB);
  }
}
let db = loadDB();

function saveDB() {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

app.use(express.json({ limit: "12mb" }));
app.use(express.static(path.join(__dirname, "public")));

function cleanAd(a) {
  return {
    id:a.id, owner:a.owner, title:a.title, description:a.description,
    wanted:a.wanted, photo:a.photo || null, certified:!!a.certified
  };
}

app.get("/api/ads", (req,res) => {
  res.json(db.ads.filter(a => !a.deleted).map(cleanAd));
});

app.post("/api/ads", (req,res) => {
  const {owner,title,description,wanted,photo} = req.body || {};
  if (!owner || !title || !description || !wanted)
    return res.status(400).json({error:"Champs manquants"});
  const ad = {
    id:db.nextAd++, owner:String(owner), title:String(title),
    description:String(description), wanted:String(wanted),
    photo: photo || null, certified:false, deleted:false,
    createdAt:Date.now()
  };
  db.ads.unshift(ad);
  saveDB();
  res.status(201).json(cleanAd(ad));
});

app.post("/api/admin/login", (req,res) => {
  res.json({ok: req.body && req.body.code === ADMIN_CODE});
});

app.post("/api/admin/ads/:id/certify", (req,res) => {
  if (!req.body || req.body.code !== ADMIN_CODE) return res.status(403).json({error:"Admin"});
  const ad=db.ads.find(a=>a.id===Number(req.params.id));
  if(!ad) return res.status(404).json({error:"Annonce introuvable"});
  ad.certified=true; saveDB(); res.json(cleanAd(ad));
});

app.delete("/api/admin/ads/:id", (req,res) => {
  if (!req.body || req.body.code !== ADMIN_CODE) return res.status(403).json({error:"Admin"});
  const ad=db.ads.find(a=>a.id===Number(req.params.id));
  if(!ad) return res.status(404).json({error:"Annonce introuvable"});
  ad.deleted=true; saveDB(); res.json({ok:true});
});

app.get("/api/admin/reports", (req,res) => {
  if (req.query.code !== ADMIN_CODE) return res.status(403).json({error:"Admin"});
  res.json(db.reports);
});

app.post("/api/reports", (req,res) => {
  const {type,target,reporter,reason}=req.body||{};
  if(!reason || !reporter) return res.status(400).json({error:"Signalement incomplet"});
  const report={id:db.nextReport++,type:type||"Annonce",target,target,reporter,reason,time:Date.now()};
  db.reports.unshift(report); saveDB(); res.status(201).json(report);
});

app.get("/api/chats", (req,res) => {
  const user=String(req.query.user||"");
  if(!user) return res.status(400).json({error:"Utilisateur manquant"});
  res.json(db.chats.filter(c=>c.owner===user||c.buyer===user));
});

app.post("/api/chats", (req,res) => {
  const {adId,buyer}=req.body||{};
  const ad=db.ads.find(a=>a.id===Number(adId) && !a.deleted);
  if(!ad || !buyer) return res.status(400).json({error:"Données invalides"});
  let chat=db.chats.find(c=>c.adId===ad.id && c.buyer===String(buyer) && c.status==="open");
  if(!chat){
    chat={id:db.nextChat++,adId:ad.id,owner:ad.owner,buyer:String(buyer),
      status:"open",messages:[],rating:null,comment:"",updatedAt:Date.now()};
    db.chats.push(chat); saveDB();
  }
  res.json(chat);
});

app.get("/api/chats/:id", (req,res) => {
  const chat=db.chats.find(c=>c.id===Number(req.params.id));
  if(!chat) return res.status(404).json({error:"Conversation introuvable"});
  res.json(chat);
});

app.post("/api/chats/:id/messages", (req,res) => {
  const chat=db.chats.find(c=>c.id===Number(req.params.id));
  const {user,text}=req.body||{};
  if(!chat) return res.status(404).json({error:"Conversation introuvable"});
  if(chat.status!=="open") return res.status(409).json({error:"Conversation clôturée"});
  if(!user || !text) return res.status(400).json({error:"Message vide"});
  const message={user:String(user),text:String(text),time:Date.now()};
  chat.messages.push(message); chat.updatedAt=Date.now(); saveDB();
  res.status(201).json(message);
});

app.post("/api/chats/:id/close", (req,res) => {
  const chat=db.chats.find(c=>c.id===Number(req.params.id));
  if(!chat) return res.status(404).json({error:"Conversation introuvable"});
  chat.status="closed"; chat.updatedAt=Date.now(); saveDB(); res.json(chat);
});

app.post("/api/chats/:id/rating", (req,res) => {
  const chat=db.chats.find(c=>c.id===Number(req.params.id));
  const {rating,comment}=req.body||{};
  if(!chat) return res.status(404).json({error:"Conversation introuvable"});
  if(!Number.isInteger(rating)||rating<1||rating>5) return res.status(400).json({error:"Note invalide"});
  chat.rating=rating; chat.comment=String(comment||""); saveDB(); res.json(chat);
});

app.get("*", (req,res) => {
  res.sendFile(path.join(__dirname,"public","index.html"));
});

app.listen(PORT, () => console.log(`Brainrot Trade server listening on ${PORT}`));
