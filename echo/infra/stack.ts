import { Stack, Duration, RemovalPolicy, CfnOutput, CfnParameter, SecretValue, type StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as events from 'aws-cdk-lib/aws-events';
export class EchoStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);
    const origin = new CfnParameter(this, 'ApplicationOrigin', {
      type: 'String',
      description: 'HTTPS origin of the Amplify frontend',
      allowedPattern: 'https://[^/]+',
      default: 'https://echo.example.com',
    });
    const sessionSecret = new CfnParameter(this, 'SessionSecretArn', {
      type: 'String',
      noEcho: true,
      description: 'Secrets Manager ARN containing JSON key NEXTAUTH_SECRET',
    });
    const aiSecret = new CfnParameter(this, 'GroqSecretArn', {
      type: 'String',
      noEcho: true,
      description: 'Secrets Manager ARN containing JSON key GROQ_API_KEY',
    });
    const table = new dynamodb.Table(this, 'KnowledgeTable', {
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: RemovalPolicy.RETAIN,
    });
    table.addGlobalSecondaryIndex({
      indexName: 'organization-entity',
      partitionKey: { name: 'organizationId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });
    const bucket = new s3.Bucket(this, 'EvidenceBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      minimumTLSVersion: 1.2,
      versioned: true,
      removalPolicy: RemovalPolicy.RETAIN,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
    });
    const pool = new cognito.UserPool(this, 'Users', {
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: { email: { required: true, mutable: false } },
      passwordPolicy: {
        minLength: 12,
        requireDigits: true,
        requireLowercase: true,
        requireUppercase: true,
        requireSymbols: true,
      },
      featurePlan: cognito.FeaturePlan.ESSENTIALS,
      signInPolicy: { allowedFirstAuthFactors: { password: true, passkey: true } },
      passkeyUserVerification: cognito.PasskeyUserVerification.REQUIRED,
      mfa: cognito.Mfa.OPTIONAL,
      mfaSecondFactor: { sms: false, otp: true },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    const domain = pool.addDomain('LoginDomain', {
      cognitoDomain: { domainPrefix: `echo-${this.account}-${this.region}` },
      managedLoginVersion: cognito.ManagedLoginVersion.NEWER_MANAGED_LOGIN,
    });
    const client = pool.addClient('WebClient', {
      generateSecret: true,
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL, cognito.OAuthScope.PROFILE],
        callbackUrls: [`${origin.valueAsString}/api/auth/callback/cognito`],
        logoutUrls: [origin.valueAsString],
      },
      preventUserExistenceErrors: true,
      accessTokenValidity: Duration.hours(1),
      idTokenValidity: Duration.hours(1),
      refreshTokenValidity: Duration.days(1),
    });
    new cognito.CfnManagedLoginBranding(this, 'ManagedLoginBranding', {
      userPoolId: pool.userPoolId,
      clientId: client.userPoolClientId,
      useCognitoProvidedValues: true,
    });
    // Google and Microsoft federation require customer-owned IdP credentials. Configure on the user pool before enabling providers.
    const fn = new lambda.Function(this, 'KnowledgeFunction', {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('infra/dist'),
      memorySize: 1024,
      timeout: Duration.seconds(60),
      environment: {
        ECHO_STORAGE: 'aws',
        ECHO_AI: 'groq',
        KNOWLEDGE_TABLE: table.tableName,
        EVIDENCE_BUCKET: bucket.bucketName,
        GROQ_MODEL_ID: 'openai/gpt-oss-20b',
        NEXTAUTH_SECRET: SecretValue.secretsManager(sessionSecret.valueAsString, { jsonField: 'NEXTAUTH_SECRET' }).unsafeUnwrap(),
        GROQ_API_KEY: SecretValue.secretsManager(aiSecret.valueAsString, { jsonField: 'GROQ_API_KEY' }).unsafeUnwrap(),
      },
      logGroup: new logs.LogGroup(this, 'FunctionLogs', {
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: RemovalPolicy.RETAIN,
      }),
    });
    table.grantReadWriteData(fn);
    bucket.grantReadWrite(fn);
    const api = new apigateway.RestApi(this, 'KnowledgeApi', {
      restApiName: 'Echo',
      deployOptions: {
        stageName: 'prod',
        throttlingBurstLimit: 20,
        throttlingRateLimit: 10,
        metricsEnabled: true,
        loggingLevel: apigateway.MethodLoggingLevel.ERROR,
        dataTraceEnabled: false,
      },
      defaultMethodOptions: { authorizationType: apigateway.AuthorizationType.IAM },
    });
    api.root.addProxy({
      defaultIntegration: new apigateway.LambdaIntegration(fn),
      defaultMethodOptions: { authorizationType: apigateway.AuthorizationType.IAM },
    });
    // Attach this scoped policy to the Amplify SSR compute role; never to the browser.
    const policy = new iam.ManagedPolicy(this, 'FrontendPolicy', {
      statements: [
        new iam.PolicyStatement({ actions: ['execute-api:Invoke'], resources: [api.arnForExecuteApi()] }),
        new iam.PolicyStatement({
          actions: [
            'dynamodb:GetItem',
            'dynamodb:Query',
            'dynamodb:PutItem',
            'dynamodb:UpdateItem',
            'dynamodb:TransactWriteItems',
          ],
          resources: [table.tableArn, `${table.tableArn}/index/*`],
        }),
        new iam.PolicyStatement({
          actions: ['secretsmanager:GetSecretValue'],
          resources: [sessionSecret.valueAsString, aiSecret.valueAsString],
        }),
      ],
    });
    const dashboard = new cloudwatch.Dashboard(this, 'Operations', {
      dashboardName: `Echo-${this.region}`,
      widgets: [
        [
          new cloudwatch.GraphWidget({
            title: 'API requests and latency',
            left: [api.metricCount()],
            right: [api.metricLatency()],
          }),
          new cloudwatch.GraphWidget({
            title: 'Lambda errors and duration',
            left: [fn.metricErrors()],
            right: [fn.metricDuration()],
          }),
        ],
      ],
    });
    new cloudwatch.Alarm(this, 'FunctionErrorAlarm', {
      metric: fn.metricErrors(),
      threshold: 3,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    new cloudwatch.Alarm(this, 'ApiErrorAlarm', {
      metric: api.metricServerError(),
      threshold: 5,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    // Phase 2 opt-in transport only. No source connectors or workers are claimed live.
    if (this.node.tryGetContext('enableIngestionBackbone') === true) {
      new events.EventBus(this, 'SourceEvents', { eventBusName: 'echo-sources' });
      const dlq = new sqs.Queue(this, 'IngestionDeadLetters', {
        enforceSSL: true,
        encryption: sqs.QueueEncryption.SQS_MANAGED,
        retentionPeriod: Duration.days(14),
      });
      new sqs.Queue(this, 'IngestionQueue', {
        enforceSSL: true,
        encryption: sqs.QueueEncryption.SQS_MANAGED,
        visibilityTimeout: Duration.minutes(5),
        deadLetterQueue: { queue: dlq, maxReceiveCount: 3 },
      });
    }
    new CfnOutput(this, 'ApiUrl', { value: api.url });
    new CfnOutput(this, 'KnowledgeTableName', { value: table.tableName });
    new CfnOutput(this, 'EvidenceBucketName', { value: bucket.bucketName });
    new CfnOutput(this, 'CognitoIssuer', { value: pool.userPoolProviderUrl });
    new CfnOutput(this, 'CognitoClientId', { value: client.userPoolClientId });
    new CfnOutput(this, 'CognitoDomain', { value: domain.baseUrl() });
    new CfnOutput(this, 'FrontendPolicyArn', { value: policy.managedPolicyArn });
    new CfnOutput(this, 'DashboardName', { value: dashboard.dashboardName });
  }
}
