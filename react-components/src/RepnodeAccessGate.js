import React from 'react';
import RepnodeDashboard from './admin/RepnodeDashboard';
import { repnodeUrl } from './repnodeApiBase';

function AccessMessage({ title, message, action }) {
  return (
    <div style={{ minHeight: '70vh', display: 'grid', placeItems: 'center', padding: '120px 24px 60px' }}>
      <div style={{ width: 'min(100%, 560px)', padding: 38, borderRadius: 24, background: '#fff', boxShadow: '0 18px 55px rgba(26,58,82,.14)', textAlign: 'center' }}>
        <div style={{ width: 68, height: 68, display: 'grid', placeItems: 'center', margin: '0 auto 18px', borderRadius: 22, background: '#f3e8da', fontSize: 30 }}>🔐</div>
        <h2 style={{ margin: '0 0 12px', color: '#17364d' }}>{title}</h2>
        <p style={{ margin: '0 0 24px', color: '#667584', lineHeight: 1.6 }}>{message}</p>
        {action}
      </div>
    </div>
  );
}

export default function RepnodeAccessGate({ walletAddress, walletConnected, onConnectWallet }) {
  const [access, setAccess] = React.useState({ loading: false, authorized: false, checked: false });

  React.useEffect(() => {
    let active = true;

    if (!walletConnected || !walletAddress) {
      setAccess({ loading: false, authorized: false, checked: false });
      return () => { active = false; };
    }

    setAccess({ loading: true, authorized: false, checked: false });
    const verifyOwnership = async () => {
      try {
        const challengeResponse = await fetch(repnodeUrl(`/repnode/access-challenge/${walletAddress}`));
        const challenge = await challengeResponse.json();
        if (challenge.status !== 'success') throw new Error(challenge.message || 'Unable to create access challenge.');

        const signature = await window.ethereum.request({
          method: 'personal_sign',
          params: [challenge.message, walletAddress]
        });

        const verifyResponse = await fetch(repnodeUrl('/repnode/verify-access'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ wallet_address: walletAddress, signature })
        });
        const verification = await verifyResponse.json();
        if (active) setAccess({ loading: false, authorized: verification.status === 'success' && verification.authorized === true, checked: true });
      } catch (_error) {
        if (active) setAccess({ loading: false, authorized: false, checked: true });
      }
    };

    verifyOwnership();

    return () => { active = false; };
  }, [walletAddress, walletConnected]);

  if (!walletConnected || !walletAddress) {
    return (
      <AccessMessage
        title="REP Node wallet required"
        message="Connect the wallet address assigned to your REP node to open this dashboard."
        action={<button className="launch-btn" onClick={onConnectWallet}>Connect REP Node Wallet</button>}
      />
    );
  }

  if (access.loading) {
    return <AccessMessage title="Checking REP Node access" message="Verifying the connected wallet against the REP-node registry…" />;
  }

  if (!access.authorized) {
    return (
      <AccessMessage
        title="Access denied"
        message={`Wallet ${walletAddress.slice(0, 8)}…${walletAddress.slice(-6)} is registered as a user wallet, not a REP-node wallet.`}
      />
    );
  }

  return <RepnodeDashboard walletAddress={walletAddress} />;
}
