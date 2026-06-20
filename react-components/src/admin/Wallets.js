import React, { useState, useEffect } from 'react';
import axios from 'axios';

export default function Wallets({ mode = 'admin', walletAddress }) {
  const [wallets, setWallets] = useState([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const defaultApiBase = `${window.location.protocol}//${window.location.hostname}:8000/server.php`;
  const apiBase = process.env.REACT_APP_API_BASE || defaultApiBase;

  useEffect(() => {
    const fetchWallets = async () => {
      setLoading(true);
      setMessage('');

      try {
        if (mode === 'repnode') {
          if (!walletAddress) {
            setWallets([]);
            setMessage('Connect wallet to view repnode wallet info.');
          } else {
            const res = await axios.get(`${apiBase}?action=get-user-by-address&address=${walletAddress}`);
            if (res.data && res.data.success && res.data.user) {
              const user = res.data.user;
              setWallets([
                {
                  address: user.address,
                  balance: user.balance,
                  reward_amount: user.reward_amount,
                  repnode_id: null
                }
              ]);
            } else {
              setWallets([]);
              setMessage('No wallet data found.');
            }
          }
        } else {
          const res = await axios.get(`${apiBase}?action=wallets`);
          setWallets(res.data || []);
        }
      } catch (err) {
        setMessage('Failed to fetch wallets');
      }

      setLoading(false);
    };

    fetchWallets();
  }, [apiBase, mode, walletAddress]);

  return (
    <div className="admin-card">
      <h2 className="admin-title">Wallets</h2>
      {message && <div className="admin-message" style={{ color: '#c53030' }}>{message}</div>}
      {loading ? <div>Loading...</div> : (
        <table className="admin-table">
          <thead>
            <tr>
              <th>Address</th>
              <th>Balance</th>
              <th>Reward</th>
              <th>Node</th>
            </tr>
          </thead>
          <tbody>
            {wallets.map(w => (
              <tr key={w.address}>
                <td>{w.address}</td>
                <td>{w.balance}</td>
                <td>{w.reward_amount}</td>
                <td>{w.repnode_id}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
