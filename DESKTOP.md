# Stratum Desktop

Stratum is packaged as an Electron desktop application.

## Development

```bash
npm install
npm run electron:dev
```

The desktop wrapper starts the existing Express/Vite server locally on port 3000 and opens a native Electron window.

## Gemini API configuration

Set `GEMINI_API_KEY` before launching when AI features are required:

```bash
GEMINI_API_KEY="your_key" npm run electron:dev
```

On Windows PowerShell:

```powershell
$env:GEMINI_API_KEY="your_key"
npm run electron:dev
```

## Build installers

```bash
npm run electron:build:win
npm run electron:build:mac
npm run electron:build:linux
```

Cross-platform installers are written to `release/`.
