import * as cdk from 'aws-cdk-lib'
import { Template } from 'aws-cdk-lib/assertions'
import { NetworkStack } from '../lib/network-stack'
import { ApplicationStack } from '../lib/application-stack'

describe('Moodle ApplicationStack', () => {
  const app = new cdk.App()
  const networkStack = new NetworkStack(app, 'Dev-NetworkStack')
  const applicationStack = new ApplicationStack(app, 'Dev-ApplicationStack', {
    vpc: networkStack.vpc,
    fileSystem: networkStack.fileSystem,
    auroraCluster: networkStack.auroraCluster,
    efsSg: networkStack.efsSg,
    auroraSg: networkStack.auroraSg
  })
  // Use _toCloudFormation() to avoid circular dependency during synthesis
  // (ApplicationStack ↔ NetworkStack cross-stack SG references)
  const cfn: Record<string, unknown> = (applicationStack as any)._toCloudFormation()
  const template = Template.fromJSON(cfn)

  test('ALB is internet-facing', () => {
    template.hasResourceProperties('AWS::ElasticLoadBalancingV2::LoadBalancer', {
      Scheme: 'internet-facing'
    })
  })

  test('ALB listener on port 80', () => {
    template.hasResourceProperties('AWS::ElasticLoadBalancingV2::Listener', {
      Port: 80
    })
  })

  test('ASG capacity min 1, max 2', () => {
    template.hasResourceProperties('AWS::AutoScaling::AutoScalingGroup', {
      MinSize: '1',
      MaxSize: '2'
    })
  })

  test('ASG instance type is t3.medium', () => {
    template.hasResourceProperties('AWS::AutoScaling::LaunchConfiguration', {
      InstanceType: 't3.medium'
    })
  })

  test('AlbDnsName output exists', () => {
    template.hasOutput('AlbDnsName', {})
  })
})
