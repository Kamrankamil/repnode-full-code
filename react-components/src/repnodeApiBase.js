const LOCAL_REPNODE_PORT = '3001';

function resolveRepnodeApiBase() {
  if (process.env.REACT_APP_REPNODE_API_BASE_URL) {
    return process.env.REACT_APP_REPNODE_API_BASE_URL;
  }

  if (typeof window === 'undefined') {
    return `http://localhost:${LOCAL_REPNODE_PORT}`;
  }

  const { hostname, protocol } = window.location;

  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return `${protocol}//${hostname}:${LOCAL_REPNODE_PORT}`;
  }

  return `${protocol}//${hostname}:${LOCAL_REPNODE_PORT}`;
}

export const REPNODE_API_BASE = resolveRepnodeApiBase();
export const repnodeUrl = (path) => `${REPNODE_API_BASE}${path}`;