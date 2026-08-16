// Configure the backend API URL here.
// Local development: keep as http://localhost:3000
// Production (e.g. after deploying the backend separately from GitHub Pages):
// replace with your deployed backend URL, e.g. https://your-backend.onrender.com
window.API_BASE_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? 'http://localhost:3000'
  : 'https://YOUR-DEPLOYED-BACKEND-URL';
