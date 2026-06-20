/**
 * Polling Service for PHP Backend Communication
 * Handles all API requests with proper error handling and retries
 */
import { API_BASE } from './apiBase';

const API_BASE_URL = API_BASE;

class PollingService {
  constructor() {
    this.pollingIntervals = new Map();
    this.retryAttempts = new Map();
    this.maxRetries = 3;
  }

  /**
   * Generic API call method with error handling
   */
  async apiCall(action, data = {}, method = 'POST') {
    try {
      const url = `${API_BASE_URL}?action=${action}`;
      const options = {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include', // Important for session cookies
      };

      if (method === 'POST' && Object.keys(data).length > 0) {
        options.body = JSON.stringify(data);
      }

      const response = await fetch(url, options);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();
      return result;
    } catch (error) {
      console.error(`API call failed for action: ${action}`, error);
      throw error;
    }
  }

  /**
   * Start polling with custom interval and callback
   */
  startPolling(pollId, action, data, callback, interval = 5000) {
    // Clear existing polling if any
    this.stopPolling(pollId);

    // Initial call
    this.poll(pollId, action, data, callback);

    // Set up interval
    const intervalId = setInterval(() => {
      this.poll(pollId, action, data, callback);
    }, interval);

    this.pollingIntervals.set(pollId, intervalId);
    console.log(`✅ Polling started: ${pollId} (${interval}ms interval)`);
  }

  /**
   * Execute a single poll
   */
  async poll(pollId, action, data, callback) {
    try {
      const result = await this.apiCall(action, data);
      callback(result, null);
      
      // Reset retry counter on success
      this.retryAttempts.set(pollId, 0);
    } catch (error) {
      const retries = (this.retryAttempts.get(pollId) || 0) + 1;
      this.retryAttempts.set(pollId, retries);

      if (retries >= this.maxRetries) {
        console.error(`❌ Max retries reached for ${pollId}`);
        this.stopPolling(pollId);
        callback(null, { message: 'Max retries exceeded', error });
      } else {
        console.warn(`⚠️ Retry ${retries}/${this.maxRetries} for ${pollId}`);
        callback(null, { message: `Retry attempt ${retries}`, error });
      }
    }
  }

  /**
   * Stop polling
   */
  stopPolling(pollId) {
    const intervalId = this.pollingIntervals.get(pollId);
    if (intervalId) {
      clearInterval(intervalId);
      this.pollingIntervals.delete(pollId);
      this.retryAttempts.delete(pollId);
      console.log(`🛑 Polling stopped: ${pollId}`);
    }
  }

  /**
   * Stop all active polling
   */
  stopAllPolling() {
    this.pollingIntervals.forEach((intervalId, pollId) => {
      clearInterval(intervalId);
      console.log(`🛑 Polling stopped: ${pollId}`);
    });
    this.pollingIntervals.clear();
    this.retryAttempts.clear();
  }

  /**
   * Check if polling is active
   */
  isPolling(pollId) {
    return this.pollingIntervals.has(pollId);
  }

  // ==================== API METHODS ====================

  /**
   * Get user by wallet address
   */
  async getUserByAddress(address) {
    return this.apiCall('get-user-by-address', { address });
  }

  /**
   * Send email OTP
   */
  async sendEmailOTP(email) {
    return this.apiCall('send-email-otp', { email });
  }

  /**
   * Send SMS OTP
   */
  async sendSMSOTP(phone) {
    return this.apiCall('send-sms-otp', { phone });
  }

  /**
   * Verify single OTP
   */
  async verifyOTP(key, otp) {
    return this.apiCall('verify-otps', { key, otp });
  }

  /**
   * Initiate verification (sends both email and SMS OTP)
   */
  async initiateVerification(address) {
    return this.apiCall('initiate-verification', { address });
  }

  /**
   * Verify both email and SMS OTP
   */
  async verifyBothOTPs(email, phone, emailOtp, phoneOtp) {
    return this.apiCall('verify-otp', { email, phone, emailOtp, phoneOtp });
  }

  /**
   * Send both OTPs with KBA validation
   */
  async sendBothOTPsWithKBA(data) {
    const {
      email,
      phone,
      placeOfBirth,
      firstSchool,
      favoriteColor,
      motherMaidenName,
      firstPetName,
      childhoodFriend
    } = data;

    return this.apiCall('send-otpss', {
      email,
      phone,
      placeOfBirth,
      firstSchool,
      favoriteColor,
      motherMaidenName,
      firstPetName,
      childhoodFriend
    });
  }

  /**
   * Verify OTP and register user with KBA
   */
  async verifyAndRegister(data) {
    const {
      emailOtp,
      phoneOtp,
      username,
      number,
      address,
      email,
      phone,
      placeOfBirth,
      firstSchool,
      favoriteColor,
      motherMaidenName,
      firstPetName,
      childhoodFriend
    } = data;

    return this.apiCall('verify-otpss', {
      emailOtp,
      phoneOtp,
      username,
      number,
      address,
      email,
      phone,
      placeOfBirth,
      firstSchool,
      favoriteColor,
      motherMaidenName,
      firstPetName,
      childhoodFriend
    });
  }

  /**
   * Get random KBA question for transaction
   */
  async getKBAQuestion(address) {
    return this.apiCall('get-kba-question', { address });
  }

  /**
   * Verify KBA answer for transaction
   */
  async verifyKBATransaction(address, questionType, answer) {
    return this.apiCall('verify-kba-transaction', {
      address,
      questionType,
      answer
    });
  }
}

// Export singleton instance
const pollingService = new PollingService();
export default pollingService;
