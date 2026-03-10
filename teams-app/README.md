# Teams App Package

## 1) Update manifest placeholders

Edit `manifest.json` and replace:

- `YOUR_GITHUB_USERNAME`
- `Your Company`

If your GitHub Pages URL is different, update all URLs and `validDomains` accordingly.

## 2) Package files

Create a zip that contains these files at zip root:

- `manifest.json`
- `color.png`
- `outline.png`

You can also run:

`powershell -ExecutionPolicy Bypass -File ./create-package.ps1`

It creates `furigana-generator-teams.zip`.

The zip file can then be uploaded in Microsoft Teams:

- Apps -> Manage your apps -> Upload an app -> Upload a custom app

## 3) Notes

- Your hosted web app must be reachable over `https`.
- If Teams blocks the app, confirm that `validDomains` exactly matches your host domain.
