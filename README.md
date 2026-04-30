# Moodle Dev CI/CD Pipeline on AWS

## Introduction

This project deploys a **Moodle LMS development environment** on AWS using a fully automated CI/CD pipeline. It is built with [AWS CDK v2](https://aws.amazon.com/cdk/) in TypeScript and uses [AWS CodePipeline](https://aws.amazon.com/codepipeline/) to orchestrate source, build, pre-deployment checks, deployment, and post-deployment validation.

The infrastructure runs Moodle on EC2 instances behind an Application Load Balancer, with Amazon EFS for shared file storage and Amazon Aurora MySQL Serverless v2 for the database backend. The pipeline enforces code quality through linting, unit testing, and security scanning before every deployment.

### What Gets Deployed

| Component | Service | Purpose |
|---|---|---|
| **CI/CD Pipeline** | AWS CodePipeline + CodeBuild | Automated build, test, and deploy |
| **Source Control** | AWS CodeCommit | Git repository for the project |
| **Networking** | Amazon VPC | Isolated network with public/private subnets |
| **Load Balancer** | Application Load Balancer | Distributes HTTP traffic to Moodle instances |
| **Compute** | EC2 Auto Scaling Group | 1–2 t3.medium instances running Moodle |
| **Shared Storage** | Amazon EFS | Shared `/var/moodledata` across all instances |
| **Database** | Aurora MySQL Serverless v2 | 0.5–2 ACU, scales to near-zero for dev |
| **Secrets** | AWS Secrets Manager | Stores Aurora database credentials |

## Architecture

```
                    ┌─────────────────────────────────────────────────────┐
                    │              AWS CodePipeline                       │
                    │                                                     │
                    │  Source ──► Build ──► Pre-Checks ──► Deploy ──► Val │
                    │  (CodeCommit) (CDK Synth) (Lint|Test|Sec)     (HTTP)│
                    └──────────────────────────┬──────────────────────────┘
                                               │
                                               │ deploys
                                               ▼
                    ┌─────────────────────────────────────────────────────┐
                    │                    VPC (2 AZs)                      │
                    │                                                     │
                    │  ┌─── Public Subnets ───────────────────────────┐   │
                    │  │  ALB (internet-facing, port 80)              │   │
                    │  │  NAT Gateway                                 │   │
                    │  └──────────────────────────────────────────────┘   │
                    │                      │                              │
                    │                      │ port 80                      │
                    │                      ▼                              │
                    │  ┌─── Private Subnets ──────────────────────────┐   │
                    │  │  ASG (1-2 × t3.medium, Amazon Linux 2023)   │   │
                    │  │       │                    │                 │   │
                    │  │       │ NFS :2049          │ MySQL :3306     │   │
                    │  │       ▼                    ▼                 │   │
                    │  │  EFS (encrypted,     Aurora MySQL            │   │
                    │  │   bursting)          Serverless v2           │   │
                    │  │                     (0.5-2 ACU)              │   │
                    │  └─────────────────────────────────────────────┘   │
                    └─────────────────────────────────────────────────────┘

    Internet ──► ALB :80 ──► ASG :80 ──► EFS :2049 (moodledata)
                                    ──► Aurora :3306 (database)
                                    ──► NAT ──► Internet (package install)
```

### Pipeline Flow

```
  git push (main branch)
       │
       ▼
  ┌─────────┐     ┌───────────┐     ┌─────────────────────────┐
  │ Source   │────►│   Build   │────►│    Pre-Deployment        │
  │CodeCommit│     │ CDK Synth │     │ (parallel)               │
  └─────────┘     └───────────┘     │ ┌───────┐ ┌────┐ ┌────┐ │
                                    │ │Linting│ │Test│ │Sec │ │
                                    │ │ESLint │ │Jest│ │Nag │ │
                                    │ └───────┘ └────┘ └────┘ │
                                    └────────────┬────────────┘
                                                 │ all pass
                                                 ▼
                                    ┌─────────────────────────┐
                                    │   Dev Stage Deployment   │
                                    │   (CloudFormation)       │
                                    └────────────┬────────────┘
                                                 │
                                                 ▼
                                    ┌─────────────────────────┐
                                    │  Post-Deploy Validation  │
                                    │  • Stack status check    │
                                    │  • HTTP health check     │
                                    └─────────────────────────┘
```

### Security Group Rules

| Source | Destination | Port | Protocol | Purpose |
|---|---|---|---|---|
| `0.0.0.0/0` | ALB SG | 80 | TCP | Public HTTP access |
| ALB SG | ASG SG | 80 | TCP | ALB → Moodle instances |
| ASG SG | EFS SG | 2049 | TCP | NFS mount for moodledata |
| ASG SG | Aurora SG | 3306 | TCP | MySQL database connection |
| ASG SG | `0.0.0.0/0` | All | All | Outbound via NAT (packages) |

## Prerequisites

| Tool | Version | Purpose |
|---|---|---|
| [Node.js](https://nodejs.org/) | v20+ | Runtime for CDK and TypeScript |
| [AWS CDK v2](https://docs.aws.amazon.com/cdk/v2/guide/getting-started.html) | v2.142+ | Infrastructure as Code framework |
| [AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html) | v2 | AWS account authentication |
| [cfn_nag](https://github.com/stelligent/cfn_nag) | v0.8+ | CloudFormation security scanning |
| [git-remote-codecommit](https://docs.aws.amazon.com/codecommit/latest/userguide/setting-up-git-remote-codecommit.html) | v1.16+ | Git HTTPS auth for CodeCommit |

### Installation

**macOS / Linux (Homebrew)**

```bash
brew install node
brew install git-remote-codecommit
brew install ruby brew-gem
brew-gem install cfn-nag
npm install -g aws-cdk
```

**AWS Cloud9**

```bash
gem install cfn-nag
npm install -g aws-cdk
```

Cloud9 comes with Node.js and npm pre-installed. Verify with `node -v && npm -v`.

### AWS CLI Setup

Configure your AWS credentials for the target account and region:

```bash
aws configure
# Or use SSO:
aws sso login --profile your-profile
```

For CodeCommit HTTPS access:
- [Windows setup guide](https://docs.aws.amazon.com/codecommit/latest/userguide/setting-up-https-windows.html)
- [Linux/macOS setup guide](https://docs.aws.amazon.com/codecommit/latest/userguide/setting-up-https-unixes.html)

## Quick Start

### 1. Clone and Install

```bash
git clone --depth 1 https://github.com/aws-samples/aws-codepipeline-cicd.git
cd aws-codepipeline-cicd
rm -rf .git
npm install
```

### 2. Bootstrap CDK

```bash
AWS_REGION="eu-west-1"
ACCOUNT_NUMBER=$(aws sts get-caller-identity --query Account --output text)
echo "Deploying to account ${ACCOUNT_NUMBER} in ${AWS_REGION}"

npx cdk bootstrap "aws://${ACCOUNT_NUMBER}/${AWS_REGION}"
```

### 3. Synthesize and Verify

```bash
npx cdk synth
```

Expected output:
```
Successfully synthesized to /path/to/cdk.out
Supply a stack id (CodePipeline, Dev-NetworkStack, Dev-ApplicationStack) to display its template.
```

### 4. Deploy the Pipeline

```bash
npx cdk deploy CodePipeline --require-approval never
```

This creates the CodePipeline and CodeCommit repository. It does **not** deploy Moodle infrastructure yet — that happens when the pipeline runs.

### 5. Push Code to Trigger the Pipeline

```bash
RepoName=$(aws cloudformation describe-stacks \
  --stack-name CodePipeline \
  --query "Stacks[0].Outputs[?OutputKey=='RepositoryName'].OutputValue" \
  --output text)

git init
git branch -m master main
git remote add origin codecommit://${RepoName}
git add .
git commit -m "Initial commit"
git push -u origin main
```

The pipeline triggers automatically and deploys the full Moodle stack.

### 6. Access Moodle

After the pipeline completes, get the ALB DNS name:

```bash
aws cloudformation describe-stacks \
  --stack-name Dev-ApplicationStack \
  --query "Stacks[0].Outputs[?OutputKey=='AlbDnsName'].OutputValue" \
  --output text
```

Open the URL in your browser to access the Moodle installation page.

## Project Structure

```
.
├── bin/
│   └── code_pipeline.ts          # CDK app entry point
├── lib/
│   ├── network-stack.ts          # Stateful resources (VPC, EFS, Aurora, security groups)
│   ├── application-stack.ts      # Stateless resources (ALB, ASG, UserData, security groups)
│   ├── pipeline-stack.ts         # CodePipeline CI/CD definition
│   └── stages.ts                 # Deployment stage (wraps NetworkStack + ApplicationStack)
├── test/
│   ├── network-stack.test.ts     # Unit tests for NetworkStack
│   ├── application-stack.test.ts # Unit tests for ApplicationStack
│   ├── pipeline-stack.test.ts    # Unit tests for pipeline configuration
│   └── test_validate.sh          # Post-deployment validation script
├── docs/
│   └── aws-codepipeline-cicd.png # Architecture diagram
├── cdk.json                      # CDK app configuration
├── Makefile                      # Build, test, and deploy targets
├── package.json                  # Node.js dependencies and scripts
└── tsconfig.json                 # TypeScript configuration
```

### Stack Overview

| Stack | File | Resources | Purpose |
|---|---|---|---|
| `CodePipeline` | `lib/pipeline-stack.ts` | CodePipeline, CodeCommit, CodeBuild projects, IAM roles | CI/CD orchestration |
| `Dev-NetworkStack` | `lib/network-stack.ts` | VPC, EFS, Aurora MySQL, EFS SG, Aurora SG | Stateful networking and data-layer resources |
| `Dev-ApplicationStack` | `lib/application-stack.ts` | ALB, ASG, ALB SG, ASG SG, UserData | Stateless compute and load-balancing resources |

## CDK Deployment Options

### Option 1: Pipeline Deployment (Recommended)

Deploy only the pipeline. Moodle infrastructure is deployed automatically when you push code:

```bash
# Deploy pipeline
npx cdk deploy CodePipeline

# Push code → pipeline deploys Moodle infrastructure
git push origin main
```

### Option 2: Direct Deployment

Deploy Moodle infrastructure directly without the pipeline (useful for local development):

```bash
# Deploy everything
npx cdk deploy --all

# Or deploy specific stacks
npx cdk deploy Dev-NetworkStack Dev-ApplicationStack
```

### Option 3: Pipeline + Direct

Deploy the pipeline and also deploy Moodle infrastructure directly for immediate access:

```bash
npx cdk deploy CodePipeline Dev-NetworkStack Dev-ApplicationStack --require-approval never
```

## Development Workflow

### Makefile Targets

The Makefile mirrors the pipeline steps for local development:

| Command | What It Does | Pipeline Equivalent |
|---|---|---|
| `make` | Run full local pipeline | All stages |
| `make warming` | Install npm dependencies | Install step |
| `make build` | CDK synth (compile + generate templates) | Build stage |
| `make linting` | ESLint check | Pre-deployment: Linting |
| `make unittest` | Jest unit tests with coverage | Pre-deployment: UnitTest |
| `make security` | cfn-nag security scan | Pre-deployment: Security |
| `make deploy` | Deploy Dev stacks to AWS | Dev stage deployment |
| `make validate` | Run post-deployment validation | Post-deployment: Validate |
| `make clean` | Remove all temporary files | — |

### Running Tests Locally

```bash
# Run all unit tests with coverage
npm run test

# Run linting
npm run lint

# Run security scan
make security

# Run the full local pipeline
make
```

### Making Changes

1. Edit CDK code in `lib/` directory
2. Run `make build` to verify CDK synth succeeds
3. Run `make unittest` to verify tests pass
4. Run `make linting` to verify no lint errors
5. Commit and push to trigger the pipeline:
   ```bash
   git add .
   git commit -m "Your change description"
   git push origin main
   ```

## Infrastructure Details

### VPC Configuration

- **CIDR**: `10.0.0.0/16` (CDK default)
- **Availability Zones**: 2
- **Public Subnets**: ALB, NAT Gateway
- **Private Subnets**: ASG instances, EFS mount targets, Aurora cluster
- **NAT Gateway**: 1 (for outbound internet from private subnets)

### Auto Scaling Group

- **Instance Type**: t3.medium (2 vCPU, 4 GB RAM)
- **AMI**: Amazon Linux 2023
- **Min Capacity**: 1
- **Max Capacity**: 2
- **UserData**: Installs Apache, PHP, Moodle, mounts EFS, configures Aurora connection

### Aurora MySQL

- **Engine**: Aurora MySQL 8.0 compatible (Serverless v2)
- **Capacity**: 0.5–2 ACU (scales to near-zero for dev)
- **Writer Instances**: 1
- **Credentials**: Auto-generated, stored in Secrets Manager
- **Default Database**: `moodle`
- **Backup Retention**: 1 day
- **Deletion Protection**: Disabled (dev environment)

### EFS

- **Encryption**: At rest enabled
- **Throughput Mode**: Bursting
- **Performance Mode**: General Purpose
- **Mount Point**: `/var/moodledata` on EC2 instances

### CloudFormation Outputs

| Output | Value | Usage |
|---|---|---|
| `AlbDnsName` | ALB DNS hostname | Access Moodle in browser |
| `EfsFileSystemId` | EFS file system ID | Debugging, monitoring |
| `AuroraClusterEndpoint` | Aurora writer endpoint | Debugging, monitoring |

## Post-Deployment Validation

The pipeline runs `test/test_validate.sh` after deployment, which:

1. Verifies the CloudFormation stack exists and is in `CREATE_COMPLETE` or `UPDATE_COMPLETE` state
2. Retrieves the ALB DNS name from stack outputs
3. Performs an HTTP health check against the ALB endpoint with a retry loop
4. Expects a 2xx or 3xx response code

Run validation manually:

```bash
# Uses STAGE=Dev by default
make validate

# Or specify a stage
STAGE=Dev ./test/test_validate.sh
```

## Cleanup

Destroy all deployed resources:

```bash
npx cdk destroy --all
```

Some resources may require manual cleanup:
- **S3 buckets** with objects (artifact bucket) — empty before destroying
- **CloudWatch log groups** — may have retention policies
- **Secrets Manager secrets** — have a recovery window before permanent deletion

To destroy specific stacks:

```bash
# Destroy Moodle infrastructure only (keep pipeline)
npx cdk destroy Dev-ApplicationStack Dev-NetworkStack

# Destroy pipeline only (keep Moodle infrastructure)
npx cdk destroy CodePipeline
```

## Troubleshooting

| Issue | Cause | Fix |
|---|---|---|
| Pipeline fails at Source | No `main` branch in CodeCommit | Push code to create the branch (see Quick Start step 5) |
| CDK synth fails | TypeScript compilation error | Run `make build` locally to see errors |
| Unit tests fail | Infrastructure assertions don't match | Run `npm run test` locally to debug |
| Security scan fails | cfn-nag findings in templates | Review findings and update CDK code |
| Deployment fails | CloudFormation resource creation error | Check CloudFormation events in AWS Console |
| Validation fails | ALB not returning healthy response | Check ASG instance health, security groups, UserData logs |
| EFS mount fails | Security group misconfiguration | Verify EFS SG allows port 2049 from ASG SG |
| Aurora connection fails | Security group or credentials issue | Verify Aurora SG allows port 3306 from ASG SG; check Secrets Manager |

### Viewing Logs

```bash
# Check EC2 instance UserData execution logs
# Connect via SSM Session Manager, then:
sudo cat /var/log/cloud-init-output.log

# Check CodeBuild logs
# Navigate to AWS CodeBuild console → Build history → select build → Logs tab
```

## Related Resources

- [AWS CodePipeline documentation](https://docs.aws.amazon.com/codepipeline/latest/userguide/welcome.html)
- [AWS CDK v2 documentation](https://docs.aws.amazon.com/cdk/v2/guide/home.html)
- [CDK best practices](https://docs.aws.amazon.com/cdk/v2/guide/best-practices.html)
- [Moodle installation guide](https://docs.moodle.org/en/Installing_Moodle)
- [Aurora Serverless v2 documentation](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless-v2.html)
- [Amazon EFS documentation](https://docs.aws.amazon.com/efs/latest/ug/whatisefs.html)

## Code of Conduct

This project has adopted the [Amazon Open Source Code of Conduct](https://aws.github.io/code-of-conduct).
For more information see the [Code of Conduct FAQ](https://aws.github.io/code-of-conduct-faq) or contact
opensource-codeofconduct@amazon.com with any additional questions or comments.
