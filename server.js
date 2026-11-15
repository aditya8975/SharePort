const express = require('express');
const multer = require('multer');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const MAX_BYTES = 500 * 1024 * 1024;      // 500 MB total per transfer
const TTL_MS = 10 * 60 * 1000;            // files live for 10 minutes
const UPLOAD_DIR = path.join(__dirname, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const transfers = new Map(); // code -> { files, expires }

const newCode = () => {
  let c;
  do { c = String(crypto.randomInt(0, 1000000)).padStart(6, '0'); } while (transfers.has(c));
  return c;
};

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, _file, cb) => cb(null, crypto.randomUUID()),
  }),
  limits: { fileSize: MAX_BYTES, files: 20 },
});

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

// Find index.html in public/ or next to server.js
const INDEX = [path.join(__dirname, 'public', 'index.html'), path.join(__dirname, 'index.html')].find(fs.existsSync);
console.log(INDEX ? 'Serving page from: ' + INDEX : 'WARNING: index.html not found next to server.js or in a public/ folder');
app.get('/', (_req, res) => INDEX ? res.sendFile(INDEX) : res.status(500).send('index.html not found. Put it in a folder named "public" next to server.js.'));

// Chrome DevTools probes this URL when open; answer quietly instead of a 404
app.get('/.well-known/*', (_req, res) => res.sendStatus(204));

app.post('/api/upload', (req, res) => {
  const declared = Number(req.headers['content-length'] || 0);
  if (declared > MAX_BYTES + 1024 * 1024) {
    return res.status(413).json({ error: 'Total size is over 500 MB.' });
  }
  upload.array('files')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'File is over 500 MB.' : err.message });
    const files = req.files || [];
    const total = files.reduce((s, f) => s + f.size, 0);
    if (!files.length || total > MAX_BYTES) {
      files.forEach((f) => fs.unlink(f.path, () => {}));
      return res.status(400).json({ error: files.length ? 'Total size is over 500 MB.' : 'No files received.' });
    }
    const code = newCode();
    transfers.set(code, {
      expires: Date.now() + TTL_MS,
      files: files.map((f, i) => ({
        id: i,
        name: Buffer.from(f.originalname, 'latin1').toString('utf8'),
        size: f.size,
        path: f.path,
      })),
    });
    res.json({ code, expiresInSeconds: TTL_MS / 1000 });
  });
});

const find = (code) => {
  const t = transfers.get(code);
  return t && t.expires > Date.now() ? t : null;
};

app.get('/api/transfer/:code', (req, res) => {
  const t = find(req.params.code);
  if (!t) return res.status(404).json({ error: 'Code not found or expired.' });
  res.json({
    expiresInSeconds: Math.round((t.expires - Date.now()) / 1000),
    files: t.files.map(({ id, name, size }) => ({ id, name, size })),
  });
});

app.get('/api/download/:code/:id', (req, res) => {
  const t = find(req.params.code);
  const f = t && t.files[Number(req.params.id)];
  if (!f) return res.status(404).send('Code not found or expired.');
  res.download(f.path, f.name);
});

app.get('/api/qr/:code', async (req, res) => {
  const url = `${req.protocol}://${req.get('host')}/?code=${encodeURIComponent(req.params.code)}`;
  res.type('svg').send(await QRCode.toString(url, { type: 'svg', margin: 1 }));
});

// delete expired transfers every 30 seconds
setInterval(() => {
  const now = Date.now();
  for (const [code, t] of transfers) {
    if (t.expires <= now) {
      t.files.forEach((f) => fs.unlink(f.path, () => {}));
      transfers.delete(code);
    }
  }
}, 30 * 1000);

// clear leftovers from a previous run
fs.readdirSync(UPLOAD_DIR).forEach((f) => fs.unlink(path.join(UPLOAD_DIR, f), () => {}));

app.listen(PORT, () => console.log(`Dropcode running at http://localhost:${PORT}`));