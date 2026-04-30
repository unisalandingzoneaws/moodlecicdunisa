# Requirements Document

## Introduction

This feature refactors the existing monolithic Moodle `MainStack` into two separate CDK stacks: a **NetworkStack** containing stateful, rarely-changing infrastructure (VPC, EFS, Aurora MySQL, and their security groups) and an **ApplicationStack** containing stateless, frequently-changing compute resources (ALB, ASG, Launch Template, UserData, and their security groups). The existing `CodePipelineStack` remains unchanged. The goal is to enable independent deployment lifecycles, reduce blast radius of application changes, and protect stateful resources from accidental deletion during routine application updates.

## Glossary

- **NetworkStack**: A CDK Stack containing stateful networking and data-layer resources (VPC, subnets, NAT Gateway, EFS file system, Aurora MySQL cluster, EFS security group, Aurora security group). Defined in `lib/network-stack.ts`.
- **ApplicationStack**: A CDK Stack containing stateless compute and load-balancing resources (ALB, ASG, Launch Template, UserData, ALB security group, ASG security group, Listener, Target Group). Defined in `lib/application-stack.ts`.
- **CodePipelineStack**: The existing CI/CD pipeline stack defined in `lib/pipeline-stack.ts`. It orchestrates source, build, pre-deployment checks, deployment, and post-deployment validation.
- **Deployment_Stage**: The CDK Stage defined in `lib/stages.ts` that instantiates infrastructure stacks for a given environment. Currently instantiates `MainStack`; will be updated to instantiate `NetworkStack` and `ApplicationStack`.
- **MainStack**: The existing monolithic CDK Stack in `lib/main-stack.ts` containing all Moodle infrastructure. To be replaced by NetworkStack and ApplicationStack.
- **Cross_Stack_Props**: CDK construct properties used to pass resource references (VPC, EFS file system, Aurora cluster, security groups) from NetworkStack to ApplicationStack via typed interfaces.
- **VPC**: The Amazon Virtual Private Cloud with public and private subnets across 2 Availability Zones and a NAT Gateway.
- **EFS**: Amazon Elastic File System used for shared Moodle data storage (`/var/moodledata`).
- **Aurora_Cluster**: Amazon Aurora MySQL Serverless v2 database cluster for Moodle's relational data.
- **ALB**: Application Load Balancer that distributes HTTP traffic to ASG instances.
- **ASG**: Auto Scaling Group running Amazon Linux 2023 EC2 instances with Moodle installed via UserData.
- **Ingress_Rule**: A security group rule that permits inbound network traffic on a specified port from a specified source.

## Requirements

### Requirement 1: NetworkStack Resource Composition

**User Story:** As a platform engineer, I want stateful infrastructure resources grouped into a dedicated NetworkStack, so that I can manage their lifecycle independently from application compute resources.

#### Acceptance Criteria

1. THE NetworkStack SHALL contain exactly one VPC with 2 Availability Zones, 1 NAT Gateway, public subnets, and private subnets with egress.
2. THE NetworkStack SHALL contain exactly one encrypted EFS file system with bursting throughput mode and general-purpose performance mode, placed in private subnets.
3. THE NetworkStack SHALL contain exactly one Aurora MySQL Serverless v2 cluster with a single writer instance, placed in private subnets, using generated credentials with the username `moodleadmin` and default database name `moodle`.
4. THE NetworkStack SHALL contain exactly one EFS security group that permits inbound NFS traffic (TCP port 2049).
5. THE NetworkStack SHALL contain exactly one Aurora security group that permits inbound MySQL traffic (TCP port 3306).
6. THE NetworkStack SHALL expose the VPC, EFS file system, Aurora cluster, EFS security group, and Aurora security group as public readonly properties for consumption by other stacks.

### Requirement 2: ApplicationStack Resource Composition

**User Story:** As a platform engineer, I want stateless compute resources grouped into a dedicated ApplicationStack, so that I can deploy application changes without risking stateful infrastructure.

#### Acceptance Criteria

1. THE ApplicationStack SHALL accept Cross_Stack_Props containing references to the VPC, EFS file system, Aurora cluster, EFS security group, and Aurora security group from the NetworkStack.
2. THE ApplicationStack SHALL contain exactly one internet-facing ALB in public subnets with an HTTP listener on port 80.
3. THE ApplicationStack SHALL contain exactly one ASG with t3.medium Amazon Linux 2023 instances, minimum capacity 1, maximum capacity 2, placed in private subnets.
4. THE ApplicationStack SHALL contain exactly one ALB security group that permits inbound HTTP traffic (TCP port 80) from any IPv4 address and permits outbound HTTP traffic (TCP port 80) only to the ASG security group.
5. THE ApplicationStack SHALL contain exactly one ASG security group that permits inbound HTTP traffic (TCP port 80) from the ALB security group.
6. THE ApplicationStack SHALL configure UserData on ASG instances to install Apache, PHP, required PHP extensions, mount the EFS file system, download Moodle, retrieve Aurora credentials from Secrets Manager, and generate the Moodle `config.php`.
7. THE ApplicationStack SHALL grant the ASG instance role read permission to the Aurora cluster generated secret.

### Requirement 3: Cross-Stack Security Group Ingress

**User Story:** As a platform engineer, I want security group ingress rules to connect resources across stacks, so that ASG instances in the ApplicationStack can access EFS and Aurora in the NetworkStack.

#### Acceptance Criteria

1. WHEN the ApplicationStack is deployed, THE ApplicationStack SHALL add an Ingress_Rule to the NetworkStack EFS security group permitting inbound NFS traffic (TCP port 2049) from the ASG security group.
2. WHEN the ApplicationStack is deployed, THE ApplicationStack SHALL add an Ingress_Rule to the NetworkStack Aurora security group permitting inbound MySQL traffic (TCP port 3306) from the ASG security group.

### Requirement 4: Deployment Stage Orchestration

**User Story:** As a platform engineer, I want the Deployment_Stage to instantiate both NetworkStack and ApplicationStack with correct dependency ordering, so that the CI/CD pipeline deploys them in the right sequence.

#### Acceptance Criteria

1. THE Deployment_Stage SHALL instantiate the NetworkStack before the ApplicationStack.
2. THE Deployment_Stage SHALL pass NetworkStack resource references to the ApplicationStack via Cross_Stack_Props.
3. THE ApplicationStack SHALL declare an explicit CDK dependency on the NetworkStack so that CloudFormation deploys the NetworkStack first.
4. THE Deployment_Stage SHALL NOT instantiate the MainStack.

### Requirement 5: Standalone Entry Point Update

**User Story:** As a developer, I want the CDK app entry point to create standalone NetworkStack and ApplicationStack for manual deployments, so that I can deploy outside the pipeline with the same stack separation.

#### Acceptance Criteria

1. WHEN the CDK app entry point is executed, THE entry point SHALL create a standalone NetworkStack with the identifier `Dev-NetworkStack`.
2. WHEN the CDK app entry point is executed, THE entry point SHALL create a standalone ApplicationStack with the identifier `Dev-ApplicationStack` that receives Cross_Stack_Props from the standalone NetworkStack.
3. THE entry point SHALL continue to create the CodePipelineStack with the identifier `CodePipeline`.
4. THE entry point SHALL NOT create the MainStack.

### Requirement 6: CloudFormation Outputs Preservation

**User Story:** As an operations engineer, I want the same CloudFormation outputs available after the refactoring, so that post-deployment validation and monitoring scripts continue to work.

#### Acceptance Criteria

1. THE ApplicationStack SHALL produce a CloudFormation output named `AlbDnsName` containing the ALB DNS name.
2. THE NetworkStack SHALL produce a CloudFormation output named `EfsFileSystemId` containing the EFS file system identifier.
3. THE NetworkStack SHALL produce a CloudFormation output named `AuroraClusterEndpoint` containing the Aurora cluster endpoint hostname.

### Requirement 7: Post-Deployment Validation Compatibility

**User Story:** As a DevOps engineer, I want the post-deployment validation script to work with the new stack structure, so that the CI/CD pipeline can verify successful deployments.

#### Acceptance Criteria

1. WHEN the validation script executes in the pipeline, THE validation script SHALL query the ApplicationStack for the `AlbDnsName` output.
2. WHEN the validation script executes locally without a STAGE variable, THE validation script SHALL default to querying the `Dev-ApplicationStack` for the `AlbDnsName` output.
3. THE validation script SHALL perform an HTTP health check against the ALB DNS name and succeed when the response status code is between 200 and 399.

### Requirement 8: Pipeline Stack Unchanged

**User Story:** As a DevOps engineer, I want the CodePipelineStack to remain unchanged, so that the CI/CD workflow is not disrupted by the infrastructure refactoring.

#### Acceptance Criteria

1. THE CodePipelineStack SHALL retain the same CodeCommit source, synth step, pre-deployment checks (Linting, UnitTest, Security), Dev stage deployment, and post-deployment validation (Validate) configuration.
2. THE CodePipelineStack SHALL produce the same set of CloudFormation resources as before the refactoring.

### Requirement 9: MainStack Removal

**User Story:** As a platform engineer, I want the monolithic MainStack removed from the codebase, so that there is a single clear path for deploying Moodle infrastructure.

#### Acceptance Criteria

1. WHEN the refactoring is complete, THE codebase SHALL NOT contain the `lib/main-stack.ts` file.
2. WHEN the refactoring is complete, THE codebase SHALL NOT contain the `test/main-stack.test.ts` file.
3. WHEN the refactoring is complete, THE codebase SHALL NOT contain any import or reference to the `MainStack` class.

### Requirement 10: Unit Test Coverage for New Stacks

**User Story:** As a developer, I want dedicated unit tests for NetworkStack and ApplicationStack, so that I can verify each stack produces the correct CloudFormation resources independently.

#### Acceptance Criteria

1. THE NetworkStack test suite SHALL verify the presence of exactly 1 VPC, 1 EFS file system, 1 Aurora MySQL cluster, 1 Aurora DB instance, and the correct security group configurations.
2. THE ApplicationStack test suite SHALL verify the presence of exactly 1 internet-facing ALB, 1 ALB listener on port 80, 1 ASG with correct capacity and instance type, and the correct security group configurations.
3. THE ApplicationStack test suite SHALL verify that CloudFormation outputs `AlbDnsName` exist.
4. THE NetworkStack test suite SHALL verify that CloudFormation outputs `EfsFileSystemId` and `AuroraClusterEndpoint` exist.
5. THE pipeline stack test suite SHALL continue to pass with updated resource counts reflecting the new stack structure.
