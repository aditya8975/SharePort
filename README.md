# SharePort

Send files between any two devices with a 6-digit code or QR scan.

## Run
    npm install
    npm start
Open http://localhost:3000. To use it between phones/laptops, deploy to any Node host
(Render, Railway, Fly.io, a VPS) so both devices can reach it.

## How it works
- Sender uploads files (max 500 MB total) and gets a 6-digit code + QR.
- Receiver types the code (or scans the QR) and downloads.
- Files auto-delete after 10 minutes. Change MAX_BYTES / TTL_MS in server.js.
