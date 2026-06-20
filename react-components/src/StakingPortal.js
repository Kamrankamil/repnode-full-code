import React from 'react';
import Web3 from 'web3';
import './StakingPortal.css';
import { API_BASE } from './apiBase';
import { repnodeUrl } from './repnodeApiBase';

const IIC_CHAIN_ID = '0x672';
const IIC_NETWORK_CONFIG = {
  chainId: IIC_CHAIN_ID,
  chainName: 'IIC Blockchain Testnet',
  nativeCurrency: {
    name: 'SAYA',
    symbol: 'SAYA',
    decimals: 18,
  },
  rpcUrls: ['https://rpc.iic-blockchain.com'],
};

const fallbackDurationOptions = [
  { days: 1, apr: 1, label: '1 minute test at 1% APR' },
  { days: 30, apr: 8.5 },
  { days: 90, apr: 12.5 },
  { days: 180, apr: 18 },
  { days: 365, apr: 24 }
];

function formatDurationOptionLabel(option) {
  return option?.label || `${option.days} days at ${option.apr}% APR`;
}

function formatDurationLabelFromTiming(durationMs, durationDays, aprRate) {
  if (durationMs > 0 && durationMs < 24 * 60 * 60 * 1000) {
    const minutes = Math.max(1, Math.round(durationMs / (60 * 1000)));
    return `${minutes} minute${minutes === 1 ? '' : 's'} test at ${aprRate}% APR`;
  }

  return `${durationDays} days at ${aprRate}% APR`;
}

function formatRemainingLabelFromTiming(canClaim, status, endAtMs, now, durationMs) {
  if (canClaim || status === 'claimed') {
    return 'Ready to release principal and reward.';
  }

  if (!Number.isFinite(endAtMs)) {
    return 'Pending maturity';
  }

  const msRemaining = Math.max(0, endAtMs - now);
  if (durationMs > 0 && durationMs < 24 * 60 * 60 * 1000) {
    const minutes = Math.max(1, Math.ceil(msRemaining / (60 * 1000)));
    return `${minutes} minute${minutes === 1 ? '' : 's'} remaining`;
  }

  const days = Math.max(0, Math.ceil(msRemaining / (1000 * 60 * 60 * 24)));
  return `${days} day${days === 1 ? '' : 's'} remaining`;
}

function toNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeRepnodePositions(positions = []) {
  const now = Date.now();

  return positions.map((position) => {
    const amountSaya = toNumber(position.amountSaya);
    const rewardEstimate = toNumber(position.rewardEstimate);
    const claimedReward = toNumber(position.claimedReward);
    const startAtMs = position.startAt ? new Date(position.startAt).getTime() : NaN;
    const endAtMs = position.endAt ? new Date(position.endAt).getTime() : NaN;
    const durationMs = Number.isFinite(startAtMs) && Number.isFinite(endAtMs)
      ? Math.max(1, endAtMs - startAtMs)
      : 1;
    const elapsedMs = Number.isFinite(startAtMs)
      ? Math.min(Math.max(0, now - startAtMs), durationMs)
      : 0;
    const progressPercent = position.status === 'claimed'
      ? 100
      : Number(((elapsedMs / durationMs) * 100).toFixed(2));
    const canClaim = position.status === 'active' && Number.isFinite(endAtMs) && now >= endAtMs;
    const accruedReward = position.status === 'claimed'
      ? claimedReward
      : Number((rewardEstimate * (elapsedMs / durationMs)).toFixed(4));

    return {
      ...position,
      amountSaya,
      rewardEstimate,
      claimedReward,
      durationLabel: position.durationLabel || formatDurationLabelFromTiming(durationMs, toNumber(position.durationDays), toNumber(position.aprRate)),
      status: canClaim ? 'claimable' : position.status,
      progressPercent,
      accruedReward,
      canClaim,
      daysRemaining: canClaim || position.status === 'claimed' || !Number.isFinite(endAtMs)
        ? 0
        : Math.max(0, Math.ceil((endAtMs - now) / (1000 * 60 * 60 * 24))),
      remainingLabel: position.remainingLabel || formatRemainingLabelFromTiming(canClaim, position.status, endAtMs, now, durationMs)
    };
  });
}

function buildRepnodeSummary(positions = [], wallet = null, fallbackSummary = null) {
  const activePositions = positions.filter((position) => position.status === 'active' || position.status === 'claimable');
  const totalActiveStaked = activePositions.reduce((sum, position) => sum + toNumber(position.amountSaya), 0);
  const totalProjectedReward = activePositions.reduce((sum, position) => sum + toNumber(position.rewardEstimate), 0);
  const totalClaimableReward = positions
    .filter((position) => position.canClaim)
    .reduce((sum, position) => sum + toNumber(position.rewardEstimate), 0);

  return {
    totalActiveStaked: Number(totalActiveStaked.toFixed(4)),
    totalProjectedReward: Number(totalProjectedReward.toFixed(4)),
    totalClaimableReward: Number(totalClaimableReward.toFixed(4)),
    totalRewardsClaimed: toNumber(wallet?.totalRewardsClaimed, toNumber(fallbackSummary?.totalRewardsClaimed))
  };
}

function formatAmount(value, digits = 4) {
  const numeric = Number(value || 0);
  return numeric.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits
  });
}

function formatDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function getActivityLabel(type) {
  switch (type) {
    case 'asset-exchange':
      return 'Asset exchange';
    case 'stake-created':
      return 'Stake opened';
    case 'stake-claimed':
      return 'Stake claimed';
    default:
      return type;
  }
}

function StakingPortal({ walletAddress, walletConnected, onConnectWallet }) {
  const [dashboard, setDashboard] = React.useState(null);
  const [loading, setLoading] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState('');
  const [message, setMessage] = React.useState('');
  const [depositForm, setDepositForm] = React.useState({ amount: '', txHash: '' });
  const [stakeForm, setStakeForm] = React.useState({ amount: '', durationDays: '90' });
  const [lastRepnodeSync, setLastRepnodeSync] = React.useState('');
  const [walletChainBalance, setWalletChainBalance] = React.useState(null);
  const [pendingDepositIntent, setPendingDepositIntent] = React.useState(null);
  const lastKnownCustodyRef = React.useRef(null);

  const fetchWalletChainBalance = React.useCallback(async () => {
    if (!walletAddress || !window.ethereum) {
      setWalletChainBalance(null);
      return;
    }

    try {
      const web3 = new Web3(window.ethereum);
      const balanceWei = await web3.eth.getBalance(walletAddress);
      setWalletChainBalance(toNumber(web3.utils.fromWei(balanceWei, 'ether')));
    } catch (_balanceError) {
      setWalletChainBalance(null);
    }
  }, [walletAddress]);

  const fetchDashboard = React.useCallback(async () => {
    if (!walletAddress) return;

    setLoading(true);
    setError('');

    try {
      const phpResponse = await fetch(`${API_BASE}?action=get-staking-dashboard`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: walletAddress })
      });

      const phpData = await phpResponse.json();

      if (!phpData.success) {
        throw new Error(phpData.message || 'Failed to load staking dashboard');
      }

      let nextDashboard = {
        ...phpData,
        deposits: [],
        custody: null,
      };

      try {
        const repnodeResponse = await fetch(repnodeUrl(`/staking/wallet/${walletAddress.toLowerCase()}`));
        const repnodeData = await repnodeResponse.json();

        if (repnodeData.status !== 'success') {
          throw new Error(repnodeData.message || 'Failed to load repnode staking summary');
        }

        const normalizedPositions = normalizeRepnodePositions(repnodeData.positions || phpData.positions || []);
        const mergedWallet = repnodeData.wallet || phpData.wallet;

        nextDashboard = {
          ...phpData,
          wallet: mergedWallet,
          positions: normalizedPositions,
          activities: repnodeData.activities || phpData.activities || [],
          deposits: repnodeData.deposits || [],
          custody: repnodeData.custody || null,
          summary: buildRepnodeSummary(normalizedPositions, mergedWallet, phpData.summary),
        };

        lastKnownCustodyRef.current = repnodeData.custody || null;

        setLastRepnodeSync(new Date().toISOString());
      } catch (repnodeError) {
        setLastRepnodeSync('');
        setError(repnodeError.message || 'Repnode staking API is offline. Start the repnode service and refresh this page.');

        nextDashboard = {
          ...phpData,
          positions: normalizeRepnodePositions(phpData.positions || []),
          deposits: [],
          custody: lastKnownCustodyRef.current,
          summary: buildRepnodeSummary(phpData.positions || [], phpData.wallet, phpData.summary),
        };
      }

      setDashboard(nextDashboard);
    } catch (fetchError) {
      setError(fetchError.message || 'Failed to load staking dashboard');
    } finally {
      setLoading(false);
    }
  }, [walletAddress]);

  React.useEffect(() => {
    if (walletConnected && walletAddress) {
      fetchDashboard();
      fetchWalletChainBalance();
    }
  }, [walletConnected, walletAddress, fetchDashboard, fetchWalletChainBalance]);

  const durationOptions = dashboard?.config?.durationOptions?.length
    ? dashboard.config.durationOptions
    : fallbackDurationOptions;

  const selectedDuration = durationOptions.find((option) => String(option.days) === String(stakeForm.durationDays)) || durationOptions[0];
  const estimatedReward = stakeForm.amount
    ? (Number(stakeForm.amount) * (Number(selectedDuration?.apr || 0) / 100) * (Number(selectedDuration?.days || 0) / 365))
    : 0;

  const runAction = async (action, payload, successText) => {
    if (!walletAddress) {
      setError('Connect your common wallet to continue.');
      return;
    }

    setSubmitting(true);
    setError('');
    setMessage('');

    try {
      const response = await fetch(`${API_BASE}?action=${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: walletAddress, ...payload })
      });

      const data = await response.json();
      if (!data.success) {
        throw new Error(data.message || 'Action failed');
      }

      await fetchDashboard();
      setMessage(data.message || successText);
      return data;
    } catch (actionError) {
      setError(actionError.message || 'Action failed');
      return null;
    } finally {
      setSubmitting(false);
    }
  };

  const processDeposits = async () => {
    await fetch(repnodeUrl('/staking/processDeposits'), { method: 'POST' });
  };

  const createDepositIntent = async (amount) => {
    const intentResponse = await fetch(repnodeUrl('/staking/deposit-intents'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        wallet_address: walletAddress,
        source_wallet_address: walletAddress,
        amount,
      })
    });

    const intentData = await intentResponse.json();
    if (intentData.status !== 'success') {
      throw new Error(intentData.message || 'Failed to create deposit intent');
    }

    return intentData;
  };

  const isUserRejectedError = (error) => {
    const message = String(error?.message || error || '').toLowerCase();
    return error?.code === 4001 || error?.code === 'ACTION_REJECTED' || message.includes('rejected') || message.includes('denied');
  };

  const cleanTxParams = (params) => Object.fromEntries(
    Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== '')
  );

  const ensureIicNetwork = async () => {
    const currentChainId = await window.ethereum.request({ method: 'eth_chainId' }).catch(() => null);
    if (currentChainId === IIC_CHAIN_ID) {
      return IIC_CHAIN_ID;
    }

    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: IIC_CHAIN_ID }]
      });
      return IIC_CHAIN_ID;
    } catch (switchError) {
      if (switchError?.code !== 4902) {
        throw switchError;
      }

      await window.ethereum.request({
        method: 'wallet_addEthereumChain',
        params: [IIC_NETWORK_CONFIG]
      });

      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: IIC_CHAIN_ID }]
      });

      return IIC_CHAIN_ID;
    }
  };

  const submitAutomaticWalletDeposit = async (intentData, amount) => {
    const web3 = new Web3(window.ethereum);
    const amountWeiDecimal = web3.utils.toWei(String(amount), 'ether');
    const amountWeiHex = web3.utils.numberToHex(amountWeiDecimal);
    const chainId = await ensureIicNetwork();

    const baseParams = {
      from: walletAddress,
      to: intentData.vaultAddress,
    };

    const attempts = [
      {
        label: 'provider-hex',
        run: () => window.ethereum.request({
          method: 'eth_sendTransaction',
          params: [cleanTxParams({ ...baseParams, value: amountWeiHex })]
        })
      },
      {
        label: 'provider-hex-chain',
        run: () => window.ethereum.request({
          method: 'eth_sendTransaction',
          params: [cleanTxParams({ ...baseParams, value: amountWeiHex, chainId })]
        })
      },
      {
        label: 'provider-hex-gas',
        run: () => window.ethereum.request({
          method: 'eth_sendTransaction',
          params: [cleanTxParams({ ...baseParams, value: amountWeiHex, gas: '0x5208', chainId })]
        })
      },
    ];

    const errors = [];
    for (const attempt of attempts) {
      try {
        const txHash = await attempt.run();
        if (txHash && /^0x[0-9a-fA-F]+$/.test(String(txHash))) {
          return txHash;
        }
      } catch (error) {
        if (isUserRejectedError(error)) {
          throw error;
        }

        errors.push(`${attempt.label}: ${error?.message || String(error)}`);
      }
    }

    throw new Error(errors[errors.length - 1] || 'Automatic wallet transfer failed for all compatibility modes.');
  };

  const finalizeAttachedDeposit = async (intentId, txHash) => {
    const attachResponse = await fetch(repnodeUrl(`/staking/deposit-intents/${intentId}/attachTx`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tx_hash: txHash })
    });

    const attachData = await attachResponse.json();
    if (attachData.status !== 'success') {
      throw new Error(attachData.message || 'Failed to attach deposit transaction');
    }

    await processDeposits();
    await fetchDashboard();
    await fetchWalletChainBalance();
    setPendingDepositIntent(null);
    setDepositForm({ amount: '', txHash: '' });
    setMessage(`Deposit sent from your current wallet and attached successfully. Tx: ${txHash}`);
  };

  const copyText = async (value, successText) => {
    if (!value || !navigator?.clipboard) {
      setError('Clipboard is not available in this browser.');
      return;
    }

    try {
      await navigator.clipboard.writeText(String(value));
      setMessage(successText);
    } catch (_copyError) {
      setError('Failed to copy value to clipboard.');
    }
  };

  const handleDepositSubmit = async (event) => {
    event.preventDefault();
    const amount = Number(depositForm.amount);

    if (!amount || amount <= 0) {
      setError('Enter a valid SAYA amount to deposit.');
      return;
    }

    if (!window.ethereum) {
      setError('A wallet provider is required to send the custody deposit.');
      return;
    }

    setSubmitting(true);
    setError('');
    setMessage('');

    try {
      const intentData = await createDepositIntent(amount);
      const nextIntent = {
        intentId: intentData.intentId,
        vaultAddress: intentData.vaultAddress,
        amountSaya: intentData.amountSaya,
      };

      setPendingDepositIntent(nextIntent);
      setDepositForm((current) => ({ ...current, txHash: '' }));
      await fetchDashboard();

      const txHash = await submitAutomaticWalletDeposit(intentData, amount);

      await finalizeAttachedDeposit(intentData.intentId, txHash);
    } catch (actionError) {
      setError(actionError.message || 'Automatic wallet transfer failed.');

      if (!pendingDepositIntent?.intentId) {
        const amountSaya = Number(depositForm.amount || 0);
        if (amountSaya > 0 && lastKnownCustodyRef.current?.vaultAddress) {
          setPendingDepositIntent((current) => current || {
            intentId: null,
            vaultAddress: lastKnownCustodyRef.current.vaultAddress,
            amountSaya,
          });
        }
      }

      setMessage('Automatic transfer did not complete. The portal first tried to switch the wallet to IIC chain 0x672 and then retried multiple wallet-compatible send formats. If your ICC wallet still fails, the recovery panel below can finish the same deposit intent.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleAttachDepositTx = async () => {
    const txHash = String(depositForm.txHash || '').trim();
    const attachableIntentId = pendingDepositIntent?.intentId;

    if (!attachableIntentId) {
      setError('Create a deposit intent before attaching a transaction hash.');
      return;
    }

    if (!/^0x[0-9a-fA-F]+$/.test(txHash)) {
      setError('Enter a valid transaction hash from your wallet transfer.');
      return;
    }

    setSubmitting(true);
    setError('');
    setMessage('');

    try {
      await finalizeAttachedDeposit(attachableIntentId, txHash);
    } catch (attachError) {
      setError(attachError.message || 'Failed to attach deposit transaction.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleStakeSubmit = async (event) => {
    event.preventDefault();
    const amount = Number(stakeForm.amount);
    const durationDays = Number(stakeForm.durationDays);

    if (!amount || amount <= 0) {
      setError('Enter a valid SAYA amount to stake.');
      return;
    }

    if (Number(wallet?.sayaBalance || 0) < amount) {
      setError('Not enough confirmed custody balance to create this stake. Deposit SAYA to the staking vault first.');
      return;
    }

    const result = await runAction('create-saya-stake', {
      amount,
      durationDays
    }, 'SAYA staking position created.');

    if (result) {
      setStakeForm((current) => ({ ...current, amount: '' }));
    }
  };

  const handleClaim = async (positionId) => {
    const result = await runAction('claim-saya-stake', { positionId }, 'Stake claimed successfully.');

    if (result) {
      await fetchWalletChainBalance();
      const txLabel = result.txHash ? ` Tx: ${result.txHash}` : '';
      setMessage(`${formatAmount(result.totalAmount)} SAYA claimed to your wallet.${txLabel}`);
    }
  };

  if (!walletConnected || !walletAddress) {
    return (
      <section className="staking-portal-page">
        <div className="staking-shell">
          <div className="staking-hero-card staking-hero-empty">
            <div>
              <span className="staking-eyebrow">SAYA Staking Service</span>
              <h1>Stake SAYA on the PoA chain from one common wallet.</h1>
              <p>
                DINNAR holders can exchange into SAYA, lock SAYA for a selected staking term, and release principal plus reward back to the same wallet.
              </p>
            </div>
            <button className="staking-primary-btn" onClick={onConnectWallet}>
              Connect Common Wallet
            </button>
          </div>
        </div>
      </section>
    );
  }

  const wallet = dashboard?.wallet;
  const summary = dashboard?.summary;
  const positions = dashboard?.positions || [];
  const activities = dashboard?.activities || [];
  const deposits = dashboard?.deposits || [];
  const custody = dashboard?.custody;
  const repnodeReady = Boolean(custody?.vaultAddress);
  const confirmedSayaBalance = toNumber(wallet?.sayaBalance);
  const lockedSayaBalance = toNumber(wallet?.stakedBalance, toNumber(summary?.totalActiveStaked));
  // sayaBalance already represents liquid custody; stake creation subtracts
  // locked principal from it, so stakedBalance must not be subtracted twice.
  const unstakedCustodyBalance = Math.max(0, confirmedSayaBalance);
  const walletDepositGap = Math.max(0, toNumber(walletChainBalance) - confirmedSayaBalance);

  return (
    <section className="staking-portal-page">
      <div className="staking-shell">
        <div className="staking-hero-card">
          <div className="staking-hero-copy">
            <span className="staking-eyebrow">SAYA Staking Service</span>
            <h1>DINNAR in, SAYA staking in the middle, common wallet out.</h1>
            <p>
              This portal now reads the repnode custody layer directly. Deposit native SAYA into the staking vault, wait for repnode confirmation, and then lock confirmed balance into a staking position.
            </p>
          </div>
          <div className="staking-wallet-id">
            <span>Common wallet</span>
            <strong>{walletAddress}</strong>
            <small className="staking-wallet-sync">Repnode sync: {lastRepnodeSync ? formatDateTime(lastRepnodeSync) : 'Pending'}</small>
          </div>
        </div>

        <div className="staking-guide-card">
          <div className="staking-guide-head">
            <div>
              <span className="staking-eyebrow">How it works</span>
              <h2>Stake SAYA in five simple steps</h2>
            </div>
            <p>Your wallet stays yours. Only deposited SAYA can be locked, and claimed SAYA returns to your wallet.</p>
          </div>

          <ol className="staking-guide-steps">
            <li>
              <span className="guide-step-number">1</span>
              <span className="guide-step-icon" aria-hidden="true">👛</span>
              <h3>Connect wallet</h3>
              <p>Connect the wallet address that owns your SAYA.</p>
            </li>
            <li>
              <span className="guide-step-number">2</span>
              <span className="guide-step-icon" aria-hidden="true">↗</span>
              <h3>Deposit SAYA</h3>
              <p>Send the amount you want to stake into the vault.</p>
            </li>
            <li>
              <span className="guide-step-number">3</span>
              <span className="guide-step-icon" aria-hidden="true">✓</span>
              <h3>Wait for confirmation</h3>
              <p>After 3 confirmations, it appears as available to lock.</p>
            </li>
            <li>
              <span className="guide-step-number">4</span>
              <span className="guide-step-icon" aria-hidden="true">🔒</span>
              <h3>Choose and stake</h3>
              <p>Enter an amount, choose a duration, and start staking.</p>
            </li>
            <li>
              <span className="guide-step-number">5</span>
              <span className="guide-step-icon" aria-hidden="true">💰</span>
              <h3>Claim to wallet</h3>
              <p>At maturity, claim principal and reward back on-chain.</p>
            </li>
          </ol>

          <div className="staking-guide-flow">
            <div>
              <span>IN YOUR WALLET</span>
              <strong>Spendable SAYA</strong>
            </div>
            <span className="guide-flow-arrow">Deposit →</span>
            <div className="guide-vault-state">
              <span>IN THE VAULT</span>
              <strong>Available → Locked</strong>
            </div>
            <span className="guide-flow-arrow">← Claim</span>
            <div>
              <span>BACK IN WALLET</span>
              <strong>Principal + reward</strong>
            </div>
          </div>
        </div>

        {(error || message) && (
          <div className={`staking-feedback ${error ? 'error' : 'success'}`}>
            {error || message}
          </div>
        )}

        <div className="staking-summary-grid">
          <div className="summary-card summary-card-accent">
            <span>Wallet on-chain balance</span>
            <strong>{walletChainBalance === null ? '-' : `${formatAmount(walletChainBalance)} SAYA`}</strong>
          </div>
          <div className="summary-card">
            <span>Vault address</span>
            <strong className="summary-inline-copy">{custody?.vaultAddress || '-'}</strong>
          </div>
          <div className="summary-card">
            <span>Confirmed deposit balance</span>
            <strong>{formatAmount(confirmedSayaBalance)} SAYA</strong>
          </div>
          <div className="summary-card">
            <span>Locked in staking</span>
            <strong>{formatAmount(lockedSayaBalance)} SAYA</strong>
          </div>
          <div className="summary-card">
            <span>Available to start new stake</span>
            <strong>{formatAmount(unstakedCustodyBalance)} SAYA</strong>
          </div>
          <div className="summary-card">
            <span>Deposit confirmations</span>
            <strong>{custody?.minDepositConfirmations ?? '-'}</strong>
          </div>
        </div>

        <div className="staking-balance-note">
          Wallet balance and custody balance are different numbers on purpose. Your wallet can hold more native SAYA on-chain, but only the amount already deposited into the vault and confirmed by the repnode becomes eligible for staking here.
        </div>

        <div className="staking-workspace-grid">
          <form className="staking-panel" onSubmit={handleDepositSubmit}>
            <div className="panel-head">
              <div>
                <span className="panel-tag">Custody Deposit</span>
                <h2>Move SAYA from wallet to vault</h2>
              </div>
              <span className="panel-rate">Repnode Layer 2</span>
            </div>
            <label className="staking-label">
              Vault address
              <input type="text" readOnly value={custody?.vaultAddress || ''} />
            </label>
            <label className="staking-label">
              Deposit amount (SAYA)
              <input
                type="number"
                min="0"
                step="0.0001"
                value={depositForm.amount}
                onChange={(event) => setDepositForm({ amount: event.target.value })}
                placeholder="Enter SAYA amount"
              />
            </label>
            <div className="panel-caption custody-caption">
              Deposit should cut from the current connected wallet address to the repnode vault first. After the repnode sees and confirms that transfer, the amount becomes stakeable.
            </div>
            <div className="panel-caption custody-caption">
              Current view: wallet holds {walletChainBalance === null ? '-' : formatAmount(walletChainBalance)} SAYA on-chain, while {formatAmount(confirmedSayaBalance)} SAYA is already confirmed inside staking custody.
            </div>
            <div className="panel-caption custody-caption">
              Not yet in custody: {formatAmount(walletDepositGap)} SAYA. That amount stays in your wallet until you send it to the vault.
            </div>
            {!repnodeReady && (
              <div className="panel-caption custody-caption">
                Repnode custody is currently unavailable. Start the repnode service with `npm run repnode` and refresh the page before submitting deposits.
              </div>
            )}
            <div className="staking-inline-actions">
              <button type="submit" className="staking-primary-btn" disabled={submitting || loading || !repnodeReady}>
                {submitting ? 'Processing...' : 'Deposit from current wallet'}
              </button>
              <button
                type="button"
                className="staking-secondary-btn"
                onClick={async () => {
                  setSubmitting(true);
                  setError('');
                  try {
                    await processDeposits();
                    await fetchDashboard();
                    setMessage('Repnode deposit processor refreshed.');
                  } catch (refreshError) {
                    setError(refreshError.message || 'Failed to refresh deposits.');
                  } finally {
                    setSubmitting(false);
                  }
                }}
                disabled={submitting || loading || !repnodeReady}
              >
                Refresh deposits
              </button>
            </div>
            {pendingDepositIntent && (
              <div className="manual-deposit-box">
                <div className="manual-deposit-header">
                  <strong>Manual transfer required</strong>
                  <span>Intent #{pendingDepositIntent.intentId}</span>
                </div>
                <p>
                  The portal already tried the automatic wallet transfer first. If your ICC wallet still could not complete it, use your connected wallet app to send exactly {formatAmount(pendingDepositIntent.amountSaya)} SAYA from the current wallet address to the vault address below, then paste the transaction hash here.
                </p>
                <div className="manual-deposit-grid">
                  <div>
                    <span>Vault address</span>
                    <strong className="summary-inline-copy">{pendingDepositIntent.vaultAddress}</strong>
                  </div>
                  <div>
                    <span>Exact amount</span>
                    <strong>{formatAmount(pendingDepositIntent.amountSaya)} SAYA</strong>
                  </div>
                </div>
                <div className="staking-inline-actions">
                  <button type="button" className="staking-secondary-btn" onClick={() => copyText(pendingDepositIntent.vaultAddress, 'Vault address copied to clipboard.')}>Copy vault</button>
                  <button type="button" className="staking-secondary-btn" onClick={() => copyText(pendingDepositIntent.amountSaya, 'Deposit amount copied to clipboard.')}>Copy amount</button>
                </div>
                <label className="staking-label manual-deposit-label">
                  Transaction hash from your wallet transfer
                  <input
                    type="text"
                    value={depositForm.txHash}
                    onChange={(event) => setDepositForm((current) => ({ ...current, txHash: event.target.value }))}
                    placeholder="Paste 0x... transaction hash"
                  />
                </label>
                <button type="button" className="staking-primary-btn" onClick={handleAttachDepositTx} disabled={submitting || loading}>
                  {submitting ? 'Attaching...' : 'Attach tx hash'}
                </button>
              </div>
            )}
          </form>

          <form className="staking-panel" onSubmit={handleStakeSubmit}>
            <div className="panel-head">
              <div>
                <span className="panel-tag">Main Body</span>
                <h2>Create SAYA staking position</h2>
              </div>
              <span className="panel-rate">PoA staking only</span>
            </div>
            <label className="staking-label">
              Staking amount (SAYA)
              <input
                type="number"
                min="0"
                step="0.0001"
                value={stakeForm.amount}
                onChange={(event) => setStakeForm({ ...stakeForm, amount: event.target.value })}
                placeholder="Enter SAYA amount"
              />
            </label>
            <label className="staking-label">
              Duration time
              <select
                value={stakeForm.durationDays}
                onChange={(event) => setStakeForm({ ...stakeForm, durationDays: event.target.value })}
              >
                {durationOptions.map((option) => (
                  <option key={option.days} value={option.days}>
                    {formatDurationOptionLabel(option)}
                  </option>
                ))}
              </select>
            </label>
            <div className="stake-preview">
              <div>
                <span>Estimated reward</span>
                <strong>{formatAmount(estimatedReward)} SAYA</strong>
              </div>
              <div>
                <span>Available to lock</span>
                <strong>{formatAmount(unstakedCustodyBalance)} SAYA</strong>
              </div>
            </div>
            {!repnodeReady && (
              <div className="panel-caption custody-caption">
                Repnode custody must be online before new stakes can be created from confirmed vault balance.
              </div>
            )}
            <button type="submit" className="staking-primary-btn" disabled={submitting || loading || !repnodeReady}>
              {submitting ? 'Locking...' : 'Start staking'}
            </button>
          </form>
        </div>

        <div className="staking-panel">
          <div className="panel-head">
            <div>
              <span className="panel-tag">Deposits</span>
              <h2>Custody deposit queue</h2>
            </div>
            <span className="panel-rate">{deposits.length} tracked</span>
          </div>
          {deposits.length === 0 ? (
            <div className="panel-empty">No deposits tracked yet. Start by sending native SAYA to the vault address.</div>
          ) : (
            <div className="deposit-list">
              {deposits.map((deposit) => (
                <div className="deposit-card" key={deposit.id}>
                  <div className="position-top">
                    <div>
                      <h3>{formatAmount(deposit.amountSaya)} SAYA</h3>
                      <p>{deposit.sourceWalletAddress}</p>
                    </div>
                    <span className={`position-status ${deposit.status === 'confirmed' ? 'claimed' : deposit.status === 'pending_confirmations' ? 'claimable' : 'active'}`}>
                      {deposit.status}
                    </span>
                  </div>
                  <div className="position-metrics">
                    <div>
                      <span>Confirmations</span>
                      <strong>{deposit.confirmations}</strong>
                    </div>
                    <div>
                      <span>Tx hash</span>
                      <strong className="summary-inline-copy">{deposit.txHash || '-'}</strong>
                    </div>
                    <div>
                      <span>Credited at</span>
                      <strong>{formatDateTime(deposit.creditedAt)}</strong>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="staking-lower-grid">
          <div className="staking-panel wide">
            <div className="panel-head">
              <div>
                <span className="panel-tag">Reward Status</span>
                <h2>Active and completed positions</h2>
              </div>
              <span className="panel-rate">{positions.length} positions</span>
            </div>
            {loading ? (
              <div className="panel-empty">Loading staking positions...</div>
            ) : positions.length === 0 ? (
              <div className="panel-empty">No staking positions yet. Exchange into SAYA and start your first position.</div>
            ) : (
              <div className="position-list">
                {positions.map((position) => (
                  <div className="position-card" key={position.id}>
                    <div className="position-top">
                      <div>
                        <h3>{formatAmount(position.amountSaya)} SAYA</h3>
                        <p>{position.durationLabel || formatDurationLabelFromTiming(0, position.durationDays, position.aprRate)}</p>
                      </div>
                      <span className={`position-status ${position.status}`}>{position.status}</span>
                    </div>
                    <div className="position-metrics">
                      <div>
                        <span>Projected reward</span>
                        <strong>{formatAmount(position.rewardEstimate)} SAYA</strong>
                      </div>
                      <div>
                        <span>Accrued reward</span>
                        <strong>{formatAmount(position.accruedReward)} SAYA</strong>
                      </div>
                      <div>
                        <span>Ends</span>
                        <strong>{formatDateTime(position.endAt)}</strong>
                      </div>
                    </div>
                    <div className="position-progress-row">
                      <div className="position-progress-track">
                        <div className="position-progress-bar" style={{ width: `${Math.min(position.progressPercent, 100)}%` }}></div>
                      </div>
                      <span>{position.progressPercent}%</span>
                    </div>
                    <div className="position-footer">
                      <span>
                        {position.remainingLabel || (position.canClaim ? 'Ready to release principal and reward.' : `${position.daysRemaining} days remaining`)}
                      </span>
                      {position.canClaim && (
                        <button
                          type="button"
                          className="staking-secondary-btn"
                          onClick={() => handleClaim(position.id)}
                          disabled={submitting}
                        >
                          Claim to wallet
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="staking-panel">
            <div className="panel-head">
              <div>
                <span className="panel-tag">Common Wallet</span>
                <h2>Recent activity</h2>
              </div>
              <span className="panel-rate">Claimed {formatAmount(wallet?.totalRewardsClaimed)} SAYA</span>
            </div>
            {activities.length === 0 ? (
              <div className="panel-empty">No activity recorded yet.</div>
            ) : (
              <div className="activity-list">
                {activities.map((activity) => (
                  <div className="activity-row" key={`${activity.reference}-${activity.createdAt}`}>
                    <div>
                      <strong>{getActivityLabel(activity.type)}</strong>
                      <p>{formatDateTime(activity.createdAt)}</p>
                    </div>
                    <div className="activity-amount">
                      <span>{formatAmount(activity.amount)} {activity.asset}</span>
                      <small>{activity.reference}</small>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

export default StakingPortal;
