import React, { useState, useEffect } from 'react';
import './VerificationDashboard.css';
import { API_BASE } from './apiBase';

/**
 * Verification Dashboard - Step-by-step verification flow
 * Steps: OTP Verification → KBA Security → Complete
 * Connected to backend APIs for wallet verification
 */
const VerificationDashboard = ({ walletAddress, onVerificationComplete }) => {
  const [currentStep, setCurrentStep] = useState('init'); // init, otp, kba, complete
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [userData, setUserData] = useState(null);
  const [stats, setStats] = useState({
    lastCheck: 'Not started',
    checkCount: 0,
    activePolls: 0
  });

  // OTP State
  const [otpData, setOtpData] = useState({
    emailOtp: '',
    phoneOtp: ''
  });

  // KBA State
  const [kbaData, setKbaData] = useState({
    question: null,
    answer: '',
    questionType: null
  });

  // ==================== INITIALIZATION ====================
  useEffect(() => {
    if (walletAddress) {
      initializeVerification();
    }
  }, [walletAddress]);


  const initializeVerification = async () => {
    try {
      setLoading(true);
      setError(null);
      setStats(prev => ({ ...prev, lastCheck: new Date().toLocaleTimeString() }));

      const response = await fetch(`${API_BASE}?action=initiate-verification`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: walletAddress })
      });

      const result = await response.json();

      if (result.exists) {
        setUserData(result);
        setOtpData({
          emailOtp: result.emailOtp,
          phoneOtp: result.smsOtp
        });
        setCurrentStep('otp');
        setStats(prev => ({ ...prev, checkCount: 1 }));
      } else {
        setError('Wallet address not found. Please check and try again.');
      }
    } catch (err) {
      setError('Failed to initiate verification: ' + err.message);
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  // ==================== OTP VERIFICATION ====================
  const handleVerifyOTP = async () => {
    if (!otpData.emailOtp || !otpData.phoneOtp) {
      setError('Please enter both OTP codes');
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const response = await fetch(`${API_BASE}?action=verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address: walletAddress,
          email: userData.email,
          phone: userData.phone,
          emailOtp: otpData.emailOtp,
          phoneOtp: otpData.phoneOtp
        })
      });

      const result = await response.json();

      if (result.success) {
        setStats(prev => ({ ...prev, checkCount: prev.checkCount + 1 }));
        // Get KBA question
        await getKBAQuestion();
      } else {
        setError(result.message || 'OTP verification failed');
      }
    } catch (err) {
      setError('Verification error: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // ==================== KBA SECURITY ====================
  const getKBAQuestion = async () => {
    try {
      const response = await fetch(`${API_BASE}?action=get-kba-question`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: walletAddress })
      });

      const result = await response.json();

      if (result.success) {
        setKbaData({
          question: result.question.text,
          questionType: result.question.type,
          answer: ''
        });
        setCurrentStep('kba');
      } else {
        setError('Failed to get security question');
      }
    } catch (err) {
      setError('Error loading security question: ' + err.message);
    }
  };

  const handleVerifyKBA = async () => {
    if (!kbaData.answer.trim()) {
      setError('Please provide an answer to the security question');
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const response = await fetch(`${API_BASE}?action=verify-kba-transaction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address: walletAddress,
          questionType: kbaData.questionType,
          answer: kbaData.answer
        })
      });

      const result = await response.json();

      if (result.success) {
        setStats(prev => ({ ...prev, checkCount: prev.checkCount + 1, activePolls: 1 }));
        setCurrentStep('complete');
        if (onVerificationComplete) {
          onVerificationComplete(userData);
        }
      } else {
        setError(result.message || 'KBA verification failed');
      }
    } catch (err) {
      setError('Verification error: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleStopPolling = () => {
    setCurrentStep('idle');
    setStats(prev => ({ ...prev, activePolls: 0 }));
  };

  // ==================== RENDER ====================
  return (
    <div className="verification-dashboard">
      {/* Header */}
      <div className="dashboard-header">
        <h2>Verification Dashboard</h2>
      </div>

      {/* Stats Cards */}
      <div className="stats-cards">
        <div className="stat-card">
          <label>LAST CHECK:</label>
          <div className="stat-value">{stats.lastCheck}</div>
        </div>
        <div className="stat-card">
          <label>TOTAL CHECKS:</label>
          <div className="stat-value">{stats.checkCount}</div>
        </div>
        <div className="stat-card">
          <label>ACTIVE POLLS:</label>
          <div className="stat-value">{stats.activePolls}</div>
        </div>
      </div>

      {/* Steps Indicator */}
      <div className="steps-indicator">
        <div className={`step ${['otp', 'kba', 'complete'].includes(currentStep) ? 'active' : ''}`}>
          <div className="step-circle">1</div>
          <span>OTP Verification</span>
        </div>
        <div className="step-connector"></div>
        <div className={`step ${['kba', 'complete'].includes(currentStep) ? 'active' : ''}`}>
          <div className="step-circle">2</div>
          <span>KBA Security</span>
        </div>
        <div className="step-connector"></div>
        <div className={`step ${currentStep === 'complete' ? 'active' : ''}`}>
          <div className="step-circle">3</div>
          <span>Complete</span>
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="error-message">
          <span className="error-icon">⚠️</span>
          {error}
        </div>
      )}

      {/* Content Area */}
      <div className="dashboard-content">
        {/* Initialization */}
        {currentStep === 'init' && (
          <div className="step-content">
            <p>Initializing verification for wallet: <strong>{walletAddress}</strong></p>
            {loading && <div className="loader">Loading...</div>}
          </div>
        )}

        {/* OTP Verification Step */}
        {currentStep === 'otp' && (
          <div className="step-content">
            <h3>Step 1: Verify Email & Phone OTP</h3>
            <p className="step-description">
              Enter the One-Time Passwords sent to your email and phone number to verify your identity.
            </p>

            <div className="otp-inputs">
              <div className="input-group">
                <label>Email OTP:</label>
                <input
                  type="text"
                  placeholder="Enter 6-digit OTP"
                  value={otpData.emailOtp}
                  onChange={(e) => setOtpData(prev => ({ ...prev, emailOtp: e.target.value }))}
                  maxLength="6"
                  disabled={loading}
                />
              </div>
              <div className="input-group">
                <label>Phone OTP:</label>
                <input
                  type="text"
                  placeholder="Enter 6-digit OTP"
                  value={otpData.phoneOtp}
                  onChange={(e) => setOtpData(prev => ({ ...prev, phoneOtp: e.target.value }))}
                  maxLength="6"
                  disabled={loading}
                />
              </div>
            </div>

            <button
              onClick={handleVerifyOTP}
              disabled={loading || !otpData.emailOtp || !otpData.phoneOtp}
              className="verify-btn"
            >
              {loading ? 'Verifying OTPs...' : 'Verify OTPs'}
            </button>
          </div>
        )}

        {/* KBA Security Step */}
        {currentStep === 'kba' && (
          <div className="step-content">
            <h3>Step 2: Answer Security Question</h3>
            <p className="step-description">
              Answer your security question to complete the verification process.
            </p>

            {kbaData.question && (
              <div className="kba-section">
                <div className="question-box">
                  <p className="question-text">{kbaData.question}</p>
                </div>

                <div className="input-group">
                  <label>Your Answer:</label>
                  <input
                    type="text"
                    placeholder="Enter your answer"
                    value={kbaData.answer}
                    onChange={(e) => setKbaData(prev => ({ ...prev, answer: e.target.value }))}
                    disabled={loading}
                  />
                </div>

                <button
                  onClick={handleVerifyKBA}
                  disabled={loading || !kbaData.answer.trim()}
                  className="verify-btn"
                >
                  {loading ? 'Verifying Answer...' : 'Submit Answer'}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Complete Step */}
        {currentStep === 'complete' && (
          <div className="step-content complete-section">
            <div className="success-icon">✅</div>
            <h3>Verification Complete!</h3>
            <p className="success-message">
              Your wallet has been successfully verified and is ready for secure transactions.
            </p>
            <div className="verification-details">
              <p><strong>User:</strong> {userData?.username}</p>
              <p><strong>Email:</strong> {userData?.email}</p>
              <p><strong>Status:</strong> <span className="status-badge">Verified</span></p>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="dashboard-footer">
        <button
          onClick={handleStopPolling}
          disabled={currentStep === 'complete'}
          className="stop-polling-btn"
        >
          Stop All Polling
        </button>
      </div>
    </div>
  );
};

export default VerificationDashboard;