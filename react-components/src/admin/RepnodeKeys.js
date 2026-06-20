import React, { useState, useEffect } from 'react';
import axios from 'axios';

export default function RepnodeKeys({ allowAddKey = true }) {
  const [keys, setKeys] = useState([]);
  const [nodeId, setNodeId] = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const defaultApiBase = `${window.location.protocol}//${window.location.hostname}:8000/server.php`;
  const apiBase = process.env.REACT_APP_API_BASE || defaultApiBase;

  const fetchKeys = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${apiBase}?action=repnode-keys`);
      setKeys(res.data);
    } catch (err) {
      setMessage('Failed to fetch keys');
    }
    setLoading(false);
  };

  useEffect(() => { fetchKeys(); }, []);

  const handleAddKey = async (e) => {
    e.preventDefault();
    setMessage('');
    try {
      await axios.post(`${apiBase}?action=addRepNodeKey`, { node_id: nodeId, private_key: privateKey });
      setMessage('Key added successfully');
      setNodeId('');
      setPrivateKey('');
      fetchKeys();
    } catch (err) {
      setMessage('Failed to add key');
    }
  };

  return (
    <div className="admin-card">
      <h2 className="admin-title">Repnode Keys</h2>
      {allowAddKey && (
        <form onSubmit={handleAddKey} className="admin-form">
          <div style={{ flex: 1, minWidth: 120 }}>
            <label className="admin-label">Node ID:</label>
            <input value={nodeId} onChange={e => setNodeId(e.target.value)} required className="admin-input" />
          </div>
          <div style={{ flex: 2, minWidth: 220 }}>
            <label className="admin-label">Private Key:</label>
            <input value={privateKey} onChange={e => setPrivateKey(e.target.value)} required className="admin-input" />
          </div>
          <button type="submit" className="admin-btn">Add Key</button>
        </form>
      )}
      {message && <div className="admin-message" style={{ color: message.includes('success') ? '#2f855a' : '#c53030' }}>{message}</div>}
      <h3 className="admin-title">All Repnode Keys</h3>
      {loading ? <div>Loading...</div> : (
        <table className="admin-table">
          <thead>
            <tr>
              <th>Node ID</th>
              <th>Encrypted Key</th>
            </tr>
          </thead>
          <tbody>
            {keys.map(k => (
              <tr key={k.node_id}>
                <td style={{ fontWeight: 600 }}>{k.node_id}</td>
                <td style={{ fontFamily: 'monospace', fontSize: 13 }}>{k.encrypted_private_key.slice(0, 32)}...</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
