# Verification Polling System - React Integration

## 📋 Overview

Complete React polling system for PHP backend verification with real-time monitoring, OTP verification, and KBA (Knowledge-Based Authentication).

## 🚀 Features

- **Real-time Polling**: Automatic status checks with configurable intervals
- **OTP Verification**: Email and SMS verification with live status
- **KBA Security**: Transaction-level knowledge-based authentication
- **Session Management**: Automatic session monitoring and timeout handling
- **Error Handling**: Comprehensive retry logic and error reporting
- **Dev Mode**: Built-in debugging with actual OTP display

## 📁 Project Structure

```
react-components/
├── App.js                           # Main application component
├── PollingService.js                # Core polling service (singleton)
├── VerificationDashboard.js         # Main verification UI
├── VerificationDashboard.css        # Styling
├── index.js                         # Entry point
├── index.css                        # Global styles
├── package.json                     # Dependencies
├── hooks/
│   └── usePollingHooks.js          # Custom React hooks
└── public/
    └── index.html                   # HTML template
```

## 🔧 Installation

### 1. Install Dependencies

```bash
cd react-components
npm install
```

### 2. Start PHP Backend

```bash
cd ..
php -S localhost:8000 router.php
```

### 3. Start React Development Server

```bash
cd react-components
npm start
```

The app will open at `http://localhost:3000`

## 📡 Polling Service API

### Basic Usage

```javascript
import pollingService from './PollingService';

// Start polling
pollingService.startPolling(
  'my-poll-id',           // Unique identifier
  'api-action',           // PHP endpoint action
  { param: 'value' },     // Request data
  (result, error) => {    // Callback
    if (error) {
      console.error('Error:', error);
    } else {
      console.log('Success:', result);
    }
  },
  5000                    // Interval (ms)
);

// Stop polling
pollingService.stopPolling('my-poll-id');

// Stop all polls
pollingService.stopAllPolling();
```

### Available Methods

```javascript
// User Management
await pollingService.getUserByAddress(address);

// OTP Operations
await pollingService.sendEmailOTP(email);
await pollingService.sendSMSOTP(phone);
await pollingService.verifyOTP(key, otp);

// Verification Flow
await pollingService.initiateVerification(address);
await pollingService.verifyBothOTPs(email, phone, emailOtp, phoneOtp);

// KBA Operations
await pollingService.getKBAQuestion(address);
await pollingService.verifyKBATransaction(address, questionType, answer);

// Registration
await pollingService.sendBothOTPsWithKBA(data);
await pollingService.verifyAndRegister(data);
```

## 🎣 Custom Hooks

### useVerificationPolling

Monitor verification status in real-time:

```javascript
import { useVerificationPolling } from './hooks/usePollingHooks';

function MyComponent() {
  const { verificationStatus, startPolling, stopPolling } = useVerificationPolling();

  useEffect(() => {
    startPolling(walletAddress, 5000);
    return () => stopPolling();
  }, [walletAddress]);

  return (
    <div>
      {verificationStatus.isPolling && <span>Checking...</span>}
      {verificationStatus.emailVerified && <span>✅ Email verified</span>}
    </div>
  );
}
```

### useTransactionKBAPolling

Monitor pending transactions requiring KBA:

```javascript
import { useTransactionKBAPolling } from './hooks/usePollingHooks';

function TransactionMonitor() {
  const { transactionStatus, startPolling } = useTransactionKBAPolling();

  useEffect(() => {
    startPolling(walletAddress, 10000);
  }, []);

  return (
    <div>
      Pending: {transactionStatus.pendingTransactions.length}
      {transactionStatus.requiresKBA && (
        <div>KBA Required: {transactionStatus.kbaQuestion?.text}</div>
      )}
    </div>
  );
}
```

### useSessionPolling

Automatic session timeout monitoring:

```javascript
import { useSessionPolling } from './hooks/usePollingHooks';

function App() {
  const handleSessionExpired = () => {
    alert('Session expired. Please log in again.');
    // Redirect to login
  };

  const { sessionStatus, startPolling } = useSessionPolling(handleSessionExpired);

  useEffect(() => {
    startPolling(60000); // Check every minute
  }, []);

  return <div>{sessionStatus.isActive ? 'Active' : 'Expired'}</div>;
}
```

## 🎨 Verification Dashboard Component

Complete verification UI with all steps:

```javascript
import VerificationDashboard from './VerificationDashboard';

function App() {
  const handleComplete = (data) => {
    console.log('Verification complete:', data);
    // Handle completion
  };

  return (
    <VerificationDashboard
      walletAddress="0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb"
      onVerificationComplete={handleComplete}
    />
  );
}
```

## ⚙️ Configuration

### Polling Intervals

Edit in `VerificationDashboard.js`:

```javascript
const POLLING_INTERVALS = {
  verification: 5000,   // 5 seconds
  transaction: 10000,   // 10 seconds
  session: 60000        // 60 seconds
};
```

### API Base URL

Edit in `PollingService.js`:

```javascript
const API_BASE_URL = 'http://localhost:8000/server.php';
```

### Max Retries

Edit in `PollingService.js`:

```javascript
this.maxRetries = 3;
```

## 🔐 Security Features

1. **Session Management**: Automatic session validation
2. **CORS Handling**: Credentials included in all requests
3. **Input Validation**: Client-side validation before submission
4. **KBA Hashing**: Answers are hashed before storage (server-side)
5. **Rate Limiting**: Built-in retry logic prevents spam

## 🐛 Debugging

### Enable Dev Mode

Dev mode shows actual OTPs for testing:

```javascript
// Automatically enabled in development
process.env.NODE_ENV === 'development'
```

### Console Logging

All API calls and polling events are logged:

```javascript
// Enable verbose logging
pollingService.debug = true;
```

## 📊 Polling Statistics

Dashboard displays real-time stats:

- **Last Check**: Timestamp of most recent poll
- **Total Checks**: Cumulative poll count
- **Active Polls**: Number of concurrent polling operations

## 🎯 PHP Backend Integration

### Required Endpoints

Your PHP backend must support these actions:

```php
// server.php
switch ($action) {
    case 'get-user-by-address':
    case 'send-email-otp':
    case 'send-sms-otp':
    case 'verify-otps':
    case 'verify-email-otp':
    case 'initiate-verification':
    case 'verify-otp':
    case 'verify-otpss':
    case 'send-otpss':
    case 'get-kba-question':
    case 'verify-kba-transaction':
    // ... your handlers
}
```

### Response Format

All endpoints should return JSON:

```json
{
  "success": true,
  "message": "Operation successful",
  "data": { ... }
}
```

## 📱 Responsive Design

Fully responsive for all devices:

- Desktop: Full multi-column layout
- Tablet: Adaptive columns
- Mobile: Single column, stacked layout

## 🚦 Error Handling

Comprehensive error handling at all levels:

```javascript
try {
  const result = await pollingService.sendEmailOTP(email);
  if (!result.success) {
    // Handle API error
  }
} catch (error) {
  // Handle network error
}
```

## 📦 Build for Production

```bash
npm run build
```

Output in `build/` directory ready for deployment.

## 🤝 Contributing

1. Fork the repository
2. Create feature branch
3. Make changes
4. Test thoroughly
5. Submit pull request

## 📄 License

MIT License - Use freely in your projects

## 🆘 Support

For issues or questions, check the console logs or contact support.

---

**Built with ❤️ for secure wallet verification**
