import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';

// Set your real admin wallet address
const ADMIN_WALLET = '0x40F8E06967F99770B117Fe8a912Bfef1312A660b'.toLowerCase();

export default function RepnodeAdmin({ walletAddress }) {
  const [keys, setKeys] = useState([]);
  const [nodeId, setNodeId] = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const [repnodeWalletAddress, setRepnodeWalletAddress] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const defaultApiBase = `${window.location.protocol}//${window.location.hostname}:8000/server.php`;
  const apiBase = process.env.REACT_APP_API_BASE || defaultApiBase;

  // Only allow admin wallet to access keys
  const isAdmin = walletAddress && walletAddress.toLowerCase() === ADMIN_WALLET;

  // Fetch all repnode keys
  const fetchKeys = useCallback(async () => {
    setLoading(true);
    try {
      if (!isAdmin) throw new Error('Not authorized');
      const res = await axios.get(`${apiBase}?action=repnode-keys`);
      setKeys(res.data);
    } catch (err) {
      setMessage('Failed to fetch keys');
    }
    setLoading(false);
  }, [apiBase, isAdmin]);

  useEffect(() => {
    if (isAdmin) fetchKeys();
  }, [isAdmin, fetchKeys]);

  // Add new key
  const handleAddKey = async (e) => {
    e.preventDefault();
    setMessage('');
    try {
      if (!isAdmin) throw new Error('Not authorized');
      await axios.post(`${apiBase}?action=addRepNodeKey`, { node_id: nodeId, private_key: privateKey, wallet_address: repnodeWalletAddress });
      setMessage('Key added successfully');
      setNodeId('');
      setPrivateKey('');
      setRepnodeWalletAddress('');
      fetchKeys();
    } catch (err) {
      setMessage('Failed to add key');
    }
  };

  if (!isAdmin) {
    return (
      <div style={{ maxWidth: 500, margin: '60px auto', padding: 32, background: 'rgba(255,255,255,0.95)', borderRadius: 16, boxShadow: '0 4px 24px #e0e0e0', textAlign: 'center' }}>
        <h2 style={{ color: '#ff6b35' }}>Admin Access Only</h2>
        <p style={{ color: '#444', fontSize: 18 }}>Connect with the admin wallet to access the Repnode Admin Dashboard.</p>
      </div>
    );
  }

  // Show full admin dashboard once connected
  return (
    <div style={{ maxWidth: 700, margin: '40px auto', padding: 32, background: 'linear-gradient(135deg,#fff7e6 0%,#e0e7ff 100%)', borderRadius: 16, boxShadow: '0 4px 24px #e0e0e0' }}>
      <h2 style={{ color: '#1a3a52', marginBottom: 24, letterSpacing: 1 }}>Repnode Admin Dashboard</h2>
      <form onSubmit={handleAddKey} style={{ marginBottom: 32, display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 120 }}>
          <label style={{ fontWeight: 600, color: '#333' }}>Node ID:</label>
          <input value={nodeId} onChange={e => setNodeId(e.target.value)} required style={{ marginLeft: 8, padding: 8, borderRadius: 6, border: '1px solid #bbb', width: '100%' }} />
        </div>
        <div style={{ flex: 2, minWidth: 220 }}>
          <label style={{ fontWeight: 600, color: '#333' }}>Private Key:</label>
          <input value={privateKey} onChange={e => setPrivateKey(e.target.value)} required style={{ marginLeft: 8, padding: 8, borderRadius: 6, border: '1px solid #bbb', width: '100%' }} />
        </div>
        <div style={{ flex: 2, minWidth: 220 }}>
          <label style={{ fontWeight: 600, color: '#333' }}>REP Node Wallet:</label>
          <input value={repnodeWalletAddress} onChange={e => setRepnodeWalletAddress(e.target.value)} required placeholder="0x..." style={{ marginLeft: 8, padding: 8, borderRadius: 6, border: '1px solid #bbb', width: '100%' }} />
        </div>
        <button type="submit" style={{ background: '#ff6b35', color: 'white', border: 'none', borderRadius: 8, padding: '10px 28px', fontWeight: 700, fontSize: 16, cursor: 'pointer', marginTop: 18 }}>Add Key</button>
      </form>
      {message && <div style={{ color: message.includes('success') ? 'green' : 'red', marginBottom: 18, fontWeight: 600 }}>{message}</div>}
      <h3 style={{ color: '#1a3a52', marginBottom: 12 }}>All Repnode Keys</h3>
      {loading ? <div>Loading...</div> : (
        <table style={{ width: '100%', borderCollapse: 'collapse', background: 'white', borderRadius: 8, overflow: 'hidden', boxShadow: '0 2px 8px #eee' }}>
          <thead style={{ background: '#e0e7ff' }}>
            <tr>
              <th style={{ borderBottom: '2px solid #c7d2fe', padding: 10, color: '#1a3a52', fontWeight: 700 }}>Node ID</th>
              <th style={{ borderBottom: '2px solid #c7d2fe', padding: 10, color: '#1a3a52', fontWeight: 700 }}>Wallet Address</th>
              <th style={{ borderBottom: '2px solid #c7d2fe', padding: 10, color: '#1a3a52', fontWeight: 700 }}>Encrypted Key</th>
            </tr>
          </thead>
          <tbody>
            {keys.map(k => (
              <tr key={k.node_id}>
                <td style={{ padding: 10, fontWeight: 600 }}>{k.node_id}</td>
                <td style={{ fontFamily: 'monospace', fontSize: 12, padding: 10 }}>{k.wallet_address || 'Not assigned'}</td>
                <td style={{ fontFamily: 'monospace', fontSize: 13, padding: 10 }}>{k.encrypted_private_key.slice(0, 32)}...</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
