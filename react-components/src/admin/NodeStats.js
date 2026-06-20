import React, { useState, useEffect } from 'react';
import axios from 'axios';

export default function NodeStats({ mode = 'admin', walletAddress }) {
  const [stats, setStats] = useState({ nodeCount: 0, totalRewards: 0, activeWallets: 0, totalTransactions: 0, status: 'Active' });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const defaultApiBase = `${window.location.protocol}//${window.location.hostname}:8000/server.php`;
  const apiBase = process.env.REACT_APP_API_BASE || defaultApiBase;

  useEffect(() => {
    const fetchStats = async () => {
      setLoading(true);
      setMessage('');

      try {
        if (mode === 'repnode') {
          if (!walletAddress) {
            setMessage('Connect wallet to view repnode stats.');
            setStats({ nodeCount: 0, totalRewards: 0, activeWallets: 0, totalTransactions: 0, status: 'Disconnected' });
          } else {
            const res = await axios.get(`${apiBase}?action=get-repnode-stats&address=${walletAddress}`);
            const payload = res.data || {};
            setStats({
              nodeCount: 1,
              totalRewards: payload.totalRewards || 0,
              activeWallets: payload.rewardAmount || 0,
              totalTransactions: payload.totalTransactions || 0,
              status: payload.status || 'Active'
            });
          }
        } else {
          const res = await axios.get(`${apiBase}?action=get-mining-stats`);
          const payload = res.data || {};
          setStats({
            nodeCount: payload.totalMiners || 0,
            totalRewards: payload.totalRewards || 0,
            activeWallets: payload.totalTransactions || 0,
            totalTransactions: payload.totalTransactions || 0,
            status: 'Active'
          });
        }
      } catch (err) {
        setMessage('Failed to fetch stats');
      }

      setLoading(false);
    };

    fetchStats();
  }, [apiBase, mode, walletAddress]);

  return (
    <div className="admin-card">
      <h2 className="admin-title">Node Stats</h2>
      {message && <div className="admin-message" style={{ color: '#c53030' }}>{message}</div>}
      {loading ? <div>Loading...</div> : (
        <div className="admin-stats-grid">
          <div className="admin-stat-card">
            <div className="admin-stat-title">Total Nodes</div>
            <div className="admin-stat-value">{stats.nodeCount}</div>
          </div>
          <div className="admin-stat-card">
            <div className="admin-stat-title">Total Rewards</div>
            <div className="admin-stat-value">{stats.totalRewards}</div>
          </div>
          <div className="admin-stat-card">
            <div className="admin-stat-title">Total Transactions</div>
            <div className="admin-stat-value">{stats.totalTransactions}</div>
          </div>
          <div className="admin-stat-card">
            <div className="admin-stat-title">Status</div>
            <div className="admin-stat-value">{stats.status}</div>
          </div>
        </div>
      )}
    </div>
  );
}
