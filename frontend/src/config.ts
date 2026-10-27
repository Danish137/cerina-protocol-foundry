const API_BASE_URL =
  import.meta.env.VITE_API_URL ||
  (import.meta.env.PROD
    ? 'https://cerina-protocol-foundry-production.up.railway.app'
    : 'http://localhost:8000')

export default API_BASE_URL
