# Furigana Generator

## Run locally

- Open `index.html` with Live Server.

## Deploy to GitHub Pages

1. Push this `furigana-generator` repo to GitHub.
2. In repository settings, enable **Pages**.
3. Use branch `main` and folder `/ (root)`.
4. Your app URL will be:
   - `https://<username>.github.io/<repo>/index.html`

## Microsoft Teams upload

1. Deploy the app first (GitHub Pages or other HTTPS host).
2. Edit `teams-app/manifest.json` placeholders:
   - `YOUR_GITHUB_USERNAME`
   - `Your Company`
3. Zip only these files (at zip root):
   - `manifest.json`
   - `color.png`
   - `outline.png`
4. In Teams: **Apps -> Manage your apps -> Upload a custom app**.

## Notes

- Furigana level filter supports threshold behavior:
  - N4 = N4 through N1
  - N3 = N3 through N1
  - N2 = N2 through N1
  - N1 = N1 only
- Export supports DOCX, PDF, and PNG image.
