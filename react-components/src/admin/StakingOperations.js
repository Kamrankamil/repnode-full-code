import React from 'react';
import { repnodeUrl } from '../repnodeApiBase';

function formatAmount(value, digits = 4) {
  const numeric = Number(value || 0);
  return numeric.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
}

function formatDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export default function StakingOperations() {
  const [matured, setMatured] = React.useState([]);
  const [pendingDeposits, setPendingDeposits] = React.useState([]);
  const [loading, setLoading] = React.useState(false);
  const [running, setRunning] = React.useState(false);
  const [message, setMessage] = React.useState('');

  const fetchQueues = React.useCallback(async () => {
    setLoading(true);
    setMessage('');

    try {
      const [maturedResponse, depositsResponse] = await Promise.all([
        fetch(repnodeUrl('/staking/matured')),
        fetch(repnodeUrl('/staking/deposits/pending')),
      ]);

      const maturedData = await maturedResponse.json();
      const depositsData = await depositsResponse.json();

      if (!maturedData.status || maturedData.status !== 'success') {
        throw new Error(maturedData.message || 'Failed to fetch matured stakes');
      }

      if (!depositsData.status || depositsData.status !== 'success') {
        throw new Error(depositsData.message || 'Failed to fetch pending deposits');
      }

      setMatured(maturedData.positions || []);
      setPendingDeposits(depositsData.deposits || []);
    } catch (error) {
      setMessage(error.message || 'Failed to fetch staking operations data.');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    fetchQueues();
  }, [fetchQueues]);

  const runProcessor = async (path, successText) => {
    setRunning(true);
    setMessage('');

    try {
      const response = await fetch(repnodeUrl(path), {
        method: 'POST',
      });
      const data = await response.json();

      if (data.status !== 'success') {
        throw new Error(data.message || 'Processor failed');
      }

      setMessage(successText);
      await fetchQueues();
    } catch (error) {
      setMessage(error.message || 'Processor failed.');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="admin-card">
      <h2 className="admin-title">Staking Operations</h2>
      {message && <div className="admin-message">{message}</div>}

      <div className="admin-page-controls" style={{ marginBottom: 24 }}>
        <button className="admin-btn" onClick={fetchQueues} disabled={loading || running}>
          {loading ? 'Refreshing...' : 'Refresh queues'}
        </button>
        <button className="admin-btn" onClick={() => runProcessor('/staking/processDeposits', 'Pending deposits processed.')} disabled={loading || running}>
          {running ? 'Processing...' : 'Process deposits'}
        </button>
        <button className="admin-btn" onClick={() => runProcessor('/staking/processMatured', 'Matured stakes processed.')} disabled={loading || running}>
          {running ? 'Processing...' : 'Process matured'}
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 24 }}>
        <div className="admin-card" style={{ margin: 0 }}>
          <h3 className="admin-title">Pending Deposits</h3>
          {pendingDeposits.length === 0 ? (
            <div>No pending deposits.</div>
          ) : (
            <div style={{ display: 'grid', gap: 12 }}>
              {pendingDeposits.map((deposit) => (
                <div key={deposit.id} style={{ padding: 16, border: '1px solid #e2e8f0', borderRadius: 12 }}>
                  <div><strong>{formatAmount(deposit.amountSaya)} SAYA</strong></div>
                  <div>Wallet: {deposit.walletAddress}</div>
                  <div>From: {deposit.sourceWalletAddress}</div>
                  <div>Status: {deposit.status}</div>
                  <div>Confirmations: {deposit.confirmations}</div>
                  <div>Created: {formatDateTime(deposit.createdAt)}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="admin-card" style={{ margin: 0 }}>
          <h3 className="admin-title">Matured Stakes</h3>
          {matured.length === 0 ? (
            <div>No matured stakes ready for payout.</div>
          ) : (
            <div style={{ display: 'grid', gap: 12 }}>
              {matured.map((stake) => (
                <div key={stake.id} style={{ padding: 16, border: '1px solid #e2e8f0', borderRadius: 12 }}>
                  <div><strong>{formatAmount(stake.amountSaya)} SAYA</strong></div>
                  <div>Wallet: {stake.walletAddress}</div>
                  <div>Reward: {formatAmount(stake.rewardEstimate)} SAYA</div>
                  <div>Ends: {formatDateTime(stake.endAt)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}