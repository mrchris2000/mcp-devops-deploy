#!/usr/bin/env node

/**
 * Simple Token Authentication Module
 * 
 * This module handles authentication using the /rest/tokens endpoint instead of Keycloak.
 * It's a simplified approach that uses personal access tokens directly.
 */

import https from 'https';

// Handle self-signed certificates
const httpsAgent = new https.Agent({
    rejectUnauthorized: false
});

export class SimpleAuth {
    constructor(config) {
        this.serverURL = config.serverURL;
        this.personalAccessToken = config.personalAccessToken;
        
        // Derive base URL from server URL
        this.baseURL = this.extractBaseURL(this.serverURL);
        this.tokenEndpoint = `${this.baseURL}/rest/tokens/`; // Note: trailing slash like in Groovy
        
        // Token storage
        this.accessToken = null;
        this.tokenExpiry = null;
        
        console.log(`Simple Auth initialized:`);
        console.log(`  Base URL: ${this.baseURL}`);
        console.log(`  Token Endpoint: ${this.tokenEndpoint}`);
        console.log(`  Has Personal Access Token: ${!!this.personalAccessToken}`);
    }
    
    /**
     * Extract base URL from server URL (remove path components and hash)
     */
    extractBaseURL(serverURL) {
        const cleanURL = serverURL.replace('/#', '');
        const url = new URL(cleanURL);
        // For DevOps Test, we need to keep the /test path prefix
        if (cleanURL.includes('/test')) {
            // Keep the /test prefix for the token endpoint
            return cleanURL.replace(/\/$/, ''); // Remove trailing slash if present
        }
        return `${url.protocol}//${url.host}`;
    }
    
    /**
     * Check if we have a valid access token
     */
    hasValidToken() {
        if (!this.accessToken) return false;
        if (!this.tokenExpiry) return true; // No expiry info, assume valid
        
        // Check if token expires in the next 60 seconds
        const now = Date.now();
        const expiryBuffer = 60 * 1000; // 60 seconds
        return this.tokenExpiry > (now + expiryBuffer);
    }
    
    /**
     * Authenticate using refresh token via /rest/tokens/ endpoint
     * Based on working TokenUtil.groovy implementation
     */
    async authenticateWithPersonalToken() {
        console.log('🔐 Starting authentication with refresh token...');
        
        if (!this.personalAccessToken) {
            throw new Error('Personal access token is required for authentication');
        }
        
        console.log(`📡 Making token request to: ${this.tokenEndpoint}`);
        
        try {
            // Use the exact same approach as the working Groovy implementation
            const formData = new URLSearchParams();
            formData.append('refresh_token', this.personalAccessToken);
            
            const response = await fetch(this.tokenEndpoint, {
                method: 'POST',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                    // Note: No Authorization header needed - just send refresh_token in form data
                },
                agent: httpsAgent,  // Use HTTPS agent that accepts self-signed certificates
                body: formData
            });
            
            console.log(`📊 Response: ${response.status} ${response.statusText}`);
            
            if (response.ok) {
                const data = await response.json();
                
                // Extract access token from response
                if (data.access_token || data.token) {
                    this.accessToken = data.access_token || data.token;
                } else {
                    throw new Error('No access token in response');
                }
                
                // Calculate token expiry if provided
                if (data.expires_in) {
                    this.tokenExpiry = Date.now() + (data.expires_in * 1000);
                } else {
                    // Default to 1 hour expiry if not specified
                    this.tokenExpiry = Date.now() + (3600 * 1000);
                }
                
                console.log('✅ Authentication successful!');
                console.log(`   Access token length: ${this.accessToken.length}`);
                console.log(`   Token type: ${data.token_type || 'Bearer'}`);
                console.log(`   Expires in: ${data.expires_in || 3600} seconds`);
                
                return {
                    success: true,
                    accessToken: this.accessToken,
                    expiresIn: data.expires_in || 3600,
                    tokenType: data.token_type || 'Bearer'
                };
                
            } else {
                const errorText = await response.text();
                console.error('❌ Token request failed:');
                console.error(`   Status: ${response.status} ${response.statusText}`);
                console.error(`   Error: ${errorText}`);
                
                // Handle specific error cases
                if (response.status === 403) {
                    throw new Error('License or authorization error - request returned 403. Please check the license and permissions.');
                }
                
                let errorDetails;
                try {
                    errorDetails = JSON.parse(errorText);
                } catch (e) {
                    errorDetails = { error: 'unknown', error_description: errorText };
                }
                
                return {
                    success: false,
                    error: errorDetails.error,
                    errorDescription: errorDetails.error_description,
                    status: response.status
                };
            }
            
        } catch (error) {
            console.error('❌ Network error during authentication:', error.message);
            
            return {
                success: false,
                error: 'network_error',
                errorDescription: error.message
            };
        }
    }
    
    /**
     * Get a valid access token (handles automatic refresh)
     */
    async getAccessToken() {
        if (this.hasValidToken()) {
            console.log('✅ Using existing valid access token');
            return { success: true, accessToken: this.accessToken };
        }
        
        console.log('🔄 Access token expired or missing, obtaining new token...');
        return await this.authenticateWithPersonalToken();
    }
    
    /**
     * Get authorization header for API requests
     */
    async getAuthHeader() {
        const result = await this.getAccessToken();
        if (result.success) {
            return `Bearer ${result.accessToken}`;
        } else {
            throw new Error(`Authentication failed: ${result.errorDescription || result.error}`);
        }
    }
    
    /**
     * Clear stored tokens
     */
    clearTokens() {
        this.accessToken = null;
        this.tokenExpiry = null;
        console.log('🗑️  Tokens cleared');
    }
}

/**
 * Create SimpleAuth instance from environment variables
 */
export function createSimpleAuthFromEnv() {
    const config = {
        serverURL: process.env.TEST_SERVER_URL,
        personalAccessToken: process.env.TEST_ACCESS_TOKEN
    };
    
    // Validate required config
    if (!config.serverURL) {
        throw new Error('TEST_SERVER_URL environment variable is required');
    }
    if (!config.personalAccessToken) {
        throw new Error('TEST_ACCESS_TOKEN environment variable is required');
    }
    
    return new SimpleAuth(config);
}

export default SimpleAuth;
