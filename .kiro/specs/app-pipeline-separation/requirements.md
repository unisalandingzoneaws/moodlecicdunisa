# Requirements Document

## Introduction

This feature separates infrastructure deployment from application deployment in the Moodle CDK project. Currently, the single `CodePipelineStack` watches the CDK repository and deploys both `NetworkStack` and `ApplicationStack` together — meaning every infrastructure change triggers an application redeployment, and deploying a new application version requires modifying CDK code. The Moodle application code is baked into the ASG UserData, with no independent CI/CD for the application itself.

The solution introduces a new `AppPipelineStack` that creates a CodePipeline watching a separate application code repository. This pipeline uses AWS CodeDeploy for in-place deployments to the existing ASG. The `ApplicationStack` UserData is stripped down to install only base OS dependencies (Apache, PHP), while application code deployment is handled entirely by CodeDeploy. A separate application repository contains the Moodle source code, CodeDeploy `appspec.yml`, and deployment lifecycle scripts.

After this change, two independent deployment paths exist:
- **Infrastructure pipeline** (existing `CodePipelineStack`): Watches the CDK repo, deploys `NetworkStack` and `ApplicationStack` (compute platform only).
- **Application pipeline** (new `AppPipelineStack`): Watches the app repo, builds and deploys Moodle code to the ASG via CodeDeploy.

## Glossary

- **CodePipelineStack**: The existing CDK pipeline stack in `lib/pipeline-stack.ts` that watches the CDK repository and deploys infrastructure stacks. Also called the infrastructure pipeline.
- **AppPipelineStack**: A new CDK stack in `lib/app-pipeline-stack.ts` that creates a CodePipeline watching the application code repository and deploying via CodeDeploy. Also called the application pipeline.
- **ApplicationStack**: The CDK stack in `lib/application-stack.ts` containing stateless compute resources (ALB, ASG, security groups). Modified to install only base OS dependencies in UserData and to create CodeDeploy resources (Application, Deployment Group).
- **NetworkStack**: The CDK stack in `lib/network-stack.ts` containing stateful resources (VPC, EFS, Aurora MySQL). Unchanged by this feature.
- **App_Repository**: A CodeCommit repository created by the `AppPipelineStack` that holds Moodle application source code, `appspec.yml`, and CodeDeploy lifecycle scripts.
- **CodeDeploy_Application**: An AWS CodeDeploy application resource created in the `ApplicationStack` for managing deployments to the ASG.
- **CodeDeploy_Deployment_Group**: An AWS CodeDeploy deployment group associated with the ASG, using in-place deployment with health checks.
- **AppSpec_File**: The `appspec.yml` file in the App_Repository that defines CodeDeploy lifecycle hooks and file mappings for deploying Moodle to EC2 instances.
- **Lifecycle_Scripts**: Shell scripts in the App_Repository (`scripts/install.sh`, `scripts/start.sh`, `scripts/stop.sh`, `scripts/validate.sh`) executed by CodeDeploy during deployment lifecycle hooks.
- **Base_Dependencies**: Operating system packages (Apache httpd, PHP, PHP extensions, CodeDeploy agent, NFS utilities) installed via UserData at instance boot time, independent of application code.
- **Deployment_Stage**: The CDK Stage in `lib/stages.ts` that instantiates `NetworkStack`, `ApplicationStack`, and `AppPipelineStack` for a given environment.
- **Health_Check**: An HTTP request to the ALB endpoint that returns a status code between 200 and 399, used to verify application availability after deployment.

## Requirements

### Requirement 1: Strip Application Code from UserData

**User Story:** As a platform engineer, I want the ASG UserData to install only base operating system dependencies, so that application code deployment is fully decoupled from infrastructure provisioning.

#### Acceptance Criteria

1. THE ApplicationStack UserData SHALL install Apache httpd, PHP, and required PHP extensions as Base_Dependencies.
2. THE ApplicationStack UserData SHALL install the AWS CodeDeploy agent so that instances can receive CodeDeploy deployments.
3. THE ApplicationStack UserData SHALL install NFS utilities and mount the EFS file system to the Moodle data directory.
4. THE ApplicationStack UserData SHALL NOT download, install, or configure Moodle application source code.
5. THE ApplicationStack UserData SHALL NOT generate or write a Moodle `config.php` file.
6. THE ApplicationStack UserData SHALL start and enable the Apache httpd and CodeDeploy agent services.

### Requirement 2: CodeDeploy Resources in ApplicationStack

**User Story:** As a platform engineer, I want CodeDeploy resources created as part of the ApplicationStack, so that the compute platform is ready to receive application deployments from the application pipeline.

#### Acceptance Criteria

1. THE ApplicationStack SHALL create exactly one CodeDeploy_Application with the compute platform set to Server.
2. THE ApplicationStack SHALL create exactly one CodeDeploy_Deployment_Group associated with the ASG.
3. THE CodeDeploy_Deployment_Group SHALL use in-place deployment configuration.
4. THE CodeDeploy_Deployment_Group SHALL be configured with an ALB target group for traffic management during deployments.
5. THE ApplicationStack SHALL grant the ASG instance role permissions required by the CodeDeploy agent to communicate with the CodeDeploy service.
6. THE ApplicationStack SHALL expose the CodeDeploy_Application name and CodeDeploy_Deployment_Group name as public readonly properties for consumption by the AppPipelineStack.
7. THE ApplicationStack SHALL produce CloudFormation outputs for the CodeDeploy_Application name and CodeDeploy_Deployment_Group name.

### Requirement 3: Application Pipeline Stack

**User Story:** As a platform engineer, I want a new AppPipelineStack that creates a CodePipeline watching the application repository, so that application code changes trigger automated build and deployment without touching CDK infrastructure.

#### Acceptance Criteria

1. THE AppPipelineStack SHALL create exactly one CodeCommit App_Repository for application source code.
2. THE AppPipelineStack SHALL create exactly one CodePipeline that uses the App_Repository main branch as its source.
3. THE AppPipelineStack SHALL accept the CodeDeploy_Application name and CodeDeploy_Deployment_Group name as input properties from the ApplicationStack.
4. THE CodePipeline SHALL contain a Build stage that packages the application source code into a deployment artifact using CodeBuild.
5. THE CodePipeline SHALL contain a Deploy stage that uses a CodeDeploy deploy action to deploy the build artifact to the CodeDeploy_Deployment_Group.
6. THE AppPipelineStack SHALL produce a CloudFormation output named `AppRepositoryName` containing the App_Repository name.
7. THE AppPipelineStack SHALL produce a CloudFormation output named `AppRepositoryCloneUrl` containing the App_Repository HTTPS clone URL.

### Requirement 4: Post-Deployment Health Check in Application Pipeline

**User Story:** As a DevOps engineer, I want the application pipeline to validate deployment success with a health check, so that failed application deployments are detected automatically without relying on the infrastructure pipeline.

#### Acceptance Criteria

1. THE AppPipelineStack CodePipeline SHALL contain a Validate stage after the Deploy stage.
2. THE Validate stage SHALL execute a CodeBuild step that performs an HTTP Health_Check against the ALB endpoint.
3. THE AppPipelineStack SHALL accept the ALB DNS name as an input property from the ApplicationStack.
4. THE Health_Check SHALL succeed when the HTTP response status code is between 200 and 399.
5. IF the Health_Check fails after a configurable number of retries, THEN THE Validate stage SHALL report failure and the pipeline SHALL halt.

### Requirement 5: Application Repository Structure

**User Story:** As a developer, I want a well-defined application repository structure with CodeDeploy configuration and lifecycle scripts, so that pushing code to the app repo triggers a complete deployment lifecycle.

#### Acceptance Criteria

1. THE App_Repository SHALL contain an AppSpec_File (`appspec.yml`) at the repository root that defines file mappings and lifecycle hooks for CodeDeploy.
2. THE AppSpec_File SHALL map application source files to the appropriate destination directory on EC2 instances.
3. THE App_Repository SHALL contain a `scripts/stop.sh` Lifecycle_Script that stops the Apache httpd service before deployment.
4. THE App_Repository SHALL contain a `scripts/install.sh` Lifecycle_Script that installs Moodle application files, retrieves Aurora credentials from Secrets Manager, and generates the Moodle `config.php`.
5. THE App_Repository SHALL contain a `scripts/start.sh` Lifecycle_Script that starts the Apache httpd service after deployment.
6. THE App_Repository SHALL contain a `scripts/validate.sh` Lifecycle_Script that performs a local health check to confirm the application is serving requests.
7. THE AppSpec_File SHALL reference the Lifecycle_Scripts in the correct CodeDeploy hook order: BeforeInstall (stop), AfterInstall (install), ApplicationStart (start), ValidateService (validate).

### Requirement 6: Deployment Stage Updated for AppPipelineStack

**User Story:** As a platform engineer, I want the Deployment_Stage to include the AppPipelineStack alongside the existing infrastructure stacks, so that the application pipeline is provisioned as part of the standard infrastructure deployment.

#### Acceptance Criteria

1. THE Deployment_Stage SHALL instantiate the AppPipelineStack in addition to the NetworkStack and ApplicationStack.
2. THE Deployment_Stage SHALL pass the CodeDeploy_Application name, CodeDeploy_Deployment_Group name, and ALB DNS name from the ApplicationStack to the AppPipelineStack.
3. THE AppPipelineStack SHALL declare an explicit CDK dependency on the ApplicationStack so that CloudFormation deploys the ApplicationStack first.

### Requirement 7: Infrastructure Pipeline Isolation

**User Story:** As a DevOps engineer, I want changes to the CDK infrastructure repository to deploy only infrastructure stacks, so that infrastructure updates do not trigger application redeployments.

#### Acceptance Criteria

1. THE CodePipelineStack SHALL continue to deploy the NetworkStack, ApplicationStack, and AppPipelineStack through the Deployment_Stage.
2. THE CodePipelineStack SHALL NOT contain any CodeDeploy deploy actions or application deployment steps.
3. WHEN the CDK repository is updated and the infrastructure pipeline runs, THE pipeline SHALL NOT trigger a deployment in the application pipeline.
4. THE application pipeline SHALL only be triggered by commits to the App_Repository, not by infrastructure pipeline executions.

### Requirement 8: Standalone Entry Point Update

**User Story:** As a developer, I want the CDK app entry point to include the AppPipelineStack for manual deployments, so that I can deploy the complete infrastructure including the application pipeline outside the CI/CD pipeline.

#### Acceptance Criteria

1. WHEN the CDK app entry point is executed, THE entry point SHALL create a standalone AppPipelineStack with the identifier `Dev-AppPipelineStack` that receives CodeDeploy and ALB properties from the standalone ApplicationStack.
2. THE entry point SHALL maintain the existing standalone NetworkStack (`Dev-NetworkStack`), ApplicationStack (`Dev-ApplicationStack`), and CodePipelineStack (`CodePipeline`).

### Requirement 9: Unit Tests for New and Modified Stacks

**User Story:** As a developer, I want unit tests covering the new AppPipelineStack and the modified ApplicationStack, so that changes to the deployment architecture are validated before deployment.

#### Acceptance Criteria

1. THE ApplicationStack test suite SHALL verify the presence of exactly one CodeDeploy Application resource with Server compute platform.
2. THE ApplicationStack test suite SHALL verify the presence of exactly one CodeDeploy Deployment Group resource associated with the ASG.
3. THE ApplicationStack test suite SHALL verify that CloudFormation outputs for the CodeDeploy Application name and Deployment Group name exist.
4. THE AppPipelineStack test suite SHALL verify the presence of exactly one CodeCommit repository resource.
5. THE AppPipelineStack test suite SHALL verify the presence of exactly one CodePipeline resource.
6. THE AppPipelineStack test suite SHALL verify that the CodePipeline contains Source, Build, Deploy, and Validate stages.
7. THE AppPipelineStack test suite SHALL verify that CloudFormation outputs `AppRepositoryName` and `AppRepositoryCloneUrl` exist.
8. THE pipeline stack test suite SHALL continue to pass with updated resource counts reflecting the addition of the AppPipelineStack to the Deployment_Stage.

### Requirement 10: ASG Instance Role Permissions for CodeDeploy and Secrets Manager

**User Story:** As a platform engineer, I want the ASG instance role to have the minimum permissions required for CodeDeploy agent operation and Secrets Manager access, so that deployments work securely without overly broad IAM policies.

#### Acceptance Criteria

1. THE ApplicationStack SHALL grant the ASG instance role permissions to communicate with the CodeDeploy service, including actions for polling deployments and reporting status.
2. THE ApplicationStack SHALL grant the ASG instance role read permission to the Aurora cluster generated secret so that Lifecycle_Scripts can retrieve database credentials.
3. THE ApplicationStack SHALL grant the ASG instance role permission to download deployment artifacts from the S3 bucket used by the application pipeline.
4. THE ASG instance role SHALL NOT have permissions beyond what is required for CodeDeploy agent operation, Secrets Manager read access, and S3 artifact retrieval.
