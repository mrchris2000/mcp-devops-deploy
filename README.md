# MCP Deploy Automation

A Model Context Protocol (MCP) server for deployment automation. This server provides tools to manage deployments, environments, snapshots, and applications through DevOps Deploy's REST API.

## Features

- **🚀 Quick Deployments**: Deploy snapshots or specific component versions to any environment
- **📸 Snapshot Management**: Create, list, and deploy snapshots
- **🌍 Environment Management**: Discover and manage application environments
- **📊 Deployment Monitoring**: Track deployment status and progress
- **⏰ Scheduling**: Schedule deployments for future execution
- **🔄 Automation**: Set up deployment triggers and recurring deployments
- **📋 Inventory Tracking**: See what's deployed where and compare environments

## Prerequisites

- Node.js 18.0.0 or higher
- Access to an DevOps Deploy server
- Valid Deploy server access token

## Installation

```bash
npm install @securedevops/mcp-deploy-automation
```

## Configuration

Set up environment variables or provide command line arguments:

### Environment Variables
```bash
export DEPLOY_SERVER_URL="https://your-deploy-server:8443"
export DEPLOY_TOKEN="your-access-token"
```

## Best Practices

### 🔑 Use IDs Instead of Names
For better reliability and compatibility, always prefer using IDs over names when available:

1. **Start with discovery tools**: Use `list_applications` to get application IDs
2. **Get environment IDs**: Use `list_environments_for_application` to get environment IDs
3. **Get snapshot IDs**: Use `list_application_snapshots` to get snapshot IDs
4. **Use IDs in deployment operations**: This avoids naming conflicts and ensures accuracy

**Example workflow**:
```
1. list_applications → Get application ID
2. list_environments_for_application → Get environment IDs  
3. deploy_snapshot_to_environment using IDs instead of names
```

The tools will display both names and IDs in their output, making it easy to copy the IDs for subsequent operations.

## Example Use Cases

### 1. Automated Production Deployment
**Scenario**: You need to deploy a tested snapshot to production environment during a maintenance window.

**Steps**:
1. "List all applications to find my target application"
### 2. Environment Promotion Pipeline
**Scenario**: You need to promote code through development → staging → production environments.

**Steps**:
1. "Compare staging environment with production to see what changes are pending"
2. "Create a snapshot from the current staging environment called 'release-candidate-v2.1.4'"
3. "Deploy the snapshot to production environment using the 'Production Deploy' process"
4. "Monitor deployment status and ensure successful completion"
5. "Verify production inventory matches the deployed snapshot"

**Benefits**: Safe, controlled promotion through environments with full visibility and verification.

### 3. Scheduled Maintenance Deployment
**Scenario**: You need to schedule critical updates during off-hours maintenance windows.

**Steps**:
1. "List all environments for the 'Banking Platform' application"
2. "Schedule deployment of 'security-patch-v1.2.1' snapshot to production for tomorrow at 2:00 AM"
3. "Set up a deployment trigger for automatic rollback if deployment fails"
4. "Schedule weekly recurring deployments for the staging environment"

**Benefits**: Automated deployment scheduling reduces manual intervention and ensures deployments happen during optimal times.

## Available Tools

### 1. **deploy_snapshot_to_environment**
Deploy a named snapshot to a specific environment.

**Parameters:**
- `application` - Name or ID of the application
- `snapshot` - Name or ID of the snapshot to deploy
- `environment` - Name or ID of the target environment
- `applicationProcess` - Name or ID of the application process
- `description` (optional) - Description for the deployment
- `onlyChanged` (optional) - Deploy only changed versions (default: true)

### 2. **deploy_component_versions**
Deploy specific component versions to an environment.

**Parameters:**
- `application` - Name or ID of the application
- `environment` - Name or ID of the target environment
- `applicationProcess` - Name or ID of the application process
- `versions` - Array of component/version pairs
- `description` (optional) - Description for the deployment
- `onlyChanged` (optional) - Deploy only changed versions (default: true)

### 3. **list_application_snapshots**
Get all available snapshots for an application.

**Parameters:**
- `application` - Name or ID of the application

### 4. **list_environment_inventory**
Get current deployed versions in an environment.

**Parameters:**
- `application` - Name or ID of the application
- `environment` - Name or ID of the environment

### 5. **create_snapshot_from_environment**
Create a new snapshot based on current environment state.

**Parameters:**
- `application` - Name or ID of the application
- `environment` - Name or ID of the source environment
- `name` - Name for the new snapshot
- `description` (optional) - Description for the snapshot

### 6. **get_deployment_status**
Check status of a running or completed deployment.

**Parameters:**
- `requestId` - Request ID from a previous deployment

### 7. **schedule_deployment**
Schedule a deployment for future execution.

**Parameters:**
- `application` - Name or ID of the application
- `environment` - Name or ID of the target environment
- `applicationProcess` - Name or ID of the application process
- `date` - Date and time to schedule (yyyy-mm-dd HH:mm or unix timestamp)
- `snapshot` (optional) - Snapshot to deploy
- `versions` (optional) - Component versions to deploy
- `description` (optional) - Description for the deployment
- `recurrencePattern` (optional) - Recurrence: D (daily), W (weekly), M (monthly)

### 8. **list_environments_for_application**
Get all environments configured for an application.

**Parameters:**
- `application` - Name or ID of the application

### 9. **compare_environment_snapshots**
Compare deployed versions between environments or against a snapshot.

**Parameters:**
- `application` - Name or ID of the application
- `sourceEnvironment` - Name or ID of the source environment
- `targetEnvironment` (optional) - Name or ID of the target environment
- `targetSnapshot` (optional) - Name or ID of the target snapshot

### 10. **create_deployment_trigger**
Set up automated deployment triggers.

**Parameters:**
- `environment` - Name or ID of the environment
- `name` - Name for the deployment trigger
- `applicationProcess` - Name or ID of the application process
- `description` (optional) - Description for the trigger
- `triggerType` - Type: VERSION_CHANGE or SCHEDULE
- `schedulePattern` (optional) - Schedule pattern for SCHEDULE triggers

### 11. **list_applications**
Get information about all applications on the server.

**Parameters:** None

## Error Handling

The server provides detailed error messages and will indicate:
- Authentication failures
- Invalid application/environment names
- Network connectivity issues
- API response errors

## Development

To run the server in development mode:

```bash
git clone https://github.com/securedevops/mcp-deploy-automation.git
cd mcp-deploy-automation
npm install
npm start
```

## License

ISC License

## Contributing

Contributions are welcome! Please read our contributing guidelines and submit pull requests to our GitHub repository.

## Support

For issues and questions:
- GitHub Issues: https://github.com/securedevops/mcp-deploy-automation/issues
- Documentation: https://github.com/securedevops/mcp-deploy-automation#readme
