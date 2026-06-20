const XAMPP_BACKEND_PATH = '/kamran/kamran/extention_backend';
const LOCAL_XAMPP_HTTP_PORT = '8080';

function resolveApiBase() {
  if (process.env.REACT_APP_API_BASE_URL) {
    return process.env.REACT_APP_API_BASE_URL;
  }

  if (typeof window === 'undefined') {
    return `http://localhost:${LOCAL_XAMPP_HTTP_PORT}${XAMPP_BACKEND_PATH}/server.php`;
  }

  const { origin, pathname, hostname, protocol } = window.location;
  const backendMatch = pathname.match(/^(.*?\/extention_backend)(?:\/|$)/);

  if (backendMatch) {
    return `${origin}${backendMatch[1]}/server.php`;
  }

  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return `${protocol}//${hostname}:${LOCAL_XAMPP_HTTP_PORT}${XAMPP_BACKEND_PATH}/server.php`;
  }

  return `${origin}${XAMPP_BACKEND_PATH}/server.php`;
}

export const API_BASE = resolveApiBase();
export const apiUrl = (action) => `${API_BASE}?action=${action}`;