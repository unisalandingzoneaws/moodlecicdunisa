# Requirements Document

## Introduction

This feature transforms the existing AWS CodePipeline CI/CD sample project into a lightweight Moodle development deployment pipeline. The current multi-stage pipeline (Dev/Test/Prod) with a sample EventBus stack will be trimmed to a Dev-only pipeline. The sample EventBus infrastructure will be replaced with a Moodle application stack consisting of an Auto Scaling Group (ASG) running Moodle on EC2 instances, an Application Load Balancer (ALB) for traffic distribution, an Elastic File System (EFS) for shared storage, and an Amazon Aurora MySQL-Compatible Serverless v2 cluster for the database backend. EFS is chosen as a lighter, more cost-effective alternative to FSx for development workloads, and Aurora Serverless v2 is chosen for its ability to scale capacity down for dev workloads while providing MySQL compatibility. The CI/CD pipeline retains its existing pre-deployment checks (linting, unit testing, security scanning) and post-deployment validation, adapted for the Moodle infrastructure.

## Glossary

- **Pipeline**: The AWS CodePipeline CI/CD pipeline that orchestrates source, build, and deployment stages for the Moodle dev environment.
- **Dev_Stage**: The single deployment stage in the pipeline targeting the development environment.
- **Moodle_Stack**: The CDK stack containing all Moodle infrastructure resources (VPC, ASG, ALB, EFS, Aurora_MySQL, security groups).
- **ASG**: The EC2 Auto Scaling Group that runs Moodle application instances.
- **ALB**: The Application Load Balancer that distributes HTTP/HTTPS traffic across Moodle instances in the ASG.
- **EFS**: The Elastic File System providing shared persistent storage for Moodle data files (e.g., moodledata directory) across all EC2 instances.
- **VPC**: The Virtual Private Cloud network containing all Moodle infrastructure resources with public and private subnets.
- **Aurora_MySQL**: The Amazon Aurora MySQL-Compatible Serverless v2 database cluster used as the Moodle database backend.
- **Security_Group**: AWS security groups controlling network access between ALB, ASG instances, EFS, and Aurora_MySQL.
- **Synth_Step**: The CDK synthesis step that compiles TypeScript and generates CloudFormation templates.
- **Linting_Step**: The pre-deployment CodeBuild step that runs ESLint on the codebase.
- **UnitTest_Step**: The pre-deployment CodeBuild step that runs Jest unit tests with coverage reporting.
- **Security_Step**: The pre-deployment CodeBuild step that runs cfn-nag security scanning on synthesized templates.
- **Validation_Step**: The post-deployment CodeBuild step that verifies the deployed Moodle infrastructure is operational.
- **UserData_Script**: The EC2 instance bootstrap script that installs and configures Moodle on launch.

## Requirements

### Requirement 1: Pipeline Trimmed to Dev Stage Only

**User Story:** As a developer, I want the CI/CD pipeline to deploy only to a Dev stage, so that I have a lightweight pipeline focused on development iteration without unnecessary Test and Prod stages.

#### Acceptance Criteria

1. THE Pipeline SHALL contain exactly one deployment stage named Dev_Stage.
2. WHEN the Pipeline is synthesized, THE Pipeline SHALL not produce CloudFormation resources for Test or Prod deployment stages.
3. THE Pipeline SHALL use CodePipelineSource.codeCommit as the source action reading from the main branch of the CodeCommit repository.
4. THE Synth_Step SHALL execute `make warming` as an install command and `make build` as the build command.

### Requirement 2: Pre-Deployment CI Checks

**User Story:** As a developer, I want linting, unit testing, and security scanning to run before every deployment, so that only validated code reaches the Dev environment.

#### Acceptance Criteria

1. WHEN the Pipeline executes the Dev_Stage, THE Pipeline SHALL run the Linting_Step, UnitTest_Step, and Security_Step in parallel before deployment begins.
2. THE Linting_Step SHALL execute ESLint via `make linting` after running `make warming` as an install command.
3. THE UnitTest_Step SHALL execute Jest tests via `make unittest` after running `make warming` as an install command.
4. THE UnitTest_Step SHALL publish test coverage reports in CLOVERXML format and test results in JUNITXML format to CodeBuild report groups.
5. THE Security_Step SHALL execute cfn-nag scanning via `make security` on the synthesized CloudFormation templates.
6. IF any pre-deployment step fails, THEN THE Pipeline SHALL halt and not proceed with the Dev_Stage deployment.

### Requirement 3: VPC Network Configuration

**User Story:** As a developer, I want the Moodle infrastructure deployed in a properly configured VPC, so that resources are network-isolated and follow AWS networking best practices.

#### Acceptance Criteria

1. THE Moodle_Stack SHALL create a VPC with public subnets and private subnets across at least 2 Availability Zones.
2. THE Moodle_Stack SHALL place the ALB in public subnets.
3. THE Moodle_Stack SHALL place the ASG instances, EFS mount targets, and Aurora_MySQL cluster in private subnets.
4. THE VPC SHALL include NAT Gateway resources to allow private subnet instances to access the internet for package installation.

### Requirement 4: Application Load Balancer

**User Story:** As a developer, I want an Application Load Balancer in front of the Moodle instances, so that HTTP traffic is distributed across healthy instances.

#### Acceptance Criteria

1. THE Moodle_Stack SHALL create an internet-facing ALB in the public subnets of the VPC.
2. THE ALB SHALL listen on port 80 for HTTP traffic.
3. THE ALB SHALL forward traffic to the ASG target group on port 80.
4. THE ALB SHALL perform health checks against the Moodle instances on a configurable health check path.
5. THE Security_Group for the ALB SHALL allow inbound traffic on port 80 from 0.0.0.0/0.
6. THE Security_Group for the ALB SHALL allow outbound traffic only to the ASG instances on port 80.

### Requirement 5: Auto Scaling Group for Moodle Instances

**User Story:** As a developer, I want Moodle running on an Auto Scaling Group of EC2 instances, so that the application can scale and recover from instance failures.

#### Acceptance Criteria

1. THE Moodle_Stack SHALL create an ASG with a minimum capacity of 1 instance and a maximum capacity of 2 instances for the dev environment.
2. THE ASG SHALL use Amazon Linux 2023 as the base AMI for EC2 instances.
3. THE ASG SHALL use a t3.medium instance type suitable for a dev Moodle workload.
4. THE ASG SHALL be associated with the ALB target group so that healthy instances receive traffic.
5. THE Security_Group for ASG instances SHALL allow inbound traffic on port 80 only from the ALB Security_Group.
6. THE Security_Group for ASG instances SHALL allow outbound traffic to the internet for package installation via NAT Gateway.
7. THE UserData_Script SHALL install Apache, PHP, and required PHP extensions for Moodle on instance launch.
8. THE UserData_Script SHALL download and configure Moodle from the official Moodle release.
9. THE UserData_Script SHALL mount the EFS file system to the Moodle data directory (moodledata).
10. THE UserData_Script SHALL configure Moodle to connect to the Aurora_MySQL database using the cluster endpoint and credentials.

### Requirement 6: Elastic File System for Shared Storage

**User Story:** As a developer, I want EFS as shared persistent storage for Moodle data files, so that all instances share the same moodledata directory without the cost of FSx.

#### Acceptance Criteria

1. THE Moodle_Stack SHALL create an EFS file system with the bursting throughput mode.
2. THE EFS SHALL use the General Purpose performance mode.
3. THE Moodle_Stack SHALL create EFS mount targets in each private subnet where ASG instances run.
4. THE Security_Group for EFS SHALL allow inbound NFS traffic (port 2049) only from the ASG Security_Group.
5. THE EFS SHALL have encryption at rest enabled.
6. WHEN an ASG instance launches, THE UserData_Script SHALL mount the EFS file system to the `/var/moodledata` directory using the NFS protocol.

### Requirement 7: Aurora MySQL Database for Moodle

**User Story:** As a developer, I want an Aurora MySQL-Compatible Serverless v2 database cluster for Moodle, so that application data is stored in a managed, cost-effective relational database that scales to near-zero for dev workloads.

#### Acceptance Criteria

1. THE Moodle_Stack SHALL create an Aurora MySQL-Compatible database cluster running MySQL 8.0 compatible engine.
2. THE Aurora_MySQL cluster SHALL use Serverless v2 capacity with a minimum of 0.5 ACU and a maximum of 2 ACU suitable for a dev workload.
3. THE Aurora_MySQL cluster SHALL be deployed in the private subnets of the VPC using a DB subnet group.
4. THE Security_Group for Aurora_MySQL SHALL allow inbound traffic on port 3306 only from the ASG Security_Group.
5. THE Aurora_MySQL cluster SHALL contain a single writer instance for the dev environment to reduce cost.
6. THE Aurora_MySQL cluster SHALL store database credentials in AWS Secrets Manager.
7. THE Aurora_MySQL cluster SHALL have automated backups enabled with a retention period of 1 day.
8. THE Aurora_MySQL cluster SHALL have deletion protection disabled for the dev environment to allow easy teardown.

### Requirement 8: Post-Deployment Validation

**User Story:** As a developer, I want automated validation after deployment, so that I can confirm the Moodle infrastructure is operational.

#### Acceptance Criteria

1. WHEN the Dev_Stage deployment completes, THE Pipeline SHALL execute the Validation_Step.
2. THE Validation_Step SHALL verify that the Moodle_Stack CloudFormation stack exists and is in a complete state.
3. THE Validation_Step SHALL verify that the ALB DNS name is available as a stack output.
4. THE Validation_Step SHALL perform an HTTP health check against the ALB endpoint and confirm a successful response.
5. IF the Validation_Step fails, THEN THE Pipeline SHALL report the deployment as failed.

### Requirement 9: CDK Stack Structure and Entry Point

**User Story:** As a developer, I want the CDK project structure updated to reflect the Moodle deployment, so that the codebase is clean and focused on the dev Moodle stack.

#### Acceptance Criteria

1. THE CDK app entry point (bin/code_pipeline.ts) SHALL instantiate the Pipeline stack and a standalone Dev Moodle_Stack for local development.
2. THE Deployment stage (lib/stages.ts) SHALL instantiate the Moodle_Stack instead of the previous EventBus MainStack.
3. THE Moodle_Stack (lib/main-stack.ts) SHALL replace all EventBus resources with Moodle infrastructure resources (VPC, ALB, ASG, EFS, Aurora_MySQL).
4. THE Moodle_Stack SHALL export the ALB DNS name as a CloudFormation output.
5. THE Moodle_Stack SHALL export the EFS file system ID as a CloudFormation output.
6. THE Moodle_Stack SHALL export the Aurora_MySQL cluster endpoint as a CloudFormation output.

### Requirement 10: Unit Tests for Moodle Stack

**User Story:** As a developer, I want unit tests that validate the synthesized Moodle CloudFormation template, so that infrastructure changes are caught before deployment.

#### Acceptance Criteria

1. THE unit tests SHALL verify that the Moodle_Stack creates exactly one VPC resource.
2. THE unit tests SHALL verify that the Moodle_Stack creates an ALB resource with internet-facing scheme.
3. THE unit tests SHALL verify that the Moodle_Stack creates an ASG resource with the correct min and max capacity.
4. THE unit tests SHALL verify that the Moodle_Stack creates an EFS file system with encryption enabled.
5. THE unit tests SHALL verify that the Moodle_Stack creates an Aurora MySQL-Compatible database cluster with the correct engine.
6. THE unit tests SHALL verify that the Moodle_Stack produces CloudFormation outputs for ALB DNS name, EFS file system ID, and Aurora_MySQL cluster endpoint.
7. THE pipeline unit tests SHALL verify that the Pipeline contains exactly one deployment stage (Dev_Stage) and no Test or Prod stages.

### Requirement 11: Makefile and Validation Script Updates

**User Story:** As a developer, I want the Makefile and validation scripts updated for the Moodle stack, so that build, test, and validation commands work correctly with the new infrastructure.

#### Acceptance Criteria

1. THE Makefile SHALL retain the existing targets: warming, build, linting, security, unittest, and validate.
2. THE validation script (test/test_validate.sh) SHALL query the Moodle_Stack CloudFormation outputs instead of EventBus outputs.
3. THE validation script SHALL verify the ALB DNS name output exists and perform an HTTP request to confirm Moodle is reachable.
4. THE Makefile deploy target SHALL deploy only Dev-prefixed stacks using `npm run cdk -- deploy Dev-*`.
