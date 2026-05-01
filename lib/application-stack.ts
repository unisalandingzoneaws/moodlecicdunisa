import { CfnOutput, Stack } from 'aws-cdk-lib'
import type { StackProps } from 'aws-cdk-lib'
import * as ec2 from 'aws-cdk-lib/aws-ec2'
import type * as efs from 'aws-cdk-lib/aws-efs'
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2'
import * as autoscaling from 'aws-cdk-lib/aws-autoscaling'
import type * as rds from 'aws-cdk-lib/aws-rds'
import { type Construct } from 'constructs'

export interface ApplicationStackProps extends StackProps {
  /** VPC from NetworkStack */
  vpc: ec2.Vpc
  /** EFS file system from NetworkStack */
  fileSystem: efs.FileSystem
  /** Aurora cluster from NetworkStack */
  auroraCluster: rds.DatabaseCluster
  /** EFS security group from NetworkStack — ingress rule added here */
  efsSg: ec2.SecurityGroup
  /** Aurora security group from NetworkStack — ingress rule added here */
  auroraSg: ec2.SecurityGroup
}

export class ApplicationStack extends Stack {
  constructor (scope: Construct, id: string, props: ApplicationStackProps) {
    super(scope, id, props)

    // Security Groups
    const albSg = new ec2.SecurityGroup(this, 'AlbSg', {
      vpc: props.vpc,
      description: 'Security group for ALB',
      allowAllOutbound: false
    })

    const asgSg = new ec2.SecurityGroup(this, 'AsgSg', {
      vpc: props.vpc,
      description: 'Security group for ASG instances'
    })

    // ALB SG: inbound 80 from anywhere, outbound 80 to ASG
    albSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'Allow HTTP from internet')
    albSg.addEgressRule(asgSg, ec2.Port.tcp(80), 'Allow HTTP to ASG')

    // ASG SG: inbound 80 from ALB
    asgSg.addIngressRule(albSg, ec2.Port.tcp(80), 'Allow HTTP from ALB')

    // Cross-stack ingress rules — use CfnSecurityGroupIngress to avoid
    // circular dependency (NetworkStack ↔ ApplicationStack).
    new ec2.CfnSecurityGroupIngress(this, 'EfsIngressFromAsg', {
      ipProtocol: 'tcp',
      fromPort: 2049,
      toPort: 2049,
      groupId: props.efsSg.securityGroupId,
      sourceSecurityGroupId: asgSg.securityGroupId,
      description: 'Allow NFS from ASG'
    })

    new ec2.CfnSecurityGroupIngress(this, 'AuroraIngressFromAsg', {
      ipProtocol: 'tcp',
      fromPort: 3306,
      toPort: 3306,
      groupId: props.auroraSg.securityGroupId,
      sourceSecurityGroupId: asgSg.securityGroupId,
      description: 'Allow MySQL from ASG'
    })

    // Internet-facing ALB in public subnets
    const alb = new elbv2.ApplicationLoadBalancer(this, 'MoodleAlb', {
      vpc: props.vpc,
      internetFacing: true,
      securityGroup: albSg,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC }
    })

    // ASG with Amazon Linux 2023, t3.medium
    // Feature flag @aws-cdk/aws-autoscaling:generateLaunchTemplateInsteadOfLaunchConfig
    // ensures CDK generates a LaunchTemplate instead of deprecated LaunchConfiguration
    const asg = new autoscaling.AutoScalingGroup(this, 'MoodleAsg', {
      vpc: props.vpc,
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MEDIUM),
      machineImage: ec2.MachineImage.latestAmazonLinux2023(),
      minCapacity: 1,
      maxCapacity: 2,
      securityGroup: asgSg,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }
    })

    // Grant ASG instance role permission to read Aurora secret
    if (props.auroraCluster.secret != null) {
      props.auroraCluster.secret.grantRead(asg.role)
    }

    // ALB listener and target group
    const listener = alb.addListener('HttpListener', {
      port: 80,
      open: false
    })

    listener.addTargets('MoodleTargets', {
      port: 80,
      targets: [asg],
      healthCheck: {
        path: '/',
        healthyHttpCodes: '200-399'
      }
    })

    // UserData script — simple hello world for pipeline validation
    asg.addUserData(
      '#!/bin/bash',
      'set -e',
      '',
      '# Install Apache',
      'dnf install -y httpd',
      '',
      '# Create a simple hello world page',
      'echo "<html><body><h1>Hello World - Moodle Pipeline Test</h1></body></html>" > /var/www/html/index.html',
      '',
      '# Start and enable Apache',
      'systemctl start httpd',
      'systemctl enable httpd'
    )

    // CloudFormation Outputs
    new CfnOutput(this, 'AlbDnsName', {
      value: alb.loadBalancerDnsName
    })
  }
}
