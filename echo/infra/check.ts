import { App } from 'aws-cdk-lib';
import { Template,Match } from 'aws-cdk-lib/assertions';
import { EchoStack } from './stack';
const app=new App();const stack=new EchoStack(app,'EchoTest');const t=Template.fromStack(stack);
t.hasResourceProperties('AWS::DynamoDB::Table',{BillingMode:'PAY_PER_REQUEST',PointInTimeRecoverySpecification:{PointInTimeRecoveryEnabled:true},KeySchema:Match.arrayWith([{AttributeName:'pk',KeyType:'HASH'},{AttributeName:'sk',KeyType:'RANGE'}])});
t.hasResourceProperties('AWS::S3::Bucket',{PublicAccessBlockConfiguration:{BlockPublicAcls:true,BlockPublicPolicy:true,IgnorePublicAcls:true,RestrictPublicBuckets:true},VersioningConfiguration:{Status:'Enabled'}});
t.hasResourceProperties('AWS::ApiGateway::Method',{AuthorizationType:'AWS_IAM'});t.hasResourceProperties('AWS::Cognito::UserPool',{MfaConfiguration:'OPTIONAL'});t.resourceCountIs('AWS::CloudWatch::Alarm',2);app.synth();console.log('CDK synthesis and security resource assertions passed. Live AWS deployment remains unverified.');
