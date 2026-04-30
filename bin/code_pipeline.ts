#!/usr/bin/env node
import 'source-map-support/register'
import * as cdk from 'aws-cdk-lib'
import { CodePipelineStack } from '../lib/pipeline-stack'
import { NetworkStack } from '../lib/network-stack'
import { ApplicationStack } from '../lib/application-stack'

const app = new cdk.App()
new CodePipelineStack(app, 'CodePipeline')

const networkStack = new NetworkStack(app, 'Dev-NetworkStack')
new ApplicationStack(app, 'Dev-ApplicationStack', {
  vpc: networkStack.vpc,
  fileSystem: networkStack.fileSystem,
  auroraCluster: networkStack.auroraCluster,
  efsSg: networkStack.efsSg,
  auroraSg: networkStack.auroraSg
})
