// Quick script to check if environment variables are set correctly
// Run: node check-env.js

const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '.env.production');

if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  console.log('=== .env.production contents ===');
  console.log(content);
  console.log('\n=== Environment variables ===');
  console.log('REACT_APP_API_BASE:', process.env.REACT_APP_API_BASE);
  console.log('REACT_APP_SOCKET_BASE:', process.env.REACT_APP_SOCKET_BASE);
} else {
  console.log('.env.production file not found!');
  console.log('Expected location:', envPath);
}





