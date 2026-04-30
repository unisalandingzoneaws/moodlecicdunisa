import * as cdk from 'aws-cdk-lib'
import { Template } from 'aws-cdk-lib/assertions'
import { NetworkStack } from '../lib/network-stack'
import { ApplicationStack } from '../lib/application-stack'

describe('Moodle ApplicationStack', () => {
  let template: Template

  beforeAll(() => {
    const app = new cdk.App({
      context: {
        '@aws-cdk/aws-autoscaling:generateLaunchTemplateInsteadOfLaunchConfig': true
      }
    })
    const networkStack = new NetworkStack(app, 'Dev-NetworkStack')
    const applicationStack = new ApplicationStack(app, 'Dev-ApplicationStack', {
      vpc: networkStack.vpc,
      fileSystem: networkStack.fileSystem,
      auroraCluster: networkStack.auroraCluster,
      efsSg: networkStack.efsSg,
      auroraSg: networkStack.auroraSg
    })
    const assembly = app.synth()
    const stackArtifact = assembly.getStackByName(applicationStack.stackName)
    template = Template.fromJSON(stackArtifact.template as Record<string, unknown>)
  })

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
    template.hasResourceProperties('AWS::EC2::LaunchTemplate', {
      LaunchTemplateData: {
        InstanceType: 't3.medium'
      }
    })
  })

  test('AlbDnsName output exists', () => {
    template.hasOutput('AlbDnsName', {})
  })
})
