import { App } from 'aws-cdk-lib';
import { EchoStack } from './stack';
const app = new App();
new EchoStack(app, 'Echo', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION || 'us-east-1' },
});
app.synth();
