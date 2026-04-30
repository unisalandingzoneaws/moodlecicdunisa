# Implementation Plan: Moodle Stack Separation

## Overview

Refactor the monolithic `MainStack` into two CDK stacks — `NetworkStack` (stateful: VPC, EFS, Aurora, their SGs) and `ApplicationStack` (stateless: ALB, ASG, UserData, their SGs). Update the deployment stage, entry point, tests, and validation script, then remove the old `MainStack` files. Implementation follows a bottom-up approach: build NetworkStack first, then ApplicationStack, wire them together, verify with tests, and clean up.

## Tasks

- [x] 1. Create NetworkStack
  - [x] 1.1 Create `lib/network-stack.ts` with the `NetworkStack` class
    - Define the `NetworkStack` class extending `Stack`
    - Create VPC with 2 AZs, 1 NAT Gateway, public and private-with-egress subnets
    - Create EFS security group (`allowAllOutbound: false`, no ingress rules)
    - Create Aurora security group (`allowAllOutbound: false`, no ingress rules)
    - Create encrypted EFS file system with bursting throughput, general-purpose performance, in private subnets, DESTROY removal policy
    - Create Aurora MySQL Serverless v2 cluster (engine 3.04.0, 0.5–2 ACU, single writer, private subnets, generated credentials `moodleadmin`, database `moodle`, DESTROY removal policy)
    - Expose `vpc`, `fileSystem`, `auroraCluster`, `efsSg`, `auroraSg` as public readonly properties
    - Add `CfnOutput` for `EfsFileSystemId` and `AuroraClusterEndpoint`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 6.2, 6.3_

- [x] 2. Create ApplicationStack
  - [x] 2.1 Create `lib/application-stack.ts` with the `ApplicationStackProps` interface and `ApplicationStack` class
    - Define `ApplicationStackProps` extending `StackProps` with `vpc`, `fileSystem`, `auroraCluster`, `efsSg`, `auroraSg`
    - Create ALB security group (`allowAllOutbound: false`, inbound TCP 80 from `0.0.0.0/0`, outbound TCP 80 to ASG SG)
    - Create ASG security group (default outbound, inbound TCP 80 from ALB SG)
    - Add cross-stack ingress: TCP 2049 from ASG SG to `props.efsSg`, TCP 3306 from ASG SG to `props.auroraSg`
    - Create internet-facing ALB in public subnets with ALB SG
    - Create ASG with t3.medium Amazon Linux 2023, min 1 / max 2, private subnets, ASG SG
    - Grant ASG instance role read permission to Aurora cluster secret
    - Add HTTP listener on port 80 with target group, health check path `/`, codes `200-399`
    - Add UserData script (install Apache, PHP, extensions, mount EFS, download Moodle, retrieve Aurora credentials, generate `config.php`)
    - Add `CfnOutput` for `AlbDnsName`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 3.1, 3.2, 6.1_

- [x] 3. Update deployment stage and entry point
  - [x] 3.1 Update `lib/stages.ts` to instantiate `NetworkStack` and `ApplicationStack`
    - Remove `MainStack` import, add `NetworkStack` and `ApplicationStack` imports
    - Create `NetworkStack` in the `Deployment` stage
    - Create `ApplicationStack` with cross-stack props from `NetworkStack`
    - Call `applicationStack.addDependency(networkStack)` for deployment ordering
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

  - [x] 3.2 Update `bin/code_pipeline.ts` for standalone stacks
    - Remove `MainStack` import, add `NetworkStack` and `ApplicationStack` imports
    - Create standalone `Dev-NetworkStack` and `Dev-ApplicationStack` with cross-stack props
    - Keep `CodePipelineStack` with identifier `CodePipeline`
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

- [x] 4. Checkpoint — CDK synth
  - Run `npx cdk synth` to verify both stacks synthesize without errors. Ask the user if questions arise.

- [x] 5. Write unit tests for new stacks
  - [x] 5.1 Create `test/network-stack.test.ts`
    - Verify exactly 1 VPC (`AWS::EC2::VPC`)
    - Verify EFS file system properties (encrypted, bursting, general-purpose)
    - Verify Aurora cluster properties (engine `aurora-mysql`, serverless v2 capacity 0.5–2, deletion protection off)
    - Verify exactly 1 Aurora DB instance
    - Verify `EfsFileSystemId` and `AuroraClusterEndpoint` outputs exist
    - _Requirements: 10.1, 10.4_

  - [x] 5.2 Create `test/application-stack.test.ts`
    - Instantiate `NetworkStack` and pass its properties to `ApplicationStack` in test setup
    - Verify ALB is internet-facing
    - Verify ALB listener on port 80
    - Verify ASG capacity (min 1, max 2) and instance type t3.medium
    - Verify `AlbDnsName` output exists
    - _Requirements: 10.2, 10.3_

  - [x] 5.3 Update `test/pipeline-stack.test.ts` if resource counts change
    - Run existing pipeline tests and adjust expected resource counts (CodeBuild projects, S3 buckets, IAM roles) if the two-stack stage changes them
    - _Requirements: 10.5, 8.1, 8.2_

- [x] 6. Checkpoint — All tests pass
  - Run `npm run test` and ensure all test suites pass. Ask the user if questions arise.

- [x] 7. Update validation script
  - [x] 7.1 Update `test/test_validate.sh` to query `ApplicationStack`
    - Change `STACK_NAME="${STAGE}-MainStack"` to `STACK_NAME="${STAGE}-ApplicationStack"`
    - Default `STAGE=Dev` so local default becomes `Dev-ApplicationStack`
    - Keep the HTTP health check logic unchanged
    - _Requirements: 7.1, 7.2, 7.3_

- [x] 8. Remove MainStack files and clean up
  - [x] 8.1 Delete `lib/main-stack.ts` and `test/main-stack.test.ts`
    - _Requirements: 9.1, 9.2_

  - [x] 8.2 Delete compiled JS and declaration files for removed sources
    - Delete `lib/main-stack.js`, `lib/main-stack.d.ts`
    - Delete `test/main-stack.test.js`, `test/main-stack.test.d.ts`
    - _Requirements: 9.3_

  - [x] 8.3 Verify no remaining imports or references to `MainStack`
    - Search the codebase for any lingering `MainStack` references and remove them
    - _Requirements: 9.3_

- [x] 9. Final checkpoint — Full build and test verification
  - Run `make build`, `make unittest`, and `make linting` to confirm everything passes. Ask the user if questions arise.

## Notes

- No property-based tests are included — this is purely IaC refactoring with CDK assertion tests as the appropriate testing approach (per design document).
- The `CodePipelineStack` (`lib/pipeline-stack.ts`) is intentionally unchanged per Requirement 8.
- Each task references specific requirement acceptance criteria for traceability.
- Checkpoints ensure incremental validation at key milestones.
- Cross-stack ingress rules are added in ApplicationStack to avoid circular dependencies between stacks.
