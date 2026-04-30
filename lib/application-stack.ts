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

    // UserData script
    const secretArn = props.auroraCluster.secret?.secretArn ?? ''
    const dbEndpoint = props.auroraCluster.clusterEndpoint.hostname
    const efsId = props.fileSystem.fileSystemId
    const region = Stack.of(this).region

    asg.addUserData(
      '#!/bin/bash',
      'set -e',
      '',
      '# Install Apache, PHP, and required extensions',
      'dnf install -y httpd php php-mysqlnd php-xml php-mbstring php-curl php-zip php-gd php-intl php-soap php-opcache php-json amazon-efs-utils unzip jq',
      '',
      '# Start and enable Apache',
      'systemctl start httpd',
      'systemctl enable httpd',
      '',
      '# Mount EFS for moodledata',
      'mkdir -p /var/moodledata',
      `mount -t efs ${efsId}:/ /var/moodledata`,
      'chmod 0777 /var/moodledata',
      '',
      '# Download and install Moodle',
      'cd /var/www/html',
      'curl -L -o moodle-latest.tgz https://download.moodle.org/download.php/direct/stable405/moodle-latest-405.tgz',
      'tar xzf moodle-latest.tgz',
      'mv moodle/* .',
      'rm -rf moodle moodle-latest.tgz',
      'chown -R apache:apache /var/www/html',
      '',
      '# Retrieve Aurora credentials from Secrets Manager',
      `SECRET_JSON=$(aws secretsmanager get-secret-value --secret-id "${secretArn}" --region "${region}" --query SecretString --output text)`,
      'DB_USER=$(echo "$SECRET_JSON" | jq -r .username)',
      'DB_PASS=$(echo "$SECRET_JSON" | jq -r .password)',
      '',
      '# Configure Moodle config.php',
      'cat > /var/www/html/config.php << MOODLECONFIG',
      '<?php',
      'unset($CFG);',
      'global $CFG;',
      '$CFG = new stdClass();',
      '$CFG->dbtype    = \'mysqli\';',
      '$CFG->dblibrary = \'native\';',
      `$CFG->dbhost    = '${dbEndpoint}';`,
      '$CFG->dbname    = \'moodle\';',
      '$CFG->dbuser    = \'$DB_USER\';',
      '$CFG->dbpass    = \'$DB_PASS\';',
      '$CFG->prefix    = \'mdl_\';',
      '$CFG->dboptions = array(',
      "    'dbpersist' => 0,",
      "    'dbport'    => 3306,",
      "    'dbsocket'  => '',",
      "    'dbcollation' => 'utf8mb4_unicode_ci',",
      ');',
      '$CFG->wwwroot   = \'http://\' . $_SERVER[\'HTTP_HOST\'];',
      '$CFG->dataroot  = \'/var/moodledata\';',
      '$CFG->admin     = \'admin\';',
      '$CFG->directorypermissions = 0777;',
      'require_once(__DIR__ . \'/lib/setup.php\');',
      'MOODLECONFIG',
      '',
      'chown apache:apache /var/www/html/config.php',
      '',
      '# Restart Apache to pick up changes',
      'systemctl restart httpd'
    )

    // CloudFormation Outputs
    new CfnOutput(this, 'AlbDnsName', {
      value: alb.loadBalancerDnsName
    })
  }
}
