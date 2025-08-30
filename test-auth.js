#!/usr/bin/env node

// Direct test of the authentication logic
process.env.DEPLOY_TOKEN = "c25b1edd-a2b1-4928-858b-7911daddb3b4";
process.env.DEPLOY_SERVER_URL = "https://devops-automation.platform-staging1.us-east.containers.appdomain.cloud/deploy";

import('./src/lib/server.js').then(async () => {
    // Wait a moment for the server to initialize
    setTimeout(async () => {
        try {
            console.log('Testing authentication...');
            
            // The server module is loaded, we can access the functions
            // Let's manually test the API call
            const https = require('https');
            const token = process.env.DEPLOY_TOKEN;
            
            // Test Deploy API format
            const auth = Buffer.from(`PasswordIsAuthToken:${token}`).toString('base64');
            const url = 'https://devops-automation.platform-staging1.us-east.containers.appdomain.cloud/deploy/cli/application';
            
            const options = {
                method: 'GET',
                headers: {
                    'Accept': 'application/json',
                    'Authorization': `Basic ${auth}`
                }
            };
            
            const req = https.request(url, options, (res) => {
                console.log(`✅ Direct Deploy Token Auth Test: ${res.statusCode}`);
                let data = '';
                res.on('data', (chunk) => data += chunk);
                res.on('end', () => {
                    console.log(`Response: ${data.substring(0, 200)}`);
                    process.exit(0);
                });
            });
            
            req.on('error', (e) => {
                console.error('❌ Request error:', e.message);
                process.exit(1);
            });
            
            req.end();
            
        } catch (error) {
            console.error('❌ Test error:', error.message);
            process.exit(1);
        }
    }, 1000);
}).catch(e => {
    console.error('❌ Import error:', e.message);
    process.exit(1);
});
