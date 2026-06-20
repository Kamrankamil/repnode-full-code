import React, { useState, useEffect } from 'react';
import pollingService from './PollingService';

/**
 * Custom Hook for User Verification Polling
 * Monitors verification status and handles real-time updates
 */
export const useVerificationPolling = () => {
  const [verificationStatus, setVerificationStatus] = useState({
    isPolling: false,
    emailVerified: false,
    phoneVerified: false,
    userData: null,
    error: null,
    lastCheck: null
  });

  const startPolling = (address, interval = 5000) => {
    pollingService.startPolling(
      'verification-status',
      'get-user-by-address',
      { address },
      (result, error) => {
        if (error) {
          setVerificationStatus(prev => ({
            ...prev,
            error: error.message,
            isPolling: false
          }));
          return;
        }

        setVerificationStatus({
          isPolling: true,
          emailVerified: result.user?.email_verified || false,
          phoneVerified: result.user?.phone_verified || false,
          userData: result.user,
          error: null,
          lastCheck: new Date()
        });
      },
      interval
    );
  };

  const stopPolling = () => {
    pollingService.stopPolling('verification-status');
    setVerificationStatus(prev => ({ ...prev, isPolling: false }));
  };

  useEffect(() => {
    return () => {
      pollingService.stopPolling('verification-status');
    };
  }, []);

  return {
    verificationStatus,
    startPolling,
    stopPolling
  };
};

/**
 * Custom Hook for Transaction KBA Polling
 * Monitors pending transactions requiring KBA verification
 */
export const useTransactionKBAPolling = () => {
  const [transactionStatus, setTransactionStatus] = useState({
    isPolling: false,
    pendingTransactions: [],
    requiresKBA: false,
    kbaQuestion: null,
    error: null,
    lastCheck: null
  });

  const checkPendingTransactions = async (address) => {
    try {
      // This would be your custom endpoint for checking pending transactions
      const result = await pollingService.apiCall('get-pending-transactions', { address });
      
      setTransactionStatus(prev => ({
        ...prev,
        pendingTransactions: result.transactions || [],
        requiresKBA: result.requiresKBA || false,
        lastCheck: new Date()
      }));

      // If KBA is required, fetch a random question
      if (result.requiresKBA) {
        const kbaResult = await pollingService.getKBAQuestion(address);
        setTransactionStatus(prev => ({
          ...prev,
          kbaQuestion: kbaResult.question
        }));
      }
    } catch (error) {
      setTransactionStatus(prev => ({
        ...prev,
        error: error.message
      }));
    }
  };

  const startPolling = (address, interval = 10000) => {
    pollingService.startPolling(
      'transaction-kba',
      'get-pending-transactions',
      { address },
      (result, error) => {
        if (error) {
          setTransactionStatus(prev => ({
            ...prev,
            error: error.message,
            isPolling: false
          }));
          return;
        }

        checkPendingTransactions(address);
      },
      interval
    );

    setTransactionStatus(prev => ({ ...prev, isPolling: true }));
  };

  const stopPolling = () => {
    pollingService.stopPolling('transaction-kba');
    setTransactionStatus(prev => ({ ...prev, isPolling: false }));
  };

  useEffect(() => {
    return () => {
      pollingService.stopPolling('transaction-kba');
    };
  }, []);

  return {
    transactionStatus,
    startPolling,
    stopPolling,
    checkPendingTransactions
  };
};

/**
 * Custom Hook for OTP Status Polling
 * Monitors OTP validation status in real-time
 */
export const useOTPPolling = () => {
  const [otpStatus, setOtpStatus] = useState({
    isPolling: false,
    emailOTPSent: false,
    phoneOTPSent: false,
    emailOTPVerified: false,
    phoneOTPVerified: false,
    error: null,
    lastCheck: null
  });

  const pollOTPStatus = (email, phone, interval = 3000) => {
    pollingService.startPolling(
      'otp-status',
      'check-otp-status', // You would need to create this endpoint
      { email, phone },
      (result, error) => {
        if (error) {
          setOtpStatus(prev => ({
            ...prev,
            error: error.message,
            isPolling: false
          }));
          return;
        }

        setOtpStatus({
          isPolling: true,
          emailOTPSent: result.emailOTPSent || false,
          phoneOTPSent: result.phoneOTPSent || false,
          emailOTPVerified: result.emailOTPVerified || false,
          phoneOTPVerified: result.phoneOTPVerified || false,
          error: null,
          lastCheck: new Date()
        });

        // Auto-stop polling if both are verified
        if (result.emailOTPVerified && result.phoneOTPVerified) {
          pollingService.stopPolling('otp-status');
          setOtpStatus(prev => ({ ...prev, isPolling: false }));
        }
      },
      interval
    );
  };

  const stopPolling = () => {
    pollingService.stopPolling('otp-status');
    setOtpStatus(prev => ({ ...prev, isPolling: false }));
  };

  useEffect(() => {
    return () => {
      pollingService.stopPolling('otp-status');
    };
  }, []);

  return {
    otpStatus,
    pollOTPStatus,
    stopPolling
  };
};

/**
 * Custom Hook for Session Status Polling
 * Monitors session validity and auto-logout
 */
export const useSessionPolling = (onSessionExpired) => {
  const [sessionStatus, setSessionStatus] = useState({
    isActive: true,
    isPolling: false,
    lastActivity: new Date(),
    error: null
  });

  const startPolling = (interval = 60000) => {
    pollingService.startPolling(
      'session-status',
      'check-session', // You would need to create this endpoint
      {},
      (result, error) => {
        if (error) {
          setSessionStatus(prev => ({
            ...prev,
            error: error.message,
            isPolling: false
          }));
          return;
        }

        if (!result.active) {
          pollingService.stopPolling('session-status');
          setSessionStatus({
            isActive: false,
            isPolling: false,
            lastActivity: new Date(),
            error: 'Session expired'
          });
          
          if (onSessionExpired) {
            onSessionExpired();
          }
        } else {
          setSessionStatus({
            isActive: true,
            isPolling: true,
            lastActivity: new Date(),
            error: null
          });
        }
      },
      interval
    );
  };

  const stopPolling = () => {
    pollingService.stopPolling('session-status');
    setSessionStatus(prev => ({ ...prev, isPolling: false }));
  };

  useEffect(() => {
    return () => {
      pollingService.stopPolling('session-status');
    };
  }, []);

  return {
    sessionStatus,
    startPolling,
    stopPolling
  };
};
