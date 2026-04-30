# Implementation Plan: Moodle Dev CI/CD Pipeline

## Overview

Transform the existing multi-stage EventBus CI/CD pipeline into a Dev-only Moodle deployment pipeline. The implementation proceeds bottom-up: first replace the infrastructure stack (MainStack), then trim the pipeline, update the deployment stage, adjust the entry point, rewrite tests, and finally update the validation script and Makefile.

## Tasks

- [x] 1. Replace MainStack with Moodle infrastructure
  - [x] 1.1 Rewrite `lib/main-stack.ts` with VPC, ALB, ASG, EFS, and Aurora MySQL resources
    - Remove all EventBus imports and resources
    - Create a VPC with public and private subnets across 2 AZs with NAT Gateway
    - Create an internet-facing ALB in public subnets with a port 80 listener
    - Create security groups for ALB, ASG, EFS, and Aurora with the rules defined in the design (ALB allows inbound 80 from 0.0.0.0/0; ASG allows inbound 80 from ALB SG; EFS allows inbound 2049 from ASG SG; Aurora allows inbound 3306 from ASG SG)
    - Create an EFS file system with encryption enabled, bursting throughput mode, and General Purpose performance mode, with mount targets in private subnets
    - Create an Aurora MySQL Serverless v2 cluster (engine aurora-mysql, MySQL 8.0 compatible, 0.5–2 ACU, single writer instance, credentials in Secrets Manager, backup retention 1 day, deletion protection disabled)
    - Create an ASG with min 1 / max 2 t3.medium instances using Amazon Linux 2023, associated with the ALB target group
    - Grant the ASG instance role permission to read the Aurora secret from Secrets Manager
    - Add a UserData script that installs Apache, PHP, required PHP extensions, downloads Moodle, mounts EFS to `/var/moodledata`, retrieves Aurora credentials from Secrets Manager, and configures Moodle's `config.php`
    - Export three CfnOutputs: `AlbDnsName`, `EfsFileSystemId`, `AuroraClusterEndpoint`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.10, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 9.3, 9.4, 9.5, 9.6_

- [x] 2. Trim pipeline to Dev stage only
  - [x] 2.1 Remove Test and Prod stages from `lib/pipeline-stack.ts`
    - Delete the `testStage` and `prodStage` blocks (both `addStage` calls and their `Deployment` instantiations)
    - Keep the `devStage` block with its pre-deployment (Linting, UnitTest, Security) and post-deployment (Validate) steps unchanged
    - _Requirements: 1.1, 1.2_

  - [x] 2.2 Update `validatePolicy` permissions for Moodle resources
    - Replace `events:DescribeEventBus` with Moodle-relevant permissions: `elasticloadbalancing:Describe*`, `efs:Describe*`, `rds:Describe*`, `autoscaling:Describe*`
    - Keep `cloudformation:DescribeStacks`
    - _Requirements: 8.1, 8.2, 8.3_

- [x] 3. Update deployment stage and CDK entry point
  - [x] 3.1 Verify `lib/stages.ts` requires no changes
    - The Deployment stage already instantiates `MainStack` — since MainStack is rewritten in task 1.1, no code changes are needed here
    - Confirm the import path and constructor call are correct
    - _Requirements: 9.2_

  - [x] 3.2 Verify `bin/code_pipeline.ts` requires no changes
    - The entry point already creates `CodePipelineStack` and `Dev-MainStack` — since MainStack is rewritten in task 1.1, no code changes are needed here
    - Confirm the import path and constructor call are correct
    - _Requirements: 9.1_

- [x] 4. Checkpoint - Ensure CDK synth succeeds
  - Run `npm run cdk synth` to verify the updated stacks synthesize without errors
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Rewrite unit tests for Moodle stack
  - [x] 5.1 Rewrite `test/main-stack.test.ts` with Moodle infrastructure assertions
    - Remove all EventBus test cases
    - Add test: VPC resource exists (exactly 1 `AWS::EC2::VPC`)
    - Add test: ALB is internet-facing (`Scheme: internet-facing`)
    - Add test: ALB listener on port 80
    - Add test: ASG capacity (`MinSize: '1'`, `MaxSize: '2'`)
    - Add test: ASG instance type is t3.medium (via launch template)
    - Add test: EFS encryption enabled (`Encrypted: true`)
    - Add test: EFS throughput mode (`ThroughputMode: bursting`)
    - Add test: EFS performance mode (`PerformanceMode: generalPurpose`)
    - Add test: Aurora engine (`Engine: aurora-mysql`)
    - Add test: Aurora Serverless v2 capacity (`MinCapacity: 0.5`, `MaxCapacity: 2`)
    - Add test: Aurora single writer (exactly 1 `AWS::RDS::DBInstance`)
    - Add test: Aurora deletion protection off (`DeletionProtection: false`)
    - Add test: Aurora backup retention (`BackupRetentionPeriod: 1`)
    - Add test: Stack outputs exist (`AlbDnsName`, `EfsFileSystemId`, `AuroraClusterEndpoint`)
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6_

  - [x] 5.2 Update `test/pipeline-stack.test.ts` for Dev-only pipeline
    - Keep existing tests for pipeline restart, key rotation, source settings, and build settings
    - Add test: only Dev stage exists — pipeline stages do not include Test or Prod stage names
    - Update expected resource counts: CodeBuild projects (reduced from 8 since Test/Prod Validate steps are removed), IAM roles, and S3 buckets
    - _Requirements: 10.7_

- [x] 6. Checkpoint - Ensure all unit tests pass
  - Run `npm run test` to verify all unit tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Update validation script and Makefile
  - [x] 7.1 Rewrite `test/test_validate.sh` for Moodle stack validation
    - Replace EventBus output queries with ALB DNS name query: `aws cloudformation describe-stacks --stack-name "${STAGE}-MainStack" --query "Stacks[0].Outputs[?OutputKey=='AlbDnsName'].OutputValue" --output text`
    - Add stack status verification (check for `CREATE_COMPLETE` or `UPDATE_COMPLETE`)
    - Add HTTP health check using `curl` against the ALB DNS endpoint with a retry loop and timeout
    - Keep `set -e` and the `STAGE` variable logic
    - _Requirements: 8.2, 8.3, 8.4, 11.2, 11.3_

  - [x] 7.2 Verify Makefile requires no changes
    - Confirm existing targets (warming, build, linting, security, unittest, validate, deploy) work with the updated stack
    - The `deploy` target already uses `npm run cdk -- deploy Dev-*` which is correct
    - _Requirements: 11.1, 11.4_

- [x] 8. Final checkpoint - Ensure all tests pass and CDK synth succeeds
  - Run `make build` to verify CDK synth
  - Run `make unittest` to verify all unit tests pass
  - Run `make linting` to verify no lint errors
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- No property-based tests are included — this is an IaC project where CDK assertion tests and integration tests are the appropriate testing strategies
- The Deployment stage (`lib/stages.ts`) and CDK entry point (`bin/code_pipeline.ts`) require no code changes since they already reference `MainStack` which is rewritten in place
- The Makefile requires no changes since all existing targets remain valid with the new stack
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation throughout implementation
