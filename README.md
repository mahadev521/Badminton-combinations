# Badminton Rotation Web App

This is a static web app version of the badminton rotation generator.

## Files

- `index.html` - UI
- `style.css` - styling
- `app.js` - scheduling logic

## Run locally

From this folder:

```bash
python3 -m http.server 8000
```

Open:

- http://localhost:8000

## Deploy on GitHub Pages

1. Push this folder to your GitHub repository.
2. In GitHub, open the repository settings.
3. Go to **Pages**.
4. Under **Build and deployment**:
   - Source: `Deploy from a branch`
   - Branch: `main`
   - Folder: `/ (root)`
5. Save.
6. Wait for deployment, then open the URL shown on the Pages settings page.

## How to use

1. Enter player names, one per line.
2. Click **Start**.
3. The app generates matches until partnership repetition would begin.
