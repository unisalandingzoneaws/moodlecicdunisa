import * as cdk from 'aws-cdk-lib'
import { Template } from 'aws-cdk-lib/assertions'
import { NetworkStack } from '../lib/network-stack'

describe('Moodle NetworkStack', () => {
  const app = new cdk.App()
  const stack = new NetworkStack(app, 'Dev-NetworkStack')
  const template = Template.fromStack(stack)

  test('VPC resource exists', () => {
    template.resourceCountIs('AWS::EC2::VPC', 1)
  })

  test('EFS encryption enabled', () => {
    template.hasResourceProperties('AWS::EFS::FileSystem', {
      Encrypted: true
    })
  })

  test('EFS throughput mode is bursting', () => {
    template.hasResourceProperties('AWS::EFS::FileSystem', {
      ThroughputMode: 'bursting'
    })
  })

  test('EFS performance mode is generalPurpose', () => {
    template.hasResourceProperties('AWS::EFS::FileSystem', {
      PerformanceMode: 'generalPurpose'
    })
  })

  test('Aurora engine is aurora-mysql', () => {
    template.hasResourceProperties('AWS::RDS::DBCluster', {
      Engine: 'aurora-mysql'
    })
  })

  test('Aurora Serverless v2 capacity', () => {
    template.hasResourceProperties('AWS::RDS::DBCluster', {
      ServerlessV2ScalingConfiguration: {
        MinCapacity: 0.5,
        MaxCapacity: 2
      }
    })
  })

  test('Aurora deletion protection off', () => {
    template.hasResourceProperties('AWS::RDS::DBCluster', {
      DeletionProtection: false
    })
  })

  test('Aurora single writer instance', () => {
    template.resourceCountIs('AWS::RDS::DBInstance', 1)
  })

  test('EfsFileSystemId output exists', () => {
    template.hasOutput('EfsFileSystemId', {})
  })

  test('AuroraClusterEndpoint output exists', () => {
    template.hasOutput('AuroraClusterEndpoint', {})
  })
})
