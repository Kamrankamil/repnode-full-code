import React, { useState, useEffect } from 'react';
import axios from 'axios';

export default function Transactions({ mode = 'admin', walletAddress }) {
  const [txs, setTxs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const defaultApiBase = `${window.location.protocol}//${window.location.hostname}:8000/server.php`;
  const apiBase = process.env.REACT_APP_API_BASE || defaultApiBase;

  useEffect(() => {
    const fetchTransactions = async () => {
      setLoading(true);
      setMessage('');

      try {
        if (mode === 'repnode') {
          if (!walletAddress) {
            setTxs([]);
            setMessage('Connect wallet to view repnode transactions.');
          } else {
            const res = await axios.get(`${apiBase}?action=get-user-transactions&address=${walletAddress}&period=yearly`);
            const payload = res.data || {};
            setTxs(payload.transactions || []);
          }
        } else {
          const res = await axios.get(`${apiBase}?action=get-all-transactions`);
          const payload = res.data || {};
          setTxs(payload.transactions || []);
        }
      } catch (err) {
        setMessage('Failed to fetch transactions');
      }

      setLoading(false);
    };

    fetchTransactions();
  }, [apiBase, mode, walletAddress]);

  return (
    <div className="admin-card">
      <h2 className="admin-title">Transactions</h2>
      {message && <div className="admin-message" style={{ color: '#c53030' }}>{message}</div>}
      {loading ? <div>Loading...</div> : (
        <table className="admin-table">
          <thead>
            <tr>
              <th>ID</th>
              {mode === 'admin' && (
                <th>Wallet</th>
              )}
              <th>Date</th>
              <th>Type</th>
              <th>Amount</th>
              <th>Status</th>
              <th>Hash</th>
            </tr>
          </thead>
          <tbody>
            {txs.map(tx => (
              <tr key={tx.id}>
                <td>{tx.id}</td>
                {mode === 'admin' && (
                  <td>{tx.wallet_address}</td>
                )}
                <td>{tx.date}</td>
                <td>{tx.type}</td>
                <td>{tx.amount}</td>
                <td>{tx.status}</td>
                <td>{tx.txHash}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
