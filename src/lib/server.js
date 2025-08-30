#!/usr/bin/env node


import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { config as loadEnv } from 'dotenv';
import { createSimpleAuthFromEnv, SimpleAuth } from './simple-auth.js';

// Load environment variables from .env file if it exists
loadEnv();

// Configuration from environment variables or command line arguments
function getConfig() {
    // Parse command line arguments
    const args = process.argv.slice(2);
    const config = {};
    
    for (let i = 0; i < args.length; i += 2) {
        const key = args[i];
        const value = args[i + 1];
        
        switch (key) {
            case '--token':
                config.token = value;
                break;
            case '--server-url':
                config.serverUrl = value;
                break;
        }
    }
    
    // Environment variables take precedence if not provided via command line
    // Support multiple env var names (IBM DevOps Deploy / legacy Deploy / test harness)
    const token = config.token || process.env.DOD_ACCESS_TOKEN || process.env.DEPLOY_TOKEN || process.env.TEST_ACCESS_TOKEN;
    const serverURL = config.serverUrl || process.env.DOD_SERVER_URL || process.env.DEPLOY_SERVER_URL || process.env.TEST_SERVER_URL;
    const useSimpleTokenAuth = (process.env.USE_SIMPLE_TOKEN_AUTH || 'false').toLowerCase() === 'true';
    
    // Validate required configuration
    if (!serverURL) {
        throw new Error("Server URL is required. Set DEPLOY_SERVER_URL environment variable or use --server-url argument.");
    }

    if (!token) {
        throw new Error("Access token is required. Set DEPLOY_TOKEN environment variable or use --token argument.");
    }    return { 
        token,
        serverURL,
        useSimpleTokenAuth
    };
}

// Get configuration at startup
const { token, serverURL, useSimpleTokenAuth } = getConfig();

// Optional SimpleAuth instance (personal access token -> bearer token exchange)
let simpleAuthInstance = null;
if (useSimpleTokenAuth && token) {
    try {
        // Re-use SimpleAuth but map expected config keys
        simpleAuthInstance = new SimpleAuth({ serverURL, personalAccessToken: token });
        console.log('🔧 Simple token auth enabled');
    } catch (e) {
        console.warn('⚠️ Failed to initialize SimpleAuth:', e.message);
    }
} else if (token) {
    console.log('🔧 Direct token auth enabled (Deploy API format)');
}

// Create an MCP server
const server = new McpServer({
    name: "MCP Deploy Automation",
    version: "1.0.0"
});

// Global authentication variables
let authToken = token; // Use provided token
let authExpiry = null;
let useDeployTokenFormat = false; // Track if we should use Deploy API token format

// Deploy API base URL
const apiBaseUrl = `${serverURL}/cli`;

// Attempt to validate a bearer token
async function tryBearer(tokenToTest) {
    const testResp = await fetch(`${apiBaseUrl}/application`, {
        method: 'GET',
        headers: {
            'Accept': 'application/json',
            'Authorization': `Bearer ${tokenToTest}`
        }
    });
    return testResp.ok;
}

// Attempt to validate token via Basic (for any remaining basic auth needs)
async function tryBasic(u, p) {
    const testResp = await fetch(`${apiBaseUrl}/application`, {
        method: 'GET',
        headers: {
            'Accept': 'application/json',
            'Authorization': `Basic ${Buffer.from(`${u}:${p}`).toString('base64')}`
        }
    });
    return testResp.ok;
}

// Try Deploy API token authentication (PasswordIsAuthToken:token)
async function tryDeployTokenAuth(token) {
    const testResp = await fetch(`${apiBaseUrl}/application`, {
        method: 'GET',
        headers: {
            'Accept': 'application/json',
            'Authorization': `Basic ${Buffer.from(`PasswordIsAuthToken:${token}`).toString('base64')}`
        }
    });
    return testResp.ok;
}

// Initialize / refresh authentication
async function authenticate() {
    // 1. If using SimpleAuth (personal access token exchange)
    if (simpleAuthInstance) {
        console.log('🔐 Authenticating via SimpleAuth token exchange...');
        const result = await simpleAuthInstance.getAccessToken();
        if (result.success) {
            authToken = result.accessToken;
            console.log('✅ SimpleAuth bearer token acquired');
            return true;
        } else {
            console.warn('⚠️ SimpleAuth failed:', result.errorDescription || result.error);
            throw new Error(`SimpleAuth failed: ${result.errorDescription || result.error}`);
        }
    }

    // 2. Test the provided token in different formats
    if (authToken) {
        console.log('🔍 Validating provided access token...');
        try {
            // First try standard bearer token
            if (await tryBearer(authToken)) {
                console.log('✅ Bearer token valid');
                useDeployTokenFormat = false;
                return true;
            }
            
            // Try Deploy API's "PasswordIsAuthToken:token" format
            console.log('ℹ️ Bearer failed, trying Deploy API token format (PasswordIsAuthToken:token)');
            if (await tryDeployTokenAuth(authToken)) {
                useDeployTokenFormat = true;
                console.log('✅ Deploy API token format accepted');
                return true;
            }
            
            console.log('❌ Provided token not valid in any format');
            throw new Error('Token authentication failed - token not valid');
        } catch (e) {
            console.log('❌ Token validation error:', e.message);
            throw new Error(`Token authentication failed: ${e.message}`);
        }
    }

    throw new Error('No authentication token available');
}

// Get authenticated headers
async function getAuthHeaders() {
    // Check if we need to authenticate (first time or expired)
    if (!useDeployTokenFormat && !authExpiry && authToken) {
        // First time - need to determine token format
        await authenticate();
    } else if (authExpiry && Date.now() > authExpiry) {
        // Token expired - re-authenticate
        await authenticate();
    }

    const headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
    };

    // Use the appropriate token format based on what worked during authentication
    if (authToken) {
        if (useDeployTokenFormat) {
            headers['Authorization'] = `Basic ${Buffer.from(`PasswordIsAuthToken:${authToken}`).toString('base64')}`;
        } else {
            headers['Authorization'] = `Bearer ${authToken}`;
        }
    }

    return headers;
}

// Helper function to make authenticated API calls
async function makeApiCall(endpoint, method = 'GET', body = null) {
    try {
        const headers = await getAuthHeaders();
        const options = {
            method,
            headers
        };

        if (body && (method === 'POST' || method === 'PUT')) {
            options.body = JSON.stringify(body);
        }

        const response = await fetch(`${apiBaseUrl}${endpoint}`, options);
        
        if (!response.ok) {
            throw new Error(`API call failed: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        return data;
    } catch (error) {
        throw new Error(`API call to ${endpoint} failed: ${error.message}`);
    }
}
// Cleanup handler
async function cleanup() {
    process.exit(0);
}

process.on('SIGTERM', cleanup);
process.on('SIGINT', cleanup);

// ===============================
// MCP DEPLOYMENT TOOLS
// ===============================
// CRITICAL: ALWAYS start by calling list_applications to get application IDs, 
// then list_environments_for_application to get environment IDs.
// DO NOT use names directly - they may cause failures. Use IDs for all API calls.
// This ensures compatibility and avoids naming conflicts.
// ===============================

// Tool 1: Deploy snapshot to environment
server.tool(
    "deploy_snapshot_to_environment",
    "Deploy a named snapshot to a specific environment",
    {
        application: z.string().describe("Application ID from list_applications. REQUIRED: Must use ID, not name."),
        snapshot: z.string().describe("Snapshot ID from list_application_snapshots. REQUIRED: Must use ID, not name."),
        environment: z.string().describe("Environment ID from list_environments_for_application. REQUIRED: Must use ID, not name."),
        applicationProcess: z.string().describe("Application process ID. REQUIRED: Must use ID, not name."),
        description: z.string().optional().describe("Optional description for the deployment request"),
        onlyChanged: z.boolean().optional().default(true).describe("Deploy only changed versions (default: true)")
    },
    async (args) => {
        try {
            const requestBody = {
                application: args.application,
                snapshot: args.snapshot,
                environment: args.environment,
                applicationProcess: args.applicationProcess,
                onlyChanged: args.onlyChanged
            };

            if (args.description) {
                requestBody.description = args.description;
            }

            const result = await makeApiCall('/applicationProcessRequest', 'POST', requestBody);
            
            return {
                content: [{
                    type: 'text',
                    text: `✅ Deployment started successfully!\n\nRequest ID: ${result.requestId || 'N/A'}\nApplication: ${args.application}\nSnapshot: ${args.snapshot}\nEnvironment: ${args.environment}\nProcess: ${args.applicationProcess}\n\nUse get_deployment_status with the request ID to monitor progress.`
                }]
            };
        } catch (error) {
            return {
                content: [{
                    type: 'text',
                    text: `❌ Deployment failed: ${error.message}`
                }]
            };
        }
    }
);

// Tool 2: Deploy component versions
server.tool(
    "deploy_component_versions",
    "Deploy specific component versions to an environment",
    {
        application: z.string().describe("Application ID from list_applications. REQUIRED: Must use ID, not name."),
        environment: z.string().describe("Environment ID from list_environments_for_application. REQUIRED: Must use ID, not name."),
        applicationProcess: z.string().describe("Application process ID. REQUIRED: Must use ID, not name."),
        versions: z.array(z.object({
            component: z.string().describe("Component ID. REQUIRED: Must use ID, not name."),
            version: z.string().describe("Version ID. REQUIRED: Must use ID, not name.")
        })).describe("Array of component/version pairs to deploy"),
        description: z.string().optional().describe("Optional description for the deployment request"),
        onlyChanged: z.boolean().optional().default(true).describe("Deploy only changed versions (default: true)")
    },
    async (args) => {
        try {
            const requestBody = {
                application: args.application,
                environment: args.environment,
                applicationProcess: args.applicationProcess,
                versions: args.versions,
                onlyChanged: args.onlyChanged
            };

            if (args.description) {
                requestBody.description = args.description;
            }

            const result = await makeApiCall('/applicationProcessRequest', 'POST', requestBody);
            
            const versionsList = args.versions.map(v => `  - ${v.component}: ${v.version}`).join('\n');
            
            return {
                content: [{
                    type: 'text',
                    text: `✅ Deployment started successfully!\n\nRequest ID: ${result.requestId || 'N/A'}\nApplication: ${args.application}\nEnvironment: ${args.environment}\nProcess: ${args.applicationProcess}\n\nVersions to deploy:\n${versionsList}\n\nUse get_deployment_status with the request ID to monitor progress.`
                }]
            };
        } catch (error) {
            return {
                content: [{
                    type: 'text',
                    text: `❌ Deployment failed: ${error.message}`
                }]
            };
        }
    }
);

// Tool 3: List application snapshots
server.tool(
    "list_application_snapshots",
    "Get all available snapshots for an application",
    {
        application: z.string().describe("Application ID from list_applications. REQUIRED: Must use ID, not name.")
    },
    async (args) => {
        try {
            const result = await makeApiCall(`/application/snapshots?application=${encodeURIComponent(args.application)}`);
            
            if (result && Array.isArray(result)) {
                const snapshotList = result.map(snapshot => 
                    `- ${snapshot.name} (ID: ${snapshot.id || 'N/A'}) - Created: ${snapshot.created || 'N/A'}`
                ).join('\n');
                
                return {
                    content: [{
                        type: 'text',
                        text: `📸 Found ${result.length} snapshots for application "${args.application}":\n\n${snapshotList}\n\n💡 Tip: Use the snapshot IDs (shown in parentheses) for more reliable API calls.`
                    }]
                };
            } else {
                return {
                    content: [{
                        type: 'text',
                        text: `📸 No snapshots found for application "${args.application}"`
                    }]
                };
            }
        } catch (error) {
            return {
                content: [{
                    type: 'text',
                    text: `❌ Failed to retrieve snapshots: ${error.message}`
                }]
            };
        }
    }
);

// Tool 4: List environment inventory
server.tool(
    "list_environment_inventory",
    "Get current deployed versions in an environment",
    {
        application: z.string().describe("Application ID from list_applications. REQUIRED: Must use ID, not name."),
        environment: z.string().describe("Environment ID from list_environments_for_application. REQUIRED: Must use ID, not name.")
    },
    async (args) => {
        try {
            const result = await makeApiCall(`/environment/${encodeURIComponent(args.environment)}/latestDesiredInventory/?application=${encodeURIComponent(args.application)}`);
            
            if (result && result.components) {
                const inventoryList = result.components.map(comp => 
                    `- ${comp.name}: ${comp.version || 'No version deployed'} (Status: ${comp.status || 'Unknown'})`
                ).join('\n');
                
                return {
                    content: [{
                        type: 'text',
                        text: `📦 Current inventory for environment "${args.environment}" in application "${args.application}":\n\n${inventoryList}`
                    }]
                };
            } else {
                return {
                    content: [{
                        type: 'text',
                        text: `📦 No inventory found for environment "${args.environment}" in application "${args.application}"`
                    }]
                };
            }
        } catch (error) {
            return {
                content: [{
                    type: 'text',
                    text: `❌ Failed to retrieve inventory: ${error.message}`
                }]
            };
        }
    }
);

// Tool 5: Create snapshot from environment
server.tool(
    "create_snapshot_from_environment",
    "Create a new snapshot based on current environment state",
    {
        application: z.string().describe("Application ID from list_applications. REQUIRED: Must use ID, not name."),
        environment: z.string().describe("Environment ID from list_environments_for_application. REQUIRED: Must use ID, not name."),
        name: z.string().describe("Name for the new snapshot"),
        description: z.string().optional().describe("Optional description for the snapshot")
    },
    async (args) => {
        try {
            const requestBody = {
                application: args.application,
                environment: args.environment,
                name: args.name
            };

            if (args.description) {
                requestBody.description = args.description;
            }

            const result = await makeApiCall('/snapshot/createSnapshotOfEnvironment', 'POST', requestBody);
            
            return {
                content: [{
                    type: 'text',
                    text: `✅ Snapshot created successfully!\n\nSnapshot Name: ${args.name}\nSource Environment: ${args.environment}\nApplication: ${args.application}\n\nSnapshot ID: ${result.id || 'N/A'}`
                }]
            };
        } catch (error) {
            return {
                content: [{
                    type: 'text',
                    text: `❌ Failed to create snapshot: ${error.message}`
                }]
            };
        }
    }
);

// Tool 6: Get deployment status
server.tool(
    "get_deployment_status",
    "Check status of a running or completed deployment",
    {
        requestId: z.string().describe("Request ID from a previous deployment")
    },
    async (args) => {
        try {
            const result = await makeApiCall(`/applicationProcessRequest/requestStatus?request=${encodeURIComponent(args.requestId)}`);
            
            const status = result.status || 'Unknown';
            const result_status = result.result || 'Unknown';
            
            return {
                content: [{
                    type: 'text',
                    text: `📊 Deployment Status for Request ID: ${args.requestId}\n\nStatus: ${status}\nResult: ${result_status}\n\nDetails:\n${JSON.stringify(result, null, 2)}`
                }]
            };
        } catch (error) {
            return {
                content: [{
                    type: 'text',
                    text: `❌ Failed to get deployment status: ${error.message}`
                }]
            };
        }
    }
);

// Tool 7: Schedule deployment
server.tool(
    "schedule_deployment",
    "Schedule a deployment for future execution",
    {
        application: z.string().describe("Application ID from list_applications. REQUIRED: Must use ID, not name."),
        environment: z.string().describe("Environment ID from list_environments_for_application. REQUIRED: Must use ID, not name."),
        applicationProcess: z.string().describe("Application process ID. REQUIRED: Must use ID, not name."),
        date: z.string().describe("Date and time to schedule the process (format: yyyy-mm-dd HH:mm or unix timestamp)"),
        snapshot: z.string().optional().describe("Snapshot ID from list_application_snapshots (optional if using versions). REQUIRED: Must use ID, not name."),
        versions: z.array(z.object({
            component: z.string().describe("Component ID. REQUIRED: Must use ID, not name."),
            version: z.string().describe("Version ID. REQUIRED: Must use ID, not name.")
        })).optional().describe("Array of component/version pairs to deploy (optional if using snapshot)"),
        description: z.string().optional().describe("Optional description for the deployment request"),
        recurrencePattern: z.enum(['D', 'W', 'M']).optional().describe("Recurrence pattern: D (daily), W (weekly), M (monthly)")
    },
    async (args) => {
        try {
            const requestBody = {
                application: args.application,
                environment: args.environment,
                applicationProcess: args.applicationProcess,
                date: args.date
            };

            if (args.snapshot) {
                requestBody.snapshot = args.snapshot;
            }

            if (args.versions) {
                requestBody.versions = args.versions;
            }

            if (args.description) {
                requestBody.description = args.description;
            }

            if (args.recurrencePattern) {
                requestBody.recurrencePattern = args.recurrencePattern;
            }

            const result = await makeApiCall('/applicationProcessRequest', 'POST', requestBody);
            
            return {
                content: [{
                    type: 'text',
                    text: `✅ Deployment scheduled successfully!\n\nRequest ID: ${result.requestId || 'N/A'}\nScheduled Time: ${args.date}\nApplication: ${args.application}\nEnvironment: ${args.environment}\nProcess: ${args.applicationProcess}\n${args.recurrencePattern ? `Recurrence: ${args.recurrencePattern}\n` : ''}\nUse get_deployment_status with the request ID to monitor progress.`
                }]
            };
        } catch (error) {
            return {
                content: [{
                    type: 'text',
                    text: `❌ Failed to schedule deployment: ${error.message}`
                }]
            };
        }
    }
);

// Tool 8: List environments for application (REQUIRED SECOND STEP)
server.tool(
    "list_environments_for_application",
    "Get all environments configured for an application. ALWAYS call this after list_applications to get environment IDs before deploying.",
    {
        application: z.string().describe("Application ID obtained from list_applications. DO NOT use application names - use IDs only.")
    },
    async (args) => {
        try {
            const result = await makeApiCall(`/application/environmentsInApplication?application=${encodeURIComponent(args.application)}`);
            
            if (result && Array.isArray(result)) {
                const envList = result.map(env => 
                    `- ${env.name} (ID: ${env.id || 'N/A'}) - State: ${env.state || 'Unknown'}`
                ).join('\n');
                
                return {
                    content: [{
                        type: 'text',
                        text: `🌍 Found ${result.length} environments for application "${args.application}":\n\n${envList}\n\n💡 CRITICAL: ALWAYS use the environment IDs (shown in parentheses) for all deployment operations - NOT the names.`
                    }]
                };
            } else {
                return {
                    content: [{
                        type: 'text',
                        text: `🌍 No environments found for application "${args.application}"`
                    }]
                };
            }
        } catch (error) {
            return {
                content: [{
                    type: 'text',
                    text: `❌ Failed to retrieve environments: ${error.message}`
                }]
            };
        }
    }
);

// Tool 10: Compare environment snapshots
server.tool(
    "compare_environment_snapshots",
    "Compare deployed versions between environments or against a snapshot",
    {
        application: z.string().describe("Application ID from list_applications. REQUIRED: Must use ID, not name."),
        sourceEnvironment: z.string().describe("Environment ID from list_environments_for_application. REQUIRED: Must use ID, not name."),
        targetEnvironment: z.string().optional().describe("Environment ID from list_environments_for_application (use this OR targetSnapshot). REQUIRED: Must use ID, not name."),
        targetSnapshot: z.string().optional().describe("Snapshot ID from list_application_snapshots (use this OR targetEnvironment). REQUIRED: Must use ID, not name.")
    },
    async (args) => {
        try {
            if (!args.targetEnvironment && !args.targetSnapshot) {
                throw new Error("Either targetEnvironment or targetSnapshot must be provided");
            }

            // Get source environment inventory
            const sourceResult = await makeApiCall(`/environment/${encodeURIComponent(args.sourceEnvironment)}/latestDesiredInventory/?application=${encodeURIComponent(args.application)}`);
            
            let targetResult;
            let targetType;
            let targetName;

            if (args.targetEnvironment) {
                targetResult = await makeApiCall(`/environment/${encodeURIComponent(args.targetEnvironment)}/latestDesiredInventory/?application=${encodeURIComponent(args.application)}`);
                targetType = "Environment";
                targetName = args.targetEnvironment;
            } else {
                targetResult = await makeApiCall(`/snapshot/getSnapshotVersions?snapshot=${encodeURIComponent(args.targetSnapshot)}`);
                targetType = "Snapshot";
                targetName = args.targetSnapshot;
            }

            // Compare the inventories
            const sourceComponents = sourceResult.components || [];
            const targetComponents = targetResult.components || [];

            const differences = [];
            const sourceMap = new Map(sourceComponents.map(c => [c.name, c.version]));
            const targetMap = new Map(targetComponents.map(c => [c.name, c.version]));

            // Find differences
            for (const [component, sourceVersion] of sourceMap) {
                const targetVersion = targetMap.get(component);
                if (!targetVersion) {
                    differences.push(`- ${component}: ${sourceVersion} → NOT DEPLOYED`);
                } else if (sourceVersion !== targetVersion) {
                    differences.push(`- ${component}: ${sourceVersion} → ${targetVersion}`);
                }
            }

            // Find components only in target
            for (const [component, targetVersion] of targetMap) {
                if (!sourceMap.has(component)) {
                    differences.push(`- ${component}: NOT DEPLOYED → ${targetVersion}`);
                }
            }

            const comparisonText = differences.length > 0 
                ? differences.join('\n')
                : "No differences found - inventories are identical";

            return {
                content: [{
                    type: 'text',
                    text: `🔍 Comparison Results\n\nSource Environment: ${args.sourceEnvironment}\n${targetType}: ${targetName}\nApplication: ${args.application}\n\nDifferences:\n${comparisonText}`
                }]
            };
        } catch (error) {
            return {
                content: [{
                    type: 'text',
                    text: `❌ Failed to compare inventories: ${error.message}`
                }]
            };
        }
    }
);

// Tool 11: Create deployment trigger
server.tool(
    "create_deployment_trigger",
    "Set up automated deployment triggers",
    {
        environment: z.string().describe("Environment ID from list_environments_for_application. REQUIRED: Must use ID, not name."),
        name: z.string().describe("Name for the deployment trigger"),
        applicationProcess: z.string().describe("Application process ID. REQUIRED: Must use ID, not name."),
        description: z.string().optional().describe("Optional description for the trigger"),
        triggerType: z.enum(['VERSION_CHANGE', 'SCHEDULE']).describe("Type of trigger: VERSION_CHANGE or SCHEDULE"),
        schedulePattern: z.string().optional().describe("Schedule pattern for SCHEDULE triggers (cron format)")
    },
    async (args) => {
        try {
            const requestBody = {
                environment: args.environment,
                name: args.name,
                applicationProcess: args.applicationProcess,
                triggerType: args.triggerType
            };

            if (args.description) {
                requestBody.description = args.description;
            }

            if (args.schedulePattern && args.triggerType === 'SCHEDULE') {
                requestBody.schedulePattern = args.schedulePattern;
            }

            const result = await makeApiCall('/deploymentTrigger', 'POST', requestBody);
            
            return {
                content: [{
                    type: 'text',
                    text: `✅ Deployment trigger created successfully!\n\nTrigger Name: ${args.name}\nEnvironment: ${args.environment}\nProcess: ${args.applicationProcess}\nType: ${args.triggerType}\n${args.schedulePattern ? `Schedule: ${args.schedulePattern}\n` : ''}\nTrigger ID: ${result.id || 'N/A'}`
                }]
            };
        } catch (error) {
            return {
                content: [{
                    type: 'text',
                    text: `❌ Failed to create deployment trigger: ${error.message}`
                }]
            };
        }
    }
);

// Tool 12: List all applications (REQUIRED FIRST STEP)
server.tool(
    "list_applications",
    "Get information about all applications on the server. ALWAYS call this first to get application IDs before using any other deployment functions.",
    {},
    async () => {
        try {
            const result = await makeApiCall('/application');
            
            if (result && Array.isArray(result)) {
                const appList = result.map(app => 
                    `- ${app.name} (ID: ${app.id || 'N/A'}) - ${app.description || 'No description'}`
                ).join('\n');
                
                return {
                    content: [{
                        type: 'text',
                        text: `🚀 Found ${result.length} applications:\n\n${appList}\n\n💡 CRITICAL: ALWAYS use the application IDs (shown in parentheses) for all subsequent API calls - NOT the names.`
                    }]
                };
            } else {
                return {
                    content: [{
                        type: 'text',
                        text: `🚀 No applications found`
                    }]
                };
            }
        } catch (error) {
            return {
                content: [{
                    type: 'text',
                    text: `❌ Failed to retrieve applications: ${error.message}`
                }]
            };
        }
    }
);

// Diagnostic Tool: Authentication diagnostics
server.tool(
    "auth_diagnostics",
    "Run authentication diagnostics to determine current auth method and validity",
    {},
    async () => {
        const details = [];
        try {
            // Force authentication to determine the correct method
            if (!useDeployTokenFormat && authToken) {
                details.push('Running initial authentication to determine token format...');
                await authenticate();
            }

            const headers = await getAuthHeaders();
            const method = useDeployTokenFormat ? 'deploy-token-format' : 'bearer-token';
            details.push(`Auth method in use: ${method}`);
            if (authExpiry) details.push(`Auth expiry (approx): ${new Date(authExpiry).toISOString()}`);

            // Attempt lightweight API call
            let appCount = 'n/a';
            try {
                const apps = await makeApiCall('/application');
                if (Array.isArray(apps)) appCount = `${apps.length}`;
                details.push(`Test API call succeeded. Applications visible: ${appCount}`);
            } catch (e) {
                details.push(`Test API call failed: ${e.message}`);
            }

            // Redact sensitive values
            const redactedHeaders = Object.fromEntries(Object.entries(headers).map(([k,v]) => {
                if (/authorization/i.test(k)) {
                    return [k, '[REDACTED]'];
                }
                return [k,v];
            }));

            return {
                content: [{
                    type: 'text',
                    text: `🔎 Authentication Diagnostics\n\n${details.join('\n')}\n\nHeaders (redacted):\n${JSON.stringify(redactedHeaders, null, 2)}`
                }]
            };
        } catch (error) {
            return {
                content: [{
                    type: 'text',
                    text: `❌ Diagnostics failed: ${error.message}`
                }]
            };
        }
    }
);

// Start the server
const transport = new StdioServerTransport();
await server.connect(transport);

console.log("🚀 MCP Deploy Automation Server started");
console.log("🔗 Server URL:", serverURL);
if (token) {
    console.log("🔑 Using provided access token");
    if (useSimpleTokenAuth) {
        console.log('   (will exchange via SimpleAuth)');
    }
} else {
    console.log("❌ No token provided");
}
console.log("\n📋 Available Tools:")
console.log("  1. deploy_snapshot_to_environment - Deploy a snapshot to an environment");
console.log("  2. deploy_component_versions - Deploy specific component versions");
console.log("  3. list_application_snapshots - List available snapshots");
console.log("  4. list_environment_inventory - Check current deployments");
console.log("  5. create_snapshot_from_environment - Create snapshot from environment");
console.log("  6. get_deployment_status - Monitor deployment progress");
console.log("  7. schedule_deployment - Schedule future deployments");
console.log("  8. list_environments_for_application - List application environments");
console.log("  9. compare_environment_snapshots - Compare inventories");
console.log("  10. create_deployment_trigger - Set up automated triggers");
console.log("  11. list_applications - List all applications");
console.log("\n✅ Ready to handle deployment requests!");


