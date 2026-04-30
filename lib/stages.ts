import { Stage, type StageProps } from 'aws-cdk-lib'
import { type Construct } from 'constructs'
import { NetworkStack } from './network-stack'
import { ApplicationStack } from './application-stack'

// Main deployment setup. Collection of the stacks and deployment sequence
export class Deployment extends Stage {
  constructor (scope: Construct, id: string, props?: StageProps) {
    super(scope, id, props)

    // Deploy the NetworkStack (stateful resources) first
    const networkStack = new NetworkStack(this, 'NetworkStack', {
      description: 'Stateful networking and data-layer resources for Moodle.'
    })

    // Deploy the ApplicationStack (stateless resources) with cross-stack props
    const applicationStack = new ApplicationStack(this, 'ApplicationStack', {
      description: 'Stateless compute and load-balancing resources for Moodle.',
      vpc: networkStack.vpc,
      fileSystem: networkStack.fileSystem,
      auroraCluster: networkStack.auroraCluster,
      efsSg: networkStack.efsSg,
      auroraSg: networkStack.auroraSg
    })

    // Ensure NetworkStack deploys before ApplicationStack
    applicationStack.addDependency(networkStack)
  }
}
