import { CfnOutput, RemovalPolicy, Stack } from 'aws-cdk-lib'
import type { StackProps } from 'aws-cdk-lib'
import * as ec2 from 'aws-cdk-lib/aws-ec2'
import * as efs from 'aws-cdk-lib/aws-efs'
import * as rds from 'aws-cdk-lib/aws-rds'
import { type Construct } from 'constructs'

export class NetworkStack extends Stack {
  /** The VPC shared with ApplicationStack */
  public readonly vpc: ec2.Vpc
  /** The EFS file system for Moodle data */
  public readonly fileSystem: efs.FileSystem
  /** The Aurora MySQL Serverless v2 cluster */
  public readonly auroraCluster: rds.DatabaseCluster
  /** Security group protecting EFS — ingress added by ApplicationStack */
  public readonly efsSg: ec2.SecurityGroup
  /** Security group protecting Aurora — ingress added by ApplicationStack */
  public readonly auroraSg: ec2.SecurityGroup

  constructor (scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props)

    // VPC with public and private subnets across 2 AZs
    this.vpc = new ec2.Vpc(this, 'MoodleVpc', {
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        {
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24
        },
        {
          name: 'Private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 24
        }
      ]
    })

    // EFS Security Group — no ingress rules; added by ApplicationStack
    this.efsSg = new ec2.SecurityGroup(this, 'EfsSg', {
      vpc: this.vpc,
      description: 'Security group for EFS',
      allowAllOutbound: false
    })

    // Aurora Security Group — no ingress rules; added by ApplicationStack
    this.auroraSg = new ec2.SecurityGroup(this, 'AuroraSg', {
      vpc: this.vpc,
      description: 'Security group for Aurora MySQL',
      allowAllOutbound: false
    })

    // EFS file system
    this.fileSystem = new efs.FileSystem(this, 'MoodleEfs', {
      vpc: this.vpc,
      encrypted: true,
      throughputMode: efs.ThroughputMode.BURSTING,
      performanceMode: efs.PerformanceMode.GENERAL_PURPOSE,
      securityGroup: this.efsSg,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      removalPolicy: RemovalPolicy.DESTROY
    })

    // Aurora MySQL Serverless v2 cluster
    this.auroraCluster = new rds.DatabaseCluster(this, 'MoodleAurora', {
      engine: rds.DatabaseClusterEngine.auroraMysql({
        version: rds.AuroraMysqlEngineVersion.VER_3_04_0
      }),
      serverlessV2MinCapacity: 0.5,
      serverlessV2MaxCapacity: 2,
      writer: rds.ClusterInstance.serverlessV2('Writer'),
      vpc: this.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [this.auroraSg],
      credentials: rds.Credentials.fromGeneratedSecret('moodleadmin'),
      defaultDatabaseName: 'moodle',
      backup: { retention: { toDays: () => 1 } as any },
      deletionProtection: false,
      removalPolicy: RemovalPolicy.DESTROY
    })

    // CloudFormation Outputs
    new CfnOutput(this, 'EfsFileSystemId', {
      value: this.fileSystem.fileSystemId
    })

    new CfnOutput(this, 'AuroraClusterEndpoint', {
      value: this.auroraCluster.clusterEndpoint.hostname
    })
  }
}
