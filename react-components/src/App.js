import React from 'react';
import VerificationDashboard from './VerificationDashboard';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, BarElement, Title, Tooltip, Legend, ArcElement } from 'chart.js';
import { Line, Bar, Pie, Doughnut } from 'react-chartjs-2';
import Web3 from 'web3';
import './index.css';
import AdminDashboard from './admin/AdminDashboard';
import RepnodeAccessGate from './RepnodeAccessGate';
import StakingPortal from './StakingPortal';
import { apiUrl } from './apiBase';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Title, Tooltip, Legend, ArcElement);

function App() {
  const [currentPage, setCurrentPage] = React.useState('home');
  const [walletAddress, setWalletAddress] = React.useState('');
  const [walletConnected, setWalletConnected] = React.useState(false);
  const [walletBalance, setWalletBalance] = React.useState('0');
  const [userDetails, setUserDetails] = React.useState(null);
  const [connectingWallet, setConnectingWallet] = React.useState(false);
  const [walletError, setWalletError] = React.useState('');
  const [walletConfirmed, setWalletConfirmed] = React.useState(false);
  const [pendingWalletAddress, setPendingWalletAddress] = React.useState('');
  const [allRewards, setAllRewards] = React.useState([]);
  const [loadingRewards, setLoadingRewards] = React.useState(false);
  const [allRewardsTotalMiners, setAllRewardsTotalMiners] = React.useState(0);
  const [allRewardsPage, setAllRewardsPage] = React.useState(1);
  const [myReward, setMyReward] = React.useState(null);
  const [rewardPeriod, setRewardPeriod] = React.useState('weekly'); // weekly, monthly, yearly
  const [transactions, setTransactions] = React.useState([]);
  const [loadingTransactions, setLoadingTransactions] = React.useState(false);
  const [miningStats, setMiningStats] = React.useState({
    totalMiners: 0,
    totalRewards: 0,
    averageReward: 0,
    totalTransactions: 0,
    totalRegions: 45,
    apr: 12.5
  });
  const goToMyReward = () => setCurrentPage('my-reward');
  const goToAdmin = () => setCurrentPage('admin');
  const goToStaking = () => setCurrentPage('staking');

  // Claim reward state (must be at top level)
  const [claiming, setClaiming] = React.useState(false);
  const [claimMessage, setClaimMessage] = React.useState('');
  const [claimTxHash, setClaimTxHash] = React.useState('');

  // Fetch user transactions from backend
  const fetchUserTransactions = async (address, period) => {
    console.log('Fetching transactions for address:', address, 'period:', period);
    setLoadingTransactions(true);
    try {
      const response = await fetch(apiUrl('get-user-transactions'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, period })
      });
      const data = await response.json();
      console.log('Transactions response:', data);
      if (data.success) {
        setTransactions(data.transactions || []);
      } else {
        setTransactions([]);
      }
    } catch (error) {
      console.error('Error fetching transactions:', error);
      setTransactions([]);
    }
    setLoadingTransactions(false);
  };

  // Load transactions when period changes or wallet address is set
  React.useEffect(() => {
    if (walletAddress && currentPage === 'my-reward') {
      fetchUserTransactions(walletAddress, rewardPeriod);
    }
  }, [walletAddress, rewardPeriod, currentPage]);

  // Fetch mining statistics
  const fetchMiningStats = async () => {
    try {
      const response = await fetch(apiUrl('get-mining-stats'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await response.json();
      if (data.success) {
        setMiningStats({
          totalMiners: data.totalMiners,
          totalRewards: data.totalRewards,
          averageReward: data.averageReward,
          totalTransactions: data.totalTransactions,
          totalRegions: data.totalRegions,
          apr: data.apr
        });
      }
    } catch (error) {
      console.error('Error fetching mining stats:', error);
    }
  };

  // Load mining stats on component mount
  React.useEffect(() => {
    fetchMiningStats();
    const interval = setInterval(fetchMiningStats, 30000); // Refresh every 30 seconds
    return () => clearInterval(interval);
  }, []);

  const goToSection = (sectionId) => {
    setCurrentPage('home');
    setTimeout(() => {
      const el = document.getElementById(sectionId);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth' });
      }
    }, 0);
  };

  const goToDocs = (sectionId) => {
    setCurrentPage('docs');
    setTimeout(() => {
      const el = document.getElementById(sectionId);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth' });
      }
    }, 0);
  };

  const goToRewards = () => {
    setCurrentPage('rewards');
  };

  const goToAllRewards = async () => {
    setCurrentPage('all-rewards');
    setLoadingRewards(true);
    try {
      const response = await fetch(apiUrl('get-all-rewards'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await response.json();
      if (data.success) {
        setAllRewards(data.rewards || []);
        setAllRewardsTotalMiners(data.totalMiners || 0);
        setAllRewardsPage(1);
      }
    } catch (error) {
      console.error('Error fetching rewards:', error);
    }
    setLoadingRewards(false);
  };

  // Connect to ICC Wallet
  const connectWallet = async () => {
    setConnectingWallet(true);
    setWalletError('');
    setWalletConfirmed(false);

    try {
      // Check if ICC Wallet is installed
      if (!window.ethereum) {
        setWalletError('ICC Wallet is not installed. Please install IIC Wallet extension.');
        setConnectingWallet(false);
        return;
      }

      // Request wallet connection
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      
      if (accounts.length === 0) {
        setWalletError('No accounts found. Please check IIC Wallet.');
        setConnectingWallet(false);
        return;
      }

      const account = accounts[0];
      const web3 = new Web3(window.ethereum);

      // Get wallet balance
      const balanceWei = await web3.eth.getBalance(account);
      const balanceEth = web3.utils.fromWei(balanceWei, 'ether');

      // Set pending state - awaiting user confirmation
      setPendingWalletAddress(account);
      setWalletBalance(balanceEth);
      setWalletConnected(false);
      setWalletConfirmed(false);

      // Fetch user details from backend
      const response = await fetch(apiUrl('get-user-by-address'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: account })
      });

      const userData = await response.json();
      if (userData.success) {
        setUserDetails(userData.user);
      } else {
        // User not found, show new user option
        setUserDetails(null);
      }

      console.log('✅ Wallet detected:', account);
    } catch (error) {
      console.error('❌ Error connecting wallet:', error);
      
      if (error.code === -32002) {
        setWalletError('Please open ICC Wallet and accept the connection request.');
      } else if (error.code === 4001) {
        setWalletError('Connection rejected by user.');
      } else {
        setWalletError('Failed to connect wallet. Please try again.');
      }
    }

    setConnectingWallet(false);
  };

  // Confirm wallet address
  const confirmWalletAddress = () => {
    if (!pendingWalletAddress) {
      setWalletError('No wallet address to confirm.');
      return;
    }

    setWalletAddress(pendingWalletAddress);
    setWalletConnected(false);
    setWalletConfirmed(false);
    setPendingWalletAddress('');
    console.log('✅ Wallet confirmed:', pendingWalletAddress);

    if (!userDetails) {
      setWalletError('Wallet not found in database. Please register first.');
      return;
    }

    setWalletError('');
    setCurrentPage('verification');
  };

  // Cancel wallet connection
  const cancelWalletConnection = () => {
    setPendingWalletAddress('');
    setWalletBalance('0');
    setUserDetails(null);
    setWalletError('');
  };

  // Disconnect wallet
  const disconnectWallet = () => {
    setWalletAddress('');
    setWalletConnected(false);
    setWalletConfirmed(false);
    setWalletBalance('0');
    setUserDetails(null);
    setWalletError('');
    setPendingWalletAddress('');
  };

  // Proceed with verification after wallet connection
  const handleProceedWithVerification = () => {
    if (!walletConfirmed || !walletAddress) {
      setWalletError('Please connect your wallet first.');
      return;
    }
    setCurrentPage('verification');
  };

  // Generate chart data for All Rewards
  const generateAllRewardsCharts = () => {
    if (!allRewards || allRewards.length === 0) return null;

    // Top 10 Miners - Bar Chart
    const top10 = allRewards.slice(0, 10);
    const topMinersData = {
      labels: top10.map((_, i) => `Node ${i + 1}`),
      datasets: [{
        label: 'Reward Amount (SAYA)',
        data: top10.map(r => parseFloat(r.rewardAmount)),
        backgroundColor: 'rgba(26, 58, 82, 0.95)',
        borderColor: '#d4a574',
        borderWidth: 2,
        borderRadius: 14,
        borderSkipped: false,
        barThickness: 18,
        hoverBackgroundColor: '#1a3a52',
        hoverBorderColor: '#d4a574',
        hoverBorderWidth: 3
      }]
    };

    // Reward Distribution - Pie Chart
    const ranges = {
      '0-100': 0,
      '100-500': 0,
      '500-1000': 0,
      '1000-5000': 0,
      '5000+': 0
    };

    allRewards.forEach(r => {
      const amount = parseFloat(r.rewardAmount);
      if (amount < 100) ranges['0-100']++;
      else if (amount < 500) ranges['100-500']++;
      else if (amount < 1000) ranges['500-1000']++;
      else if (amount < 5000) ranges['1000-5000']++;
      else ranges['5000+']++;
    });

    const distributionData = {
      labels: ['0-100 SAYA', '100-500 SAYA', '500-1000 SAYA', '1000-5000 SAYA', '5000+ SAYA'],
      datasets: [{
        data: Object.values(ranges),
        backgroundColor: [
          '#1a3a52', '#2f4b66', '#d4a574', '#c49563', '#b38552'
        ],
        borderColor: 'white',
        borderWidth: 2,
        hoverBorderWidth: 3,
        hoverOffset: 12
      }]
    };

    // Average Reward - Gauge-style chart
    const totalReward = allRewards.reduce((sum, r) => sum + parseFloat(r.rewardAmount), 0);
    const avgReward = allRewards.length > 0 ? totalReward / allRewards.length : 0;
    const avgRewardData = {
      labels: ['Average Reward', 'Below Average'],
      datasets: [{
        data: [avgReward, 10000 - avgReward],
        backgroundColor: ['#d4a574', '#e0e0e0'],
        borderColor: 'white',
        borderWidth: 3
      }]
    };

    // Miners Growth - Line Chart
    const minersGrowth = {
      labels: ['Week 1', 'Week 2', 'Week 3', 'Week 4', 'Week 5', 'Week 6', 'Week 7'],
      datasets: [{
        label: 'Active Miners',
        data: [10, 25, 45, 62, 78, 85, allRewards.length],
        borderColor: '#1a3a52',
        backgroundColor: 'rgba(26, 58, 82, 0.1)',
        borderWidth: 3,
        fill: true,
        tension: 0.4,
        pointBackgroundColor: '#d4a574',
        pointBorderColor: '#1a3a52',
        pointBorderWidth: 2,
        pointRadius: 5,
        pointHoverRadius: 7
      }]
    };

    return { topMinersData, distributionData, avgRewardData, minersGrowth };
  };

  // Generate chart data for Home Page
  const generateHomeCharts = () => {
    // Mining trend data (mock data for demo)
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const miningTrendData = {
      labels: days,
      datasets: [{
        label: 'Daily Rewards (SAYA)',
        data: [2400, 3210, 2290, 2000, 2181, 2500, 2100],
        borderColor: '#ff6b35',
        backgroundColor: 'rgba(255, 107, 53, 0.1)',
        borderWidth: 3,
        fill: true,
        tension: 0.4,
        pointBackgroundColor: '#ff6b35',
        pointBorderColor: 'white',
        pointBorderWidth: 2,
        pointRadius: 6,
        pointHoverRadius: 8
      }]
    };

    // Platform stats - Doughnut
    const statsData = {
      labels: ['REP Node (60%)', 'Mobile Node 1 (10%)', 'Mobile Node 2 (10%)', 'Mobile Node 3 (10%)', 'Mobile Node 4 (10%)'],
      datasets: [{
        data: [60, 10, 10, 10, 10],
        backgroundColor: ['#ff6b35', '#ff8f5e', '#ff9f73', '#ffb089', '#ffc1a0'],
        borderColor: 'white',
        borderWidth: 2
      }]
    };

    return { miningTrendData, statsData };
  };

  const handleLaunchClick = () => {
    if (!walletConnected) {
      connectWallet();
    } else {
      handleProceedWithVerification();
    }
  };

  const handleVerificationComplete = (data) => {
    console.log('✅ Verification Complete:', data);
    setWalletConnected(true);
    setWalletConfirmed(true);
    setWalletError('');

    fetch(apiUrl('get-user-rewards'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: walletAddress })
    })
      .then(res => res.json())
      .then(json => {
        if (json.success) {
          setMyReward(json.reward);
        } else {
          setMyReward(null);
        }
        setCurrentPage('rewards');
      })
      .catch(err => {
        console.error('Failed to load user reward', err);
        setMyReward(null);
        setCurrentPage('rewards');
      });
  };

  const ADMIN_WALLET = '0x4be29fe98807df5ad8aa276341d2da5e0eed0283'.toLowerCase();

  if (currentPage === 'verification') {
    return (
      <div className="app">
        <VerificationDashboard
          walletAddress={walletAddress}
          onVerificationComplete={handleVerificationComplete}
        />
      </div>
    );
  }

  const renderHome = () => (
    <>
      {/* Hero Section */}
      <section className="hero-section">
        <div className="hero-container">
          <div className="hero-content">
            <h1>
              Mine <span className="highlight">SAYA coin</span>, earn rewards, & secure IIC Blockchain
            </h1>
            <p className="hero-subtitle">
              REP Node is the leading decentralized representative voting node for mobile users on ICC Blockchain
            </p>

            {/* Connect Wallet Button Only */}
            {!walletConnected && !pendingWalletAddress ? (
              <div className="wallet-connection">
                <button className="btn-connect-wallet" onClick={connectWallet} disabled={connectingWallet}>
                  {connectingWallet ? (
                    <>
                      <span className="spinner-small"></span>
                      Connecting...
                    </>
                  ) : (
                    <>
                      🦊 Connect IIC Wallet
                    </>
                  )}
                </button>
                {walletError && <div className="wallet-error">{walletError}</div>}
              </div>
            ) : walletConnected ? (
              <div className="wallet-connected">
                <div className="wallet-card">
                  <div className="wallet-info">
                    <div className="wallet-label">✅ Connected Wallet</div>
                    <div className="wallet-address">
                      {walletAddress.substring(0, 10)}...{walletAddress.slice(-8)}
                    </div>
                    <div className="wallet-balance">Balance: {parseFloat(walletBalance).toFixed(4)} ETH</div>
                  </div>
                  <button className="btn-disconnect" onClick={disconnectWallet}>✕</button>
                </div>
                
                {userDetails ? (
                  <div className="user-details">
                    <h3>✅ Account Found</h3>
                    <div className="details-grid">
                      <div className="detail-item">
                        <span className="detail-label">Username</span>
                        <span className="detail-value">{userDetails.username}</span>
                      </div>
                      <div className="detail-item">
                        <span className="detail-label">Email</span>
                        <span className="detail-value">{userDetails.email}</span>
                      </div>
                      <div className="detail-item">
                        <span className="detail-label">Balance</span>
                        <span className="detail-value">{parseFloat(userDetails.balance).toFixed(2)} SAYA</span>
                      </div>
                      <div className="detail-item">
                        <span className="detail-label">Rewards</span>
                        <span className="detail-value">{parseFloat(userDetails.reward_amount).toFixed(4)} SAYA</span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="new-user-info">
                    <h3>📝 New User?</h3>
                    <p>Complete verification to set up your mining account</p>
                  </div>
                )}
                
                <button className="btn-proceed" onClick={handleProceedWithVerification}>
                  Proceed to Verification
                </button>
              </div>
            ) : null}

            <div className="hero-input" style={{ display: 'none' }}>
              <input
                type="text"
                placeholder="Enter your wallet (0x...)"
                value={walletAddress}
                onChange={(e) => setWalletAddress(e.target.value)}
                maxLength={42}
              />
              <button className="btn-primary" onClick={handleLaunchClick}>
                Launch REP Node
              </button>
            </div>

            <div className="hero-buttons">
              <button className="btn-primary" onClick={handleLaunchClick}>
                Start Mining
              </button>
              <a
                href="/#setup"
                className="btn-secondary"
                onClick={(e) => { e.preventDefault(); goToDocs('setup'); }}
              >
                Node Setup
              </a>
              <a
                href="/#documentation"
                className="btn-tertiary"
                style={{ position: 'relative' }}
                onClick={(e) => { e.preventDefault(); goToDocs('documentation'); }}
              >
                Documentation
                <span className="badge-new">NEW</span>
              </a>
            </div>
          </div>

          <div className="hero-visual">
            <div className="rocket-illustration">
              <div className="orbit orbit-1">
                <div className="orbit-icon" style={{ background: '#E8EBFF' }}>
                  💎
                </div>
              </div>
              <div className="orbit orbit-2">
                <div className="orbit-icon" style={{ background: '#FFE8E5' }}>
                  ⚡
                </div>
              </div>
              <div className="rocket">🚀</div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="features-section" id="features">
        <div className="features-container">
          <div className="section-header">
            <h2 className="section-title">REP Node Features</h2>
            <p className="section-subtitle">
              Designed for mobile users with priority rewards and seamless integration
            </p>
          </div>

          <div className="features-grid">
            <div className="feature-card">
              <div className="feature-icon">⚡</div>
              <h3>Priority Mining</h3>
              <p>
                10,000x higher priority than other voting nodes, ensuring frequent selection and maximum rewards for mobile users.
              </p>
            </div>

            <div className="feature-card">
              <div className="feature-icon">📱</div>
              <h3>Mobile First</h3>
              <p>
                Connect your wallet directly from mobile app. Submit wallet address and start earning ICC network rewards instantly.
              </p>
            </div>

            <div className="feature-card">
              <div className="feature-icon">💰</div>
              <h3>40% Reward Distribution</h3>
              <p>
                Random mobile users selected every minute receive 40% of REP node rewards automatically.
              </p>
            </div>

            <div className="feature-card">
              <div className="feature-icon">📊</div>
              <h3>Real-time Tracking</h3>
              <p>
                View your weekly reward progress with interactive graphs and claim rewards when balance reaches 100 XCR.
              </p>
            </div>

            <div className="feature-card">
              <div className="feature-icon">🔒</div>
              <h3>Secure Verification</h3>
              <p>
                Multi-layer security with Email OTP, SMS verification, and Knowledge-Based Authentication (KBA).
              </p>
            </div>

            <div className="feature-card">
              <div className="feature-icon">🔗</div>
              <h3>ICC Wallet Compatible</h3>
              <p>
                Connect wallet just like ICC Wallet. Simple wallet ID entry to participate in SAYA coin mining.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Stats Section */}
      <section className="stats-section" id="apis">
        <div className="stats-container">
          <div className="stat-item">
            <div className="stat-value">10,000x</div>
            <div className="stat-label">Priority Boost</div>
          </div>
          <div className="stat-item">
            <div className="stat-value">40%</div>
            <div className="stat-label">Reward Share</div>
          </div>
          <div className="stat-item">
            <div className="stat-value">100 XCR</div>
            <div className="stat-label">Min. Claim Amount</div>
          </div>
          <div className="stat-item">
            <div className="stat-value">V1.0</div>
            <div className="stat-label">March 2025</div>
          </div>
        </div>
      </section>

      {/* DeFi Integrations Section */}
      <section className="defi-section">
        <div className="defi-container">
          <div className="defi-content">
            <h2>DeFi integrations</h2>
            <p>Find the rETH & RPL token on the most reputable & respected names in decentralised finance.</p>
            <button className="btn-defi">Find out more</button>
          </div>
          <div className="defi-logos">
            <div className="logo-card">
              <img src="/iccwallet-fox.svg" alt="ICC Wallet" style={{ width: '64px', height: '64px', objectFit: 'contain' }} />
            </div>
            <div className="logo-card">
              <img src="https://img.icons8.com/color/96/uniswap.png" alt="Uniswap" />
            </div>
            <div className="logo-card">
              <img src="https://cryptologos.cc/logos/shapeshift-fox-token-fox-logo.png" alt="ShapeShift" />
            </div>
            <div className="logo-card">
              <img src="https://img.icons8.com/color/96/ethereum.png" alt="Ethereum" />
            </div>
            <div className="logo-card">
              <img src="https://cryptologos.cc/logos/balancer-bal-logo.png" alt="Balancer" />
            </div>
            <div className="logo-card">
              <img src="https://img.icons8.com/external-tal-revivo-color-tal-revivo/96/external-coinbase-a-digital-currency-exchange-headquartered-in-san-francisco-california-logo-color-tal-revivo.png" alt="Coinbase" />
            </div>
          </div>
        </div>
      </section>

      {/* Charts Section */}
      <section className="charts-section">
        <div className="charts-container">
          <div className="charts-header">
            <h2>📊 Mining Analytics</h2>
            <p>Real-time insights into SAYA mining performance</p>
          </div>
          <div className="charts-grid">
            <div className="chart-card">
              <h3>📈 Weekly Mining Trend</h3>
              <div className="chart-wrapper">
                <Line
                  data={generateHomeCharts().miningTrendData}
                  options={{
                    responsive: true,
                    maintainAspectRatio: true,
                    plugins: {
                      legend: { display: true, labels: { font: { size: 14 }, usePointStyle: true } }
                    },
                    scales: {
                      y: { beginAtZero: true, ticks: { color: '#718096' }, grid: { color: '#e2e8f0' } },
                      x: { ticks: { color: '#718096' }, grid: { color: '#e2e8f0' } }
                    }
                  }}
                />
              </div>
            </div>
            <div className="chart-card">
              <h3>🎯 Platform Distribution</h3>
              <p className="chart-note">REP Node gets 60%. Mobile Nodes get 40%, split equally across 4 mobile nodes.</p>
              <div className="chart-wrapper-doughnut">
                <Doughnut
                  data={generateHomeCharts().statsData}
                  options={{
                    responsive: true,
                    maintainAspectRatio: true,
                    plugins: {
                      legend: { display: true, position: 'bottom', labels: { font: { size: 13 }, usePointStyle: true, padding: 20 } }
                    }
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Community Section */}
      <section className="community-section">
        <div className="community-container">
          <div className="community-content">
            <h2>Join the community today</h2>
            <p>Can't find the answer to a specific question? Join our friendly, wholesome community who can assist you with the answers.</p>
            <button className="btn-discord">Join the Discord</button>
          </div>
          <div className="community-visual">
            <div className="rocket-illustration">
              <div className="rocket-body">🚀</div>
              <div className="rocket-trail"></div>
            </div>
            <div className="chat-bubbles">
              <div className="chat-bubble chat-1">💬</div>
              <div className="chat-bubble chat-2">📊</div>
              <div className="chat-bubble chat-3">🔔</div>
            </div>
            <div className="dashboard-card">
              <div className="dashboard-header"></div>
              <div className="dashboard-body">
                <div className="dash-line"></div>
                <div className="dash-line"></div>
                <div className="dash-line"></div>
              </div>
            </div>
            <div className="member-avatars">
              <div className="avatar">👤</div>
              <div className="avatar">👤</div>
              <div className="avatar">👤</div>
              <div className="avatar">👤</div>
              <div className="avatar">👤</div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="cta-section">
        <div className="cta-container">
          <h2>Ready to Start Mining?</h2>
          <p>Join the ICC Blockchain network and start earning SAYA rewards today</p>
          <button className="btn-cta" onClick={handleLaunchClick}>
            Launch REP Node
          </button>
        </div>
      </section>
    </>
  );

  const renderDocs = () => (
    <>
      {/* Documentation Hero */}
      <section className="docs-hero">
        <div className="docs-hero-container">
          <div className="docs-hero-content">
            <h1 className="docs-hero-title">IIC REP Node</h1>
            <h2 className="docs-hero-subtitle">Guides & Documentation</h2>
            <p className="docs-hero-description">Decentralised ICC Liquid Staking Protocol</p>
            <div className="docs-hero-buttons">
              <button className="btn-get-started" onClick={() => goToSection('setup')}>Get Started →</button>
              <button className="btn-contribute" onClick={() => goToSection('apis')}>View APIs</button>
            </div>
          </div>
          <div className="docs-hero-icon">
            <div className="rocket-circle">
              <svg className="rocket-svg" viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle cx="100" cy="100" r="95" fill="#ff6b35" opacity="0.1"/>
                <circle cx="100" cy="100" r="80" fill="#ff6b35" opacity="0.2"/>
                <g transform="translate(60, 40)">
                  <path d="M40 10 L50 30 L30 30 Z" fill="white"/>
                  <rect x="35" y="30" width="10" height="40" rx="2" fill="white"/>
                  <ellipse cx="40" cy="75" rx="8" ry="4" fill="white"/>
                  <path d="M30 40 L25 50 L30 45 Z" fill="white" opacity="0.8"/>
                  <path d="M50 40 L55 50 L50 45 Z" fill="white" opacity="0.8"/>
                  <circle cx="40" cy="50" r="3" fill="#ff6b35"/>
                  <path d="M38 80 Q40 90 42 80" stroke="white" strokeWidth="3" fill="none" opacity="0.6"/>
                </g>
              </svg>
            </div>
          </div>
        </div>
      </section>

      {/* Documentation Cards Section */}
      <section className="docs-cards-section">
        <div className="docs-cards-container">
          <div className="docs-card-large">
            <h3>Overview</h3>
            <p>Learn all about what IIC REP Node is, how it works, and how to use it with an easy-to-read series of articles.</p>
            <div className="docs-card-details">
              <div className="detail-item">
                <strong>Abstract:</strong> The IIC Blockchain runs three node types (J-Nodes, DACS Nodes, Voting Nodes). The REP Node is the voting node representing mobile users so they can mine SAYA coin rewards.
              </div>
              <div className="detail-item">
                <strong>Priority Boost:</strong> REP server priority increased by 10,000x to maximize election frequency and rewards for mobile users.
              </div>
              <div className="detail-item">
                <strong>Reward Distribution:</strong> JavaScript service selects random mobile users every minute and distributes 40% of REP rewards.
              </div>
            </div>
          </div>

          <div className="docs-card-large">
            <h3>Guides</h3>
            <p>Follow our detailed walkthroughs to practice using ICC REP Node on the mainnet, from connecting wallet to claiming rewards.</p>
            <div className="docs-card-details">
              <div className="detail-item">
                <strong>Wallet Connection:</strong> Mobile users connect by entering their wallet ID (ICC Wallet-style). Connection is required to receive SAYA mining rewards.
              </div>
              <div className="detail-item">
                <strong>Accumulation & Claim:</strong> Rewards accrue; claim button appears at ≥ 100 XCR to transfer to wallet.
              </div>
              <div className="detail-item">
                <strong>Reward Graph:</strong> Weekly reward progress shown as a graph for clear earnings insight.
              </div>
              <div className="detail-item">
                <strong>KBA Security:</strong> Multi-layer verification with Email OTP, SMS, and Knowledge-Based Authentication.
              </div>
            </div>
          </div>

          <div className="docs-card-large">
            <h3>Run a node</h3>
            <p>Get started running a node with our detailed walkthroughs. Learn how to secure, maintain, monitor and upgrade your node.</p>
            <div className="docs-card-details">
              <div className="detail-item">
                <strong>Blockchain:</strong> Golang-based ICC chain for consensus and transactions.
              </div>
              <div className="detail-item">
                <strong>Reward Engine:</strong> JavaScript ("Red Pool" REP node distribution logic).
              </div>
              <div className="detail-item">
                <strong>Database:</strong> MySQL for user selection and reward storage.
              </div>
              <div className="detail-item">
                <strong>Setup:</strong> 5-step configuration process from download to running the reward script.
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* API Reference */}
      <section className="api-section" id="apis">
        <div className="doc-container">
          <div className="section-header">
            <h2 className="section-title">REP Node APIs</h2>
            <p className="section-subtitle">Endpoints for mobile app integration</p>
          </div>

          <div className="api-grid">
            <div className="api-card">
              <h4>Register User</h4>
              <code>http://13.216.201.2/register_user.php?address=&lt;wallet&gt;</code>
              <ul>
                <li>Registers new mobile user if not present.</li>
                <li>If exists, returns wallet balance and rewards.</li>
              </ul>
            </div>

            <div className="api-card">
              <h4>Unregister User</h4>
              <code>http://13.216.201.2/unregister_user.php?action=unregister&address=&lt;wallet&gt;</code>
              <ul>
                <li>Removes user; if missing, returns an error.</li>
                <li>On success, rewards are auto-claimed.</li>
              </ul>
            </div>

            <div className="api-card">
              <h4>Reward Graph</h4>
              <code>http://13.216.201.2/reward_graph.php?address=&lt;wallet&gt;</code>
              <ul>
                <li>Returns daily rewards for the current week.</li>
                <li>Lets users visualize ongoing mining performance.</li>
              </ul>
            </div>

            <div className="api-card">
              <h4>Claim Reward</h4>
              <code>http://13.216.201.2/claim_reward.php?address=&lt;wallet&gt;&action=claim_reward</code>
              <ul>
                <li>Creates on-chain transfer from REP node wallet.</li>
                <li>If no rewards are available, request is rejected.</li>
              </ul>
            </div>

            <div className="api-card">
              <h4>Get KBA Question</h4>
              <code>POST http://your-api-server/router.php?action=get-kba-question</code>
              <ul>
                <li><strong>Step 1:</strong> Connect wallet (provides address)</li>
                <li><strong>Step 2:</strong> Returns a random security question from user's KBA profile</li>
                <li>Questions include: place of birth, first school, favorite color, mother's maiden name, first pet name, childhood friend</li>
                <li><strong>Payload:</strong> <code>{`{ "address": "<wallet>" }`}</code></li>
                <li><strong>Response:</strong> <code>{`{ "success": true, "question": { "type": "placeOfBirth", "text": "What is your place of birth?" } }`}</code></li>
              </ul>
            </div>

            <div className="api-card">
              <h4>Verify KBA for Transaction</h4>
              <code>POST http://your-api-server/router.php?action=verify-kba-transaction</code>
              <ul>
                <li><strong>Step 3:</strong> User confirms by answering the security question</li>
                <li>Validates answer against hashed KBA data stored during registration</li>
                <li>Transaction proceeds only if answer is correct (case-insensitive)</li>
                <li><strong>Payload:</strong> <code>{`{ "address": "<wallet>", "questionType": "placeOfBirth", "answer": "<user_answer>" }`}</code></li>
                <li><strong>Response:</strong> <code>{`{ "success": true, "message": "KBA verification successful - Transaction allowed" }`}</code></li>
                <li><strong>Security:</strong> Failed attempts are logged for monitoring</li>
              </ul>
            </div>

            <div className="api-card">
              <h4>Send OTPs with KBA Registration</h4>
              <code>POST http://your-api-server/router.php?action=send-otpss</code>
              <ul>
                <li><strong>New User Setup:</strong> Sends email & SMS OTPs after validating KBA fields</li>
                <li>Requires all 6 security questions to be answered</li>
                <li><strong>Payload:</strong> <code>{`{ "email": "<email>", "phone": "<phone>", "placeOfBirth": "...", "firstSchool": "...", "favoriteColor": "...", "motherMaidenName": "...", "firstPetName": "...", "childhoodFriend": "..." }`}</code></li>
                <li><strong>Response:</strong> <code>{`{ "success": true, "emailOtp": "123456", "phoneOtp": "654321" }`}</code></li>
              </ul>
            </div>

            <div className="api-card">
              <h4>Complete Registration with KBA</h4>
              <code>POST http://your-api-server/router.php?action=verify-otpss</code>
              <ul>
                <li><strong>Final Step:</strong> Verifies OTPs and registers user with hashed KBA data</li>
                <li>All security answers are hashed using bcrypt before storage</li>
                <li><strong>Payload:</strong> <code>{`{ "emailOtp": "123456", "phoneOtp": "654321", "username": "...", "address": "<wallet>", "email": "...", "number": "...", "placeOfBirth": "...", "firstSchool": "...", "favoriteColor": "...", "motherMaidenName": "...", "firstPetName": "...", "childhoodFriend": "..." }`}</code></li>
                <li><strong>Response:</strong> <code>{`{ "success": true, "message": "User Registered Successfully with KBA", "balance": 0, "reward_amount": 0 }`}</code></li>
              </ul>
            </div>
          </div>

          <div className="kba-flow-section">
            <h3>🔐 KBA Transaction Flow</h3>
            <div className="flow-steps">
              <div className="flow-step">
                <div className="step-number">1</div>
                <h4>Connect Wallet</h4>
                <p>User connects ICC Wallet or enters wallet address</p>
              </div>
              <div className="flow-arrow">→</div>
              <div className="flow-step">
                <div className="step-number">2</div>
                <h4>Get Random Question</h4>
                <p>System retrieves a random security question from user's KBA profile</p>
              </div>
              <div className="flow-arrow">→</div>
              <div className="flow-step">
                <div className="step-number">3</div>
                <h4>Answer & Confirm</h4>
                <p>User answers question; transaction proceeds if correct</p>
              </div>
            </div>
            <p className="flow-note">
              <strong>Security Note:</strong> All KBA answers are hashed during registration using bcrypt. 
              Verification is case-insensitive and trimmed for user convenience while maintaining security.
            </p>
          </div>
        </div>
      </section>

      {/* Setup Section */}
      <section className="setup-section" id="setup">
        <div className="doc-container">
          <div className="section-header">
            <h2 className="section-title">REP Node Setup</h2>
            <p className="section-subtitle">Step-by-step configuration roadmap to run the ICC REP Node</p>
          </div>

          <div className="setup-roadmap">
            <div className="roadmap-path">
              <svg className="roadmap-line" viewBox="0 0 1200 200" preserveAspectRatio="none">
                <path d="M 50 100 Q 200 50, 300 100 T 500 100 Q 650 150, 800 100 T 1100 100" 
                      stroke="#ff6b35" strokeWidth="4" fill="none" strokeDasharray="10,5"/>
              </svg>
            </div>

            <div className="setup-steps">
              <div className="setup-step">
                <div className="step-circle">
                  <span className="step-num">1</span>
                </div>
                <div className="step-content">
                  <h4>Download & Install</h4>
                  <p>Get the updated code from the official GitHub repository.</p>
                  <div className="step-details">
                    <code>git clone https://github.com/ICC-Blockchain/rep-node</code>
                  </div>
                </div>
              </div>

              <div className="setup-step">
                <div className="step-circle">
                  <span className="step-num">2</span>
                </div>
                <div className="step-content">
                  <h4>Build Executables</h4>
                  <p>Inside the code folder run <code className="inline-code">make all</code> to produce binaries.</p>
                  <div className="step-details">
                    <code>make all</code>
                  </div>
                </div>
              </div>

              <div className="setup-step">
                <div className="step-circle">
                  <span className="step-num">3</span>
                </div>
                <div className="step-content">
                  <h4>Prepare Node Folder</h4>
                  <p>Create a folder for the REP node; copy the executables and config files into it.</p>
                  <div className="step-details">
                    <code>mkdir rep-node</code>
                    <code>cp crossvalue genesis.json rep-node/</code>
                  </div>
                </div>
              </div>

              <div className="setup-step">
                <div className="step-circle">
                  <span className="step-num">4</span>
                </div>
                <div className="step-content">
                  <h4>Start REP Node</h4>
                  <p>Run the crossvalue node with network configuration and HTTP API enabled.</p>
                  <div className="step-details">
                    <code>./crossvalue --networkid 1133 --datadir "./data"</code>
                    <code>--bootnodes &lt;enodeIDs&gt; --port 30306</code>
                    <code>--nat extip:&lt;RepNodeIP&gt; --ipcdisable --syncmode full</code>
                    <code>--http --http.api "eth,net,web3,admin,personal"</code>
                    <code>--http.addr 0.0.0.0 --authrpc.port 8555 --http.port 8545</code>
                    <code>--http.vhosts="*" --http.corsdomain "*"</code>
                    <code>--allow-insecure-unlock --unlock &lt;repnodeaddress&gt;</code>
                    <code>--password password console --identity rep-node&lt;repnodeaddress&gt;</code>
                  </div>
                </div>
              </div>

              <div className="setup-step">
                <div className="step-circle">
                  <span className="step-num">5</span>
                </div>
                <div className="step-content">
                  <h4>Start Reward Script</h4>
                  <p>Execute <code className="inline-code">repnodereward.js</code> to distribute rewards to mobile users.</p>
                  <div className="step-details">
                    <code>node repnodereward.js</code>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );

  const renderRewards = () => (
    <>
      {/* Rewards Hero */}
      <section className="rewards-hero">
        <div className="rewards-container">
          {/* My Reward Card (shown after verification) */}
          {walletAddress && (
            <div className="my-reward-card" style={{marginBottom: '24px'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <h3 style={{margin:0}}>My Reward</h3>
                <div style={{fontFamily:'monospace',color:'#ff6b35'}}>
                  {walletAddress.substring(0,10)}...{walletAddress.slice(-8)}
                </div>
              </div>
              {myReward ? (
                <div className="my-reward-grid" style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:'12px',marginTop:'12px'}}>
                  <div className="my-reward-item"><div className="label">Username</div><div className="value">{myReward.username || '-'}</div></div>
                  <div className="my-reward-item"><div className="label">Email</div><div className="value">{myReward.email || '-'}</div></div>
                  <div className="my-reward-item"><div className="label">Balance</div><div className="value">{parseFloat(myReward.balance||0).toFixed(2)} SAYA</div></div>
                  <div className="my-reward-item"><div className="label">Reward</div><div className="value">⭐ {parseFloat(myReward.rewardAmount||0).toFixed(4)} SAYA</div></div>
                </div>
              ) : (
                <div style={{marginTop:'12px',color:'#718096'}}>No reward data found for this address yet.</div>
              )}
            </div>
          )}
          <div className="staking-card">
            <div className="staking-visual">
              <div className="node-illustration">
                <div className="node-stack">
                  <div className="launch-screen">LAUNCH 🚀</div>
                  <div className="hardware-stack">
                    <div className="hw-layer"></div>
                    <div className="hw-layer"></div>
                    <div className="hw-layer active"></div>
                  </div>
                  <div className="coin-stack">💰</div>
                </div>
                <div className="rocket-launch">🚀</div>
                <div className="spark spark-1">+</div>
                <div className="spark spark-2">+</div>
                <div className="spark spark-3">+</div>
              </div>
            </div>
            <div className="staking-info">
              <h2>REP Server Node Mobile Mining</h2>
              <p className="staking-desc">Mine SAYA rewards through ICC REP node</p>
              <div className="apr-display">
                <span className="apr-symbol">≈</span>
                <span className="apr-value">{Number(miningStats.apr || 0).toFixed(1)}</span>
                <span className="apr-percent">%</span>
                <span className="apr-label">APR</span>
              </div>
              <p className="apr-note">based on 7 day average</p>
              <p className="apr-note">+ REP rewards</p>
              <button className="btn-find-more" onClick={handleLaunchClick}>
                Find out more
              </button>
            </div>
          </div>

          <div className="stats-banner">
            <div className="stat-big">
              <div className="stat-big-value">{miningStats.totalRewards.toLocaleString('en-US', { maximumFractionDigits: 0 })}</div>
              <div className="stat-big-label">Mining Rewards</div>
            </div>
            <div className="stat-big">
              <div className="stat-big-value">{miningStats.totalMiners.toLocaleString()}</div>
              <div className="stat-big-label">Node Operators</div>
            </div>
            <div className="stat-big">
              <div className="stat-big-value">{miningStats.totalRegions} +</div>
              <div className="stat-big-label">Regions</div>
            </div>
          </div>
        </div>
      </section>

      {/* Rewards Info Section */}
      <section className="rewards-info-section">
        <div className="rewards-info-container">
          <div className="info-header">
            <h2>Earn Rewards by Mining</h2>
            <p>Run an ICC REP Node and earn SAYA rewards while securing the network</p>
          </div>

          <div className="rewards-grid">
            <div className="reward-info-card">
              <div className="reward-icon">⚡</div>
              <h3>Priority Rewards</h3>
              <p>10,000x higher priority for reward selection compared to standard voting nodes</p>
            </div>
            <div className="reward-info-card">
              <div className="reward-icon">💰</div>
              <h3>40% Distribution</h3>
              <p>Mobile users selected every minute receive 40% of REP node rewards automatically</p>
            </div>
            <div className="reward-info-card">
              <div className="reward-icon">📊</div>
              <h3>Track Progress</h3>
              <p>View your weekly reward accumulation with interactive graphs and analytics</p>
            </div>
            <div className="reward-info-card">
              <div className="reward-icon">🎯</div>
              <h3>Claim Anytime</h3>
              <p>Claim your accumulated rewards once your balance reaches 100 XCR minimum</p>
            </div>
          </div>

          <div className="cta-rewards">
            <button className="btn-start-staking" onClick={handleLaunchClick}>
              Start Mining Now
            </button>
          </div>
        </div>
      </section>
    </>
  );

  const renderAllRewards = () => {
    const pageSize = 10;
    const totalPages = Math.max(1, Math.ceil(allRewards.length / pageSize));
    const safePage = Math.min(allRewardsPage, totalPages);
    const startIndex = (safePage - 1) * pageSize;
    const pagedRewards = allRewards.slice(startIndex, startIndex + pageSize);

    const goToPage = (page) => {
      setAllRewardsPage(Math.min(Math.max(page, 1), totalPages));
    };

    return (
    <>
      {/* All Rewards Hero */}
      <section className="all-rewards-hero">
        <div className="all-rewards-container">
          <div className="rewards-header">
            <h1>💰 All Mining Rewards</h1>
            <p>View all rewards earned by REP Node miners on ICC Blockchain</p>
            <div className="rewards-stats">
              <div className="reward-stat">
                <div className="stat-value">{allRewardsTotalMiners || allRewards.length}</div>
                <div className="stat-label">Total Miners</div>
              </div>
              <div className="reward-stat">
                <div className="stat-value">
                  {allRewards.reduce((sum, r) => sum + r.rewardAmount, 0).toFixed(2)}
                </div>
                <div className="stat-label">Total Rewards (SAYA)</div>
              </div>
              <div className="reward-stat">
                <div className="stat-value">
                  {allRewards.length > 0 ? (allRewards.reduce((sum, r) => sum + r.rewardAmount, 0) / allRewards.length).toFixed(2) : '0.00'}
                </div>
                <div className="stat-label">Average Reward</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Rewards Table */}
      <section className="all-rewards-section">
        <div className="all-rewards-inner">
          {loadingRewards ? (
            <div className="loading-spinner">
              <div className="spinner"></div>
              <p>Loading rewards...</p>
            </div>
          ) : allRewards.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">📭</div>
              <h2>No Rewards Yet</h2>
              <p>Start mining to earn rewards</p>
              <button className="btn-start" onClick={handleLaunchClick}>Launch REP Node</button>
            </div>
          ) : (
            <>
              <div className="rewards-table-wrapper">
                <table className="rewards-table">
                  <thead>
                    <tr>
                      <th>Rank</th>
                      <th>Address</th>
                 
                      <th>Balance (SAYA)</th>
                      <th>Reward Amount (SAYA)</th>
                      <th>Joined</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedRewards.map((reward, index) => (
                      <tr key={reward.address} className="reward-row">
                        <td className="rank-badge" data-label="Rank">
                          {startIndex + index === 0 ? '🥇' : startIndex + index === 1 ? '🥈' : startIndex + index === 2 ? '🥉' : startIndex + index + 1}
                        </td>
                        <td className="address-cell" data-label="Address">
                          <span className="address">{reward.address.substring(0, 10)}...{reward.address.slice(-8)}</span>
                        </td>
                    
                        <td className="balance-cell" data-label="Balance (SAYA)">
                          <span className="balance-value">{parseFloat(reward.balance).toFixed(2)}</span>
                        </td>
                        <td className="reward-cell" data-label="Reward Amount (SAYA)">
                          <span className="reward-value">⭐ {parseFloat(reward.rewardAmount).toFixed(4)}</span>
                        </td>
                        <td className="date-cell" data-label="Joined">
                          {new Date(reward.createdAt).toLocaleDateString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="rewards-footer">
                <p>Showing {allRewards.length === 0 ? 0 : startIndex + 1}–{Math.min(startIndex + pageSize, allRewards.length)} of {allRewards.length}</p>
                <div className="rewards-pagination">
                  <button className="rewards-page-btn" onClick={() => goToPage(1)} disabled={safePage === 1}>⏮ First</button>
                  <button className="rewards-page-btn" onClick={() => goToPage(safePage - 1)} disabled={safePage === 1}>◀ Prev</button>
                  <span className="rewards-page-current">Page {safePage} of {totalPages}</span>
                  <button className="rewards-page-btn" onClick={() => goToPage(safePage + 1)} disabled={safePage === totalPages}>Next ▶</button>
                  <button className="rewards-page-btn" onClick={() => goToPage(totalPages)} disabled={safePage === totalPages}>Last ⏭</button>
                </div>
                <button className="btn-refresh" onClick={goToAllRewards}>Refresh</button>
              </div>
            </>
          )}
        </div>
      </section>

      {/* Charts Section for All Rewards */}
      {!loadingRewards && allRewards.length > 0 && (
        <section className="all-rewards-charts-section">
          <div className="all-rewards-charts-container">
            <div className="charts-header">
              <h2>📊 Rewards Analytics</h2>
              <p>Detailed breakdown of mining rewards across the network</p>
            </div>
            <div className="rewards-charts-grid">
              <div className="chart-card">
                <h3>🏆 Top 10 Miners</h3>
                <div className="chart-wrapper">
                  <Bar
                    data={generateAllRewardsCharts().topMinersData}
                    options={{
                      indexAxis: 'y',
                      responsive: true,
                      maintainAspectRatio: true,
                      animation: {
                        duration: 1400,
                        easing: 'easeOutCubic',
                        delay: (context) => context.dataIndex * 80
                      },
                      plugins: {
                        legend: { display: false },
                        tooltip: { backgroundColor: 'rgba(26,58,82,0.95)', padding: 12, titleFont: { size: 13, weight: '600' }, bodyFont: { size: 12 }, cornerRadius: 10, displayColors: false }
                      },
                      scales: {
                        x: { beginAtZero: true, ticks: { color: '#718096', font: { size: 11 } }, grid: { color: '#edf2f7', drawBorder: false } },
                        y: { ticks: { color: '#1a3a52', font: { size: 12, weight: '700' } }, grid: { display: false } }
                      }
                    }}
                  />
                </div>
              </div>
              <div className="chart-card">
                <h3>📈 Reward Distribution</h3>
                <div className="chart-wrapper-doughnut">
                  <Pie
                    data={generateAllRewardsCharts().distributionData}
                    options={{
                      responsive: true,
                      maintainAspectRatio: true,
                      animation: {
                        duration: 1200,
                        easing: 'easeOutCubic'
                      },
                      plugins: {
                        legend: { display: true, position: 'bottom', labels: { font: { size: 12, weight: '600' }, usePointStyle: true, padding: 16, boxPadding: 8 } },
                        tooltip: {
                          backgroundColor: 'rgba(26,58,82,0.95)',
                          padding: 12,
                          titleFont: { size: 13, weight: '600' },
                          bodyFont: { size: 12 },
                          cornerRadius: 10,
                          displayColors: false,
                          callbacks: {
                            label: (context) => `${context.label}: ${context.parsed} miners`
                          }
                        }
                      }
                    }}
                  />
                </div>
              </div>
              <div className="chart-card">
                <h3>💹 Average Reward</h3>
                <div className="chart-wrapper-doughnut">
                  <Doughnut
                    data={generateAllRewardsCharts().avgRewardData}
                    options={{
                      responsive: true,
                      maintainAspectRatio: true,
                      plugins: {
                        legend: { display: true, position: 'bottom', labels: { font: { size: 13, weight: '600' }, usePointStyle: true, padding: 20 } },
                        tooltip: { backgroundColor: 'rgba(0,0,0,0.8)', padding: 12, titleFont: { size: 14, weight: '600' }, bodyFont: { size: 13 }, cornerRadius: 8 }
                      }
                    }}
                  />
                </div>
              </div>
              <div className="chart-card">
                <h3>📊 Miners Growth</h3>
                <div className="chart-wrapper">
                  <Line
                    data={generateAllRewardsCharts().minersGrowth}
                    options={{
                      responsive: true,
                      maintainAspectRatio: true,
                      plugins: {
                        legend: { display: true, labels: { font: { size: 13, weight: '600' }, boxPadding: 15 } },
                        tooltip: { backgroundColor: 'rgba(0,0,0,0.8)', padding: 12, titleFont: { size: 14, weight: '600' }, bodyFont: { size: 13 }, cornerRadius: 8, mode: 'index', intersect: false }
                      },
                      scales: {
                        x: { ticks: { color: '#718096', font: { size: 12 } }, grid: { color: '#e2e8f0', drawBorder: false } },
                        y: { beginAtZero: true, ticks: { color: '#718096', font: { size: 12 } }, grid: { color: '#e2e8f0', drawBorder: false } }
                      }
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
        </section>
      )}
    </>
    );
  };

  const handleClaimReward = async () => {
    if (!walletAddress) return;
    if (!myReward || parseFloat(myReward.rewardAmount || 0) < 100) {
      setClaimMessage('❌ Reward must be at least 100 SAYA to claim.');
      return;
    }
    setClaiming(true);
    setClaimMessage('');
    setClaimTxHash('');
    try {
      const response = await fetch(apiUrl('claim_reward'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: walletAddress })
      });
      const data = await response.json();
      if (data.success) {
        let msg = `✅ Reward claimed successfully!`;
        if (data.claimed_amount) {
          msg += `\nClaimed: ${data.claimed_amount} SAYA`;
        }
        if (data.transactionHash) {
          setClaimTxHash(data.transactionHash);
          msg += `\nTransaction: ${data.transactionHash}`;
        }
        setClaimMessage(msg);
        fetch(apiUrl('get-user-rewards'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ address: walletAddress })
        })
          .then(res => res.json())
          .then(json => {
            if (json.success) setMyReward(json.reward);
          })
          .catch(() => {});
        if (typeof goToMyReward === 'function') goToMyReward();
      } else {
        let msg = data.message || '❌ Failed to claim reward.';
        if (data.error) {
          msg += `\nError: ${data.error}`;
        }
        if (data.details) {
          msg += `\nDetails: ${data.details}`;
        }
        if (data.claimed_amount) {
          msg += `\nTried to claim: ${data.claimed_amount} SAYA`;
        }
        setClaimMessage(msg);
      }
    } catch (error) {
      setClaimMessage('❌ Error claiming reward.\n' + error.message);
    }
    setClaiming(false);
  };

  const renderMyReward = () => {
    const reward = myReward;
    const totalReward = reward ? parseFloat(reward.rewardAmount || 0) : 0;
    const balanceSaya = reward ? parseFloat(reward.balance || 0) : 0;

    // Generate period-based data
    const generatePeriodData = (period) => {
      let labels = [];
      let dataPoints = [];
      const today = new Date();
      
      if (period === 'weekly') {
        labels = Array.from({ length: 7 }, (_, i) => {
          const d = new Date(today);
          d.setDate(today.getDate() - (6 - i));
          return `${d.getMonth() + 1}/${d.getDate()}`;
        });
        const weights = [0.08, 0.1, 0.12, 0.15, 0.18, 0.2, 0.17];
        dataPoints = weights.map(w => +(totalReward * w).toFixed(4));
      } else if (period === 'monthly') {
        labels = Array.from({ length: 30 }, (_, i) => {
          const d = new Date(today);
          d.setDate(today.getDate() - (29 - i));
          return i % 5 === 0 ? `${d.getMonth() + 1}/${d.getDate()}` : '';
        });
        dataPoints = Array.from({ length: 30 }, (_, i) => +(totalReward * (0.02 + Math.random() * 0.03)).toFixed(4));
      } else {
        labels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        dataPoints = Array.from({ length: 12 }, (_, i) => +(totalReward * (0.05 + Math.random() * 0.1)).toFixed(4));
      }
      
      return { labels, dataPoints };
    };

    const { labels, dataPoints } = generatePeriodData(rewardPeriod);
    const cumulative = dataPoints.reduce((acc, v, i) => {
      const prev = i === 0 ? 0 : acc[i - 1];
      acc.push(+(prev + v).toFixed(4));
      return acc;
    }, []);

    const myTrendData = {
      labels,
      datasets: [
        {
          label: 'Cumulative Rewards (SAYA)',
          data: cumulative,
          fill: false,
          borderColor: '#1a3a52',
          backgroundColor: 'rgba(26, 58, 82, 0.2)',
          tension: 0.35,
          pointRadius: rewardPeriod === 'yearly' ? 4 : rewardPeriod === 'monthly' ? 2 : 3,
        }
      ]
    };

    const mySplitData = {
      labels: ['Reward', 'Balance'],
      datasets: [
        {
          data: [totalReward, balanceSaya],
          backgroundColor: ['#d4a574', '#9dbad3'],
          borderColor: 'white',
          borderWidth: 2
        }
      ]
    };

    return (
      <>
        {/* My Reward Hero Banner */}
        <section className="all-rewards-hero">
          <div className="all-rewards-container">
            <div className="rewards-header">
              <h1>💎 My Reward</h1>
              <p>Your wallet details and earnings overview</p>
              <div className="rewards-stats">
                <div className="reward-stat">
                  <div className="stat-value">{reward?.username || 'User'}</div>
                  <div className="stat-label">Username</div>
                </div>
                <div className="reward-stat">
                  <div className="stat-value">{balanceSaya.toFixed(2)}</div>
                  <div className="stat-label">Balance (SAYA)</div>
                </div>
                <div className="reward-stat">
                  <div className="stat-value">{totalReward.toFixed(2)}</div>
                  <div className="stat-label">Reward (SAYA)</div>
                </div>
              </div>
              {/* Claim Reward Button */}
              {walletAddress && totalReward >= 100 && (
                <div style={{ marginTop: '18px' }}>
                  <button className="btn-claim-reward" onClick={handleClaimReward} disabled={claiming} style={{ padding: '10px 24px', fontSize: '16px', background: '#ff6b35', color: 'white', border: 'none', borderRadius: '8px', cursor: claiming ? 'not-allowed' : 'pointer' }}>
                    {claiming ? 'Claiming...' : 'Claim Reward'}
                  </button>
                  {claimMessage && (
                    <div style={{ marginTop: '10px', color: claimMessage.startsWith('✅') ? 'green' : 'red', fontWeight: 600, whiteSpace: 'pre-line' }}>
                      {claimMessage}
                    </div>
                  )}
                  {claimTxHash && (
                    <div style={{ marginTop: '8px', fontSize: '13px', color: '#2d3748' }}>
                      Tx: <span style={{ fontFamily: 'monospace' }}>{claimTxHash}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Wallet Info Cards */}
        <section style={{ padding: '60px 48px', background: '#f7fafc' }}>
          <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
            {walletAddress && (
              <div style={{ marginBottom: '32px', padding: '20px 28px', background: 'white', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)', display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span style={{ fontSize: '14px', fontWeight: '600', color: '#718096' }}>Wallet Address:</span>
                <span style={{ fontSize: '14px', fontFamily: 'monospace', color: '#2d3748', background: '#edf2f7', padding: '8px 16px', borderRadius: '8px' }}>
                  {walletAddress.substring(0, 10)}...{walletAddress.slice(-8)}
                </span>
              </div>
            )}

            <div className="my-reward-grid">
              <div className="info-card">
                <div className="label">Email</div>
                <div className="value" style={{ fontSize: '15px' }}>{reward?.email || '-'}</div>
              </div>
              <div className="info-card">
                <div className="label">Balance (SAYA)</div>
                <div className="value">{balanceSaya.toFixed(4)}</div>
              </div>
              <div className="info-card">
                <div className="label">Total Reward (SAYA)</div>
                <div className="value">{totalReward.toFixed(4)}</div>
              </div>
              <div className="info-card">
                <div className="label">Registered</div>
                <div className="value" style={{ fontSize: '14px' }}>{reward?.createdAt ? new Date(reward.createdAt).toLocaleDateString() : '-'}</div>
              </div>
              <div className="info-card">
                <div className="label">Last Claim</div>
                <div className="value" style={{ fontSize: '14px' }}>
                  {reward?.lastClaimAmount ? `${parseFloat(reward.lastClaimAmount).toFixed(4)} SAYA` : '-'}
                </div>
              </div>
              <div className="info-card">
                <div className="label">Last Claim Date</div>
                <div className="value" style={{ fontSize: '14px' }}>
                  {reward?.lastClaimAt ? new Date(reward.lastClaimAt).toLocaleString() : '-'}
                </div>
              </div>
            </div>

            {/* Period Filter */}
            <div className="period-filter">
              <button 
                className={`period-btn ${rewardPeriod === 'weekly' ? 'active' : ''}`}
                onClick={() => setRewardPeriod('weekly')}
              >
                Weekly
              </button>
              <button 
                className={`period-btn ${rewardPeriod === 'monthly' ? 'active' : ''}`}
                onClick={() => setRewardPeriod('monthly')}
              >
                Monthly
              </button>
              <button 
                className={`period-btn ${rewardPeriod === 'yearly' ? 'active' : ''}`}
                onClick={() => setRewardPeriod('yearly')}
              >
                Yearly
              </button>
            </div>

            <div className="my-reward-charts">
              <div className="chart-card">
                <h3>{rewardPeriod === 'weekly' ? '7-Day' : rewardPeriod === 'monthly' ? '30-Day' : '12-Month'} Reward Trend</h3>
                <div className="chart-wrapper">
                  <Line data={myTrendData} options={{ responsive: true, maintainAspectRatio: true, plugins: { legend: { display: true, labels: { font: { size: 13 } } } }, scales: { x: { grid: { color: '#edf2f7' }, ticks: { maxRotation: 45, minRotation: 0 } }, y: { beginAtZero: true, grid: { color: '#edf2f7' } } } }} />
                </div>
              </div>
              <div className="chart-card">
                <h3>Reward vs Balance</h3>
                <div className="chart-wrapper-doughnut">
                  <Doughnut data={mySplitData} options={{ responsive: true, maintainAspectRatio: true, plugins: { legend: { position: 'bottom', labels: { font: { size: 13 }, padding: 15 } } } }} />
                </div>
              </div>
            </div>

            {/* Transaction History Table */}
            <div className="transaction-history">
              <div className="history-header">
                <h3>📋 Transaction History</h3>
                <p>Recent {rewardPeriod} mining rewards</p>
              </div>
              <div className="history-table-wrapper">
                <table className="history-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Date</th>
                      <th>Type</th>
                      <th>Amount (SAYA)</th>
                      <th>Status</th>
                      <th>Transaction Hash</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loadingTransactions ? (
                      <tr>
                        <td colSpan="6" style={{ textAlign: 'center', padding: '30px' }}>
                          <div style={{ fontSize: '16px', color: '#666' }}>⏳ Loading transactions...</div>
                        </td>
                      </tr>
                    ) : transactions.length === 0 ? (
                      <tr>
                        <td colSpan="6" style={{ textAlign: 'center', padding: '30px' }}>
                          <div style={{ fontSize: '16px', color: '#666' }}>No transactions found for this period</div>
                        </td>
                      </tr>
                    ) : (
                      transactions.slice(0, rewardPeriod === 'weekly' ? 7 : rewardPeriod === 'monthly' ? 15 : 12).map((tx) => (
                        <tr key={tx.id}>
                          <td className="tx-id">{tx.id}</td>
                          <td className="tx-date">{tx.date}</td>
                          <td className="tx-type">
                            <span className="type-badge">⛏️ {tx.type}</span>
                          </td>
                          <td className="tx-amount">
                            <span className="amount-value">+{tx.amount.toFixed(4)}</span>
                          </td>
                          <td className="tx-status">
                            <span className="status-badge status-completed">✓ {tx.status}</span>
                          </td>
                          <td className="tx-hash">
                            <span style={{ fontFamily: 'monospace', fontSize: '12px', color: '#666' }}>
                              {tx.txHash ? `${tx.txHash.substring(0, 10)}...${tx.txHash.slice(-8)}` : '-'}
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              <div className="history-summary">
                <div className="summary-item">
                  <span className="summary-label">Total Transactions:</span>
                  <span className="summary-value">{transactions.length}</span>
                </div>
                <div className="summary-item">
                  <span className="summary-label">Total Earned:</span>
                  <span className="summary-value">{transactions.reduce((sum, tx) => sum + tx.amount, 0).toFixed(4)} SAYA</span>
                </div>
              </div>
            </div>
          </div>
        </section>
      </>
    );
  };

  return (
    <div className="app">
      {/* Wallet Confirmation Modal */}
      {pendingWalletAddress && !walletConnected && (
        <div className="modal-overlay" onClick={cancelWalletConnection}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="confirmation-card">
              <div className="confirmation-header">
                <h3>🔐 Confirm Your Wallet</h3>
                <p>Please verify this is your wallet address</p>
              </div>
              
              <div className="wallet-address-display">
                <div className="address-label">Wallet Address</div>
                <div className="address-full">{pendingWalletAddress}</div>
                <div className="address-short">({pendingWalletAddress.substring(0, 10)}...{pendingWalletAddress.slice(-8)})</div>
              </div>

              <div className="wallet-balance-display">
                <div className="balance-label">Balance</div>
                <div className="balance-value">{parseFloat(walletBalance).toFixed(4)} ETH</div>
              </div>

              {userDetails && (
                <div className="account-status">
                  <div className="status-badge status-found">
                    ✅ Account Found in Database
                  </div>
                </div>
              )}

              {!userDetails && pendingWalletAddress && (
                <div className="account-status">
                  <div className="status-badge status-new">
                    📝 New Account - Please Register
                  </div>
                </div>
              )}

              <div className="confirmation-actions">
                <button className="btn-confirm" onClick={confirmWalletAddress}>
                  ✓ Confirm This Address
                </button>
                <button className="btn-cancel" onClick={cancelWalletConnection}>
                  ✕ Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      {currentPage === 'admin' && walletAddress && walletAddress.toLowerCase() === ADMIN_WALLET ? (
        <AdminDashboard walletAddress={walletAddress} />
      ) : (
        <>
          <header className="header">
            <div className="header-container">
              <a href="/" className="logo" onClick={(e) => { e.preventDefault(); setCurrentPage('home'); }}>
                <img src="/iccwallet-fox.svg" alt="ICC Wallet" className="logo-icon" style={{ width: '32px', height: '32px', objectFit: 'contain', marginRight: '8px' }} />
                <span>IIC REP Node</span>
              </a>
              
              <nav className="nav-links">
                <a
                  href="/#admin"
                  className="nav-link"
                  onClick={(e) => { e.preventDefault(); goToAdmin(); }}
                >
                  Admin
                </a>
                <a
                  href="/#repnode"
                  className="nav-link"
                  onClick={(e) => { e.preventDefault(); setCurrentPage('repnode'); }}
                >
                  Repnode
                </a>
                <a
                  href="/#features"
                  className="nav-link"
                  onClick={(e) => { e.preventDefault(); goToSection('features'); }}
                >
                  Mining
                </a>
                <a
                  href="/#staking"
                  className="nav-link"
                  onClick={(e) => { e.preventDefault(); goToStaking(); }}
                >
                  Staking
                </a>
                {walletConnected && (
                  <a
                    href="/#my-reward"
                    className="nav-link"
                    onClick={(e) => { e.preventDefault(); goToMyReward(); }}
                  >
                    My Reward
                  </a>
                )}
                <a
                  href="/#setup"
                  className="nav-link"
                  onClick={(e) => { e.preventDefault(); goToDocs('setup'); }}
                >
                  Node Setup
                </a>
                <a
                  href="/#rewards"
                  className="nav-link"
                  onClick={(e) => { e.preventDefault(); goToRewards(); }}
                >
                  Rewards
                </a>
                <a
                  href="/#all-rewards"
                  className="nav-link"
                  onClick={(e) => { e.preventDefault(); goToAllRewards(); }}
                >
                  All Rewards
                </a>
                <a
                  href="/#documentation"
                  className="nav-link"
                  onClick={(e) => { e.preventDefault(); goToDocs('documentation'); }}
                >
                  Documentation
                </a>
              </nav>

              <button className="launch-btn" onClick={handleLaunchClick}>
                Launch
              </button>
            </div>
          </header>
          {/* Main content and footer */}
          {currentPage === 'admin' ? (
            <div style={{ maxWidth: 500, margin: '60px auto', padding: 32, background: 'rgba(255,255,255,0.95)', borderRadius: 16, boxShadow: '0 4px 24px #e0e0e0', textAlign: 'center' }}>
              <h2 style={{ color: '#ff6b35' }}>Admin Access Only</h2>
              <p style={{ color: '#444', fontSize: 18 }}>Connect with the admin wallet to access the Repnode Admin Dashboard.</p>
            </div>
          ) : currentPage === 'repnode' ? (
            <RepnodeAccessGate
              walletAddress={walletAddress}
              walletConnected={walletConnected}
              onConnectWallet={connectWallet}
            />
          ) : currentPage === 'staking' ? (
            <StakingPortal
              walletAddress={walletAddress}
              walletConnected={walletConnected}
              onConnectWallet={connectWallet}
            />
          ) : currentPage === 'docs' ? renderDocs() : currentPage === 'rewards' ? renderRewards() : currentPage === 'all-rewards' ? renderAllRewards() : currentPage === 'my-reward' ? renderMyReward() : renderHome()}
          {/* Footer */}
          <footer className="footer">
            <div className="footer-container">
              <div className="footer-brand">
                <img src="/iccwallet-fox.svg" alt="ICC Wallet" className="logo-icon" style={{ width: '48px', height: '48px', objectFit: 'contain', marginBottom: '12px' }} />
                <p>REP Node on ICC Blockchain V1.0</p>
                <p style={{ fontSize: '14px', opacity: 0.7, marginTop: '8px' }}>
                  Prof. Hiro Takahashi - Advanced Blockchain Lab
                </p>
              </div>
            </div>
          </footer>
        </>
      )}
    </div>
  );
}

export default App;
