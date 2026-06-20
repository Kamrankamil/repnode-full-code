import React, { useState, useEffect } from 'react';
import axios from 'axios';

export default function Rewards({ mode = 'admin', walletAddress }) {
  const [rewards, setRewards] = useState([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;
  const defaultApiBase = `${window.location.protocol}//${window.location.hostname}:8000/server.php`;
  const apiBase = process.env.REACT_APP_API_BASE || defaultApiBase;

  useEffect(() => {
    const fetchRewards = async () => {
      setLoading(true);
      setMessage('');

      try {
        if (mode === 'repnode') {
          if (!walletAddress) {
            setRewards([]);
            setMessage('Connect wallet to view repnode rewards.');
          } else {
            const res = await axios.get(`${apiBase}?action=get-user-rewards&address=${walletAddress}`);
            if (res.data && res.data.success && res.data.reward) {
              const reward = res.data.reward;
              setRewards([
                {
                  id: reward.address,
                  reward_date: reward.createdAt,
                  wallet_address: reward.address,
                  reward_amount: reward.rewardAmount,
                  repnode_id: null
                }
              ]);
            } else {
              setRewards([]);
              setMessage('No rewards found for this repnode.');
            }
          }
        } else {
          const res = await axios.get(`${apiBase}?action=get-all-rewards`);
          const payload = res.data || {};
          const mappedRewards = (payload.rewards || []).map(reward => ({
            id: reward.address,
            reward_date: reward.createdAt,
            wallet_address: reward.address,
            reward_amount: reward.rewardAmount,
            repnode_id: null
          }));
          setRewards(mappedRewards);
          setCurrentPage(1);
        }
      } catch (err) {
        setMessage('Failed to fetch rewards');
      }

      setLoading(false);
    };

    fetchRewards();
  }, [apiBase, mode, walletAddress]);

  const totalPages = Math.max(1, Math.ceil(rewards.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const startIndex = (safePage - 1) * pageSize;
  const pagedRewards = rewards.slice(startIndex, startIndex + pageSize);

  const goToPage = (page) => {
    setCurrentPage(Math.min(Math.max(page, 1), totalPages));
  };

  return (
    <div className="admin-card">
      <h2 className="admin-title">Rewards</h2>
      {message && <div className="admin-message" style={{ color: '#c53030' }}>{message}</div>}
      {loading ? <div>Loading...</div> : (
        <>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Wallet</th>
                <th>Amount</th>
                <th>Node</th>
              </tr>
            </thead>
            <tbody>
              {pagedRewards.length === 0 ? (
                <tr>
                  <td colSpan="4" style={{ textAlign: 'center', padding: '20px' }}>
                    No rewards found.
                  </td>
                </tr>
              ) : (
                pagedRewards.map(r => (
                  <tr key={r.id}>
                    <td>{r.reward_date}</td>
                    <td>{r.wallet_address}</td>
                    <td>{r.reward_amount}</td>
                    <td>{r.repnode_id}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>

          <div className="admin-pagination">
            <div className="admin-page-info">
              Showing {rewards.length === 0 ? 0 : startIndex + 1}–{Math.min(startIndex + pageSize, rewards.length)} of {rewards.length}
            </div>
            <div className="admin-page-controls">
              <button className="admin-page-btn" onClick={() => goToPage(1)} disabled={safePage === 1}>
                ⏮ First
              </button>
              <button className="admin-page-btn" onClick={() => goToPage(safePage - 1)} disabled={safePage === 1}>
                ◀ Prev
              </button>
              <span className="admin-page-current">Page {safePage} of {totalPages}</span>
              <button className="admin-page-btn" onClick={() => goToPage(safePage + 1)} disabled={safePage === totalPages}>
                Next ▶
              </button>
              <button className="admin-page-btn" onClick={() => goToPage(totalPages)} disabled={safePage === totalPages}>
                Last ⏭
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
