# Implementation Plan: App Pipeline Separation

## Overview

Separate Moodle application deployment from infrastructure deployment by modifying `ApplicationStack` (strip UserData, add CodeDeploy resources), creating a new `AppPipelineStack` with its own CodePipeline, seeding an application repository with `appspec.yml` and lifecycle scripts, and wiring everything together through the deployment stage and entry point.

## Tasks

- [ ] 1. Create the application repository seed directory (`app-repo/`)
  - [ ] 1.1 Create `app-repo/appspec.yml` defining CodeDeploy file mappings and lifecycle hooks
    - Map source `/` to destination `/var/www/html`
    - Reference hooks in order: BeforeInstall → AfterInstall → ApplicationStart → ValidateService
    - _Requirements: 5.1, 5.2, 5.7_
  - [ ] 1.2 Create `app-repo/scripts/stop.sh` lifecycle script
    - Stop the Apache httpd service before deployment
    - _Requirements: 5.3_
  - [ ] 1.3 Create `app-repo/scripts/install.sh` lifecycle script
    - Install Moodle application files, retrieve Aurora credentials from Secrets Manager, generate `config.php`
    - _Requirements: 5.4_
  - [ ] 1.4 Create `app-repo/scripts/start.sh` lifecycle script
    - Start the Apache httpd service after deployment
    - _Requirements: 5.5_
  - [ ] 1.5 Create `app-repo/scripts/validate.sh` lifecycle script
    - Perform a local `curl localhost` health check to confirm the application is serving
    - _Requirements: 5.6_
  - [ ] 1.6 Create `app-repo/index.html` placeholder entry point
    - Simple HTML page for initial pipeline validation
    - _Requirements: 5.2_

- [ ] 2. Modify `ApplicationStack` to strip UserData and add CodeDeploy resources
  - [ ] 2.1 Update UserData in `lib/application-stack.ts`
    - Replace the current hello-world UserData with base dependency installation: Apache httpd, PHP 8.x, PHP extensions (mysqlnd, xml, mbstring, gd, intl, zip, soap, opcache), NFS utilities, EFS mount to `/var/www/moodledata`, CodeDeploy agent installation from AWS S3 bucket
    - Start and enable httpd and codedeploy-agent services
    - Remove all Moodle source code download and `config.php` generation
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_
  - [ ] 2.2 Add CodeDeploy Application and Deployment Group resources
    - Create `codedeploy.ServerApplication` with Server compute platform
    - Create `codedeploy.ServerDeploymentGroup` associated with the ASG, using in-place deployment, ALB target group for traffic management, `installAgent: false`, `ALL_AT_ONCE` deployment config
    - _Requirements: 2.1, 2.2, 2.3, 2.4_
  - [ ] 2.3 Add public readonly properties and CloudFormation outputs
    - Expose `codeDeployApp`, `deploymentGroup`, and `albDnsName` as public readonly properties
    - Add `CodeDeployApplicationName` and `CodeDeployDeploymentGroupName` CloudFormation outputs
    - _Requirements: 2.5, 2.6, 2.7_
  - [ ] 2.4 Add IAM permissions for CodeDeploy agent and Secrets Manager
    - Ensure ASG instance role has CodeDeploy agent permissions (handled by `ServerDeploymentGroup` construct with `autoScalingGroups`)
    - Grant ASG instance role read permission to Aurora cluster secret (already exists, verify preserved)
    - S3 artifact read access handled by CodeDeploy construct
    - _Requirements: 10.1, 10.2, 10.3, 10.4_

- [ ] 3. Create the new `AppPipelineStack` (`lib/app-pipeline-stack.ts`)
  - [ ] 3.1 Define `AppPipelineStackProps` interface and stack class
    - Accept `codeDeployAppName`, `deploymentGroupName`, and `albDnsName` as input properties
    - _Requirements: 3.3, 4.3_
  - [ ] 3.2 Create CodeCommit repository with seed content
    - Create repository using `Code.fromAsset('app-repo')` to seed with appspec.yml and lifecycle scripts
    - _Requirements: 3.1_
  - [ ] 3.3 Create CodePipeline with Source and Build stages
    - Source stage: `CodeCommitSourceAction` watching `main` branch of app repo
    - Build stage: `CodeBuildAction` that packages source into a deployment artifact
    - Use standard `aws-codepipeline` + `aws-codepipeline-actions` constructs (not CDK Pipelines)
    - _Requirements: 3.2, 3.4_
  - [ ] 3.4 Add Deploy stage with CodeDeploy action
    - Import CodeDeploy Application and Deployment Group by name using `fromServerDeploymentGroupAttributes`
    - Add `CodeDeployServerDeployAction` to deploy the build artifact
    - _Requirements: 3.5_
  - [ ] 3.5 Add Validate stage with health check
    - CodeBuild step that performs HTTP health check against ALB DNS with retry loop (max 10 retries, 30s interval)
    - _Requirements: 4.1, 4.2, 4.4, 4.5_
  - [ ] 3.6 Add CloudFormation outputs
    - `AppRepositoryName` output with the repository name
    - `AppRepositoryCloneUrl` output with the HTTPS clone URL
    - _Requirements: 3.6, 3.7_

- [ ] 4. Update `stages.ts` and `bin/code_pipeline.ts`
  - [ ] 4.1 Update `lib/stages.ts` Deployment stage
    - Import and instantiate `AppPipelineStack` after `ApplicationStack`
    - Pass `codeDeployAppName`, `deploymentGroupName`, and `albDnsName` from `ApplicationStack` properties
    - Add explicit CDK dependency: `appPipelineStack.addDependency(applicationStack)`
    - _Requirements: 6.1, 6.2, 6.3_
  - [ ] 4.2 Update `bin/code_pipeline.ts` entry point
    - Add standalone `Dev-AppPipelineStack` instantiation receiving props from `Dev-ApplicationStack`
    - Maintain existing `Dev-NetworkStack`, `Dev-ApplicationStack`, and `CodePipeline` stacks
    - _Requirements: 8.1, 8.2_

- [ ] 5. Checkpoint — CDK synth verification
  - Run `npx cdk synth` to verify all stacks synthesize without errors or circular dependencies
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 6. Write unit tests for new and modified stacks
  - [ ] 6.1 Add new tests to `test/application-stack.test.ts`
    - Test CodeDeploy Application exists with Server compute platform (`resourceCountIs` + `hasResourceProperties`)
    - Test CodeDeploy Deployment Group exists with in-place deployment and ALB target group
    - Test `CodeDeployApplicationName` and `CodeDeployDeploymentGroupName` outputs exist
    - Test UserData contains httpd, PHP, CodeDeploy agent install commands
    - Test UserData does NOT contain Moodle download or config.php generation
    - _Requirements: 9.1, 9.2, 9.3_
  - [ ] 6.2 Create `test/app-pipeline-stack.test.ts`
    - Test exactly one CodeCommit repository resource exists
    - Test exactly one CodePipeline resource exists
    - Test pipeline has Source, Build, Deploy, and Validate stages
    - Test Deploy stage uses CodeDeploy provider
    - Test `AppRepositoryName` and `AppRepositoryCloneUrl` outputs exist
    - _Requirements: 9.4, 9.5, 9.6, 9.7_
  - [ ] 6.3 Update `test/pipeline-stack.test.ts` resource counts
    - Update expected CodeBuild project, S3 bucket, and IAM role counts to reflect AppPipelineStack addition in Deployment stage
    - _Requirements: 9.8_

- [ ] 7. Checkpoint — All tests pass
  - Run `npm test` and verify all unit tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 8. Update validation script if needed
  - Review `test/test_validate.sh` for any changes needed to support the new stack structure
  - Verify the script still correctly queries `Dev-ApplicationStack` outputs and performs health checks
  - _Requirements: 7.1, 7.2, 7.3, 7.4_

- [ ] 9. Final checkpoint — Full build and test verification
  - Run `npm run build` to compile TypeScript
  - Run `npm run lint` to verify no linting errors
  - Run `npx cdk synth` to verify synthesis
  - Run `npm test` to verify all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- No property-based tests are included — this feature is entirely IaC (CDK/CloudFormation) with declarative resource configuration, not algorithmic logic
- The `AppPipelineStack` uses standard `aws-codepipeline` constructs (not CDK Pipelines) since it needs no self-mutation
- CodeDeploy agent permissions are automatically managed by the CDK `ServerDeploymentGroup` construct when `autoScalingGroups` is set
- The `app-repo/` directory is seeded into the CodeCommit repository via `Code.fromAsset()` on first deployment
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation throughout implementation
