import * as cdk from 'aws-cdk-lib';
import { ListenerAction, ApplicationProtocol, ListenerCondition } from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as route53 from 'aws-cdk-lib/aws-route53';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3Notifications from 'aws-cdk-lib/aws-s3-notifications';
import * as lambdaDestinations from 'aws-cdk-lib/aws-lambda-destinations';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as ecsPatterns from 'aws-cdk-lib/aws-ecs-patterns';
import { DockerImageAsset, Platform } from 'aws-cdk-lib/aws-ecr-assets';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as kinesisfirehose from 'aws-cdk-lib/aws-kinesisfirehose';
import { HttpOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import {
  Distribution, ViewerProtocolPolicy, OriginProtocolPolicy, AllowedMethods, CachePolicy,
  OriginRequestPolicy, OriginRequestCookieBehavior, OriginRequestHeaderBehavior, OriginRequestQueryStringBehavior
} from 'aws-cdk-lib/aws-cloudfront';
import { CloudFrontTarget } from 'aws-cdk-lib/aws-route53-targets';
import { UserPool, UserPoolClientIdentityProvider, OAuthScope } from 'aws-cdk-lib/aws-cognito';
import { AuthenticateCognitoAction } from 'aws-cdk-lib/aws-elasticloadbalancingv2-actions';

export class CdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Amazon S3 Bucket 
    const contentBucket = new s3.Bucket(this, 'DocumentsBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      versioned: false,
      encryption: s3.BucketEncryption.S3_MANAGED,
      serverAccessLogsPrefix: 'accesslogs/',
      enforceSSL: true,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_PREFERRED,
      eventBridgeEnabled: true,
    });

    // Amazon Virtual Private Cloud (Amazon VPC)
    const vpc = new ec2.Vpc(this, 'VPC', {
      natGateways: 1,
      gatewayEndpoints: {
        S3: {
          service: ec2.GatewayVpcEndpointAwsService.S3,
        },
      },
    });
    vpc.addFlowLog('FlowLogS3', {
      destination: ec2.FlowLogDestination.toS3(contentBucket, 'flowlogs/')
    });
    vpc.addInterfaceEndpoint('EcrDockerEndpoint', {
      service: ec2.InterfaceVpcEndpointAwsService.ECR_DOCKER,
    });
    vpc.addInterfaceEndpoint('KmsEndpoint', {
      service: ec2.InterfaceVpcEndpointAwsService.KMS,
    });

    const appRole = new iam.Role(this, 'AppRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com')
    });
    
    
    // Amazon Elastic Container Service (Amazon ECS)
    const cluster = new ecs.Cluster(this, 'Cluster', {
      vpc,
      enableFargateCapacityProviders: true,
      containerInsights: true
    });


    // Amazon Data Firehose
    const fhLogGroup = new logs.LogGroup(this, 'FhLogGroup', {
      retention: logs.RetentionDays.ONE_WEEK,
    });
    const fhLogStream = new logs.LogStream(this, 'FhLogStream', {
      logGroup: fhLogGroup,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    const fhLogStreamPrompts = new logs.LogStream(this, 'FhLogStreamPrompts', {
      logGroup: fhLogGroup,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    const fhLogStreamGT = new logs.LogStream(this, 'App1FhLogStreamGT', {
      logGroup: fhLogGroup,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    const fhLogStreamOtelAnalysis = new logs.LogStream(this, 'FhLogStreamOtelAnalysis', {
      logGroup: fhLogGroup,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    const fhRole = new iam.Role(this, 'FhRole', {
      assumedBy: new iam.ServicePrincipal('firehose.amazonaws.com'),
    });
    contentBucket.grantReadWrite(fhRole);
    fhRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'logs:PutLogEvents',
        ],
        resources: ['*']
      })
    );
    const s3DestinationConfigurationProperty: kinesisfirehose.CfnDeliveryStream.S3DestinationConfigurationProperty = {
      bucketArn: contentBucket.bucketArn,
      roleArn: fhRole.roleArn,
      bufferingHints: {
        intervalInSeconds: 60,
        sizeInMBs: 5,
      },
      cloudWatchLoggingOptions: {
        enabled: true,
        logGroupName: fhLogGroup.logGroupName,
        logStreamName: fhLogStream.logStreamName
      },
      compressionFormat: 'GZIP',
      prefix: 'embeddingarchive/app1/',
    };
    const s3DestinationConfigurationPropertyPrompts: kinesisfirehose.CfnDeliveryStream.S3DestinationConfigurationProperty = {
      bucketArn: contentBucket.bucketArn,
      roleArn: fhRole.roleArn,
      bufferingHints: {
        intervalInSeconds: 60,
        sizeInMBs: 5,
      },
      cloudWatchLoggingOptions: {
        enabled: true,
        logGroupName: fhLogGroup.logGroupName,
        logStreamName: fhLogStreamPrompts.logStreamName
      },
      compressionFormat: 'GZIP',
      prefix: 'promptarchive/app1/',
    };
    const s3DestinationConfigurationPropertyGT: kinesisfirehose.CfnDeliveryStream.S3DestinationConfigurationProperty = {
      bucketArn: contentBucket.bucketArn,
      roleArn: fhRole.roleArn,
      bufferingHints: {
        intervalInSeconds: 60,
        sizeInMBs: 5,
      },
      cloudWatchLoggingOptions: {
        enabled: true,
        logGroupName: fhLogGroup.logGroupName,
        logStreamName: fhLogStreamGT.logStreamName
      },
      compressionFormat: 'GZIP',
      prefix: 'gtarchive/app1/',
    };
    const s3DestinationConfigurationPropertyOtelAnalysis: kinesisfirehose.CfnDeliveryStream.S3DestinationConfigurationProperty = {
      bucketArn: contentBucket.bucketArn,
      roleArn: fhRole.roleArn,
      bufferingHints: {
        intervalInSeconds: 60,
        sizeInMBs: 5,
      },
      cloudWatchLoggingOptions: {
        enabled: true,
        logGroupName: fhLogGroup.logGroupName,
        logStreamName: fhLogStreamOtelAnalysis.logStreamName
      },
      compressionFormat: 'UNCOMPRESSED',
      prefix: 'otel-trace-analysis/',
    };
    const fh_embed = new kinesisfirehose.CfnDeliveryStream(this, "Firehose", {
      deliveryStreamType: "DirectPut",
      s3DestinationConfiguration: s3DestinationConfigurationProperty
    });
    const fh_prompts = new kinesisfirehose.CfnDeliveryStream(this, "FirehosePrompts", {
      deliveryStreamType: "DirectPut",
      s3DestinationConfiguration: s3DestinationConfigurationPropertyPrompts
    });
    const fh_gt = new kinesisfirehose.CfnDeliveryStream(this, "FirehoseGTApp1", {
      deliveryStreamType: "DirectPut",
      s3DestinationConfiguration: s3DestinationConfigurationPropertyGT
    });
    const fh_otel_analysis = new kinesisfirehose.CfnDeliveryStream(this, "FirehoseOtelAnalysis", {
      deliveryStreamType: "DirectPut",
      s3DestinationConfiguration: s3DestinationConfigurationPropertyOtelAnalysis
    });

    // Open Telemetry Collection Amazon ECS task
    const adotRole = new iam.Role(this, "adottaskrole", {
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com")
    });
    adotRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonS3FullAccess")
    );
    adotRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName("AWSXRayDaemonWriteAccess")
    );
    adotRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName("CloudWatchLogsFullAccess")
    );
    const adotTaskDefinition = new ecs.FargateTaskDefinition(this, "ADOT", {
      taskRole: adotRole,
      cpu: 512,
      memoryLimitMiB: 2048
    });
    const adotConfig = new ssm.StringParameter(this, "adotconfig", {
      parameterName: 'otel-collector-config',
      stringValue: `
      receivers:
        otlp:
          protocols:
            grpc:
              endpoint: 0.0.0.0:4317
            http:
              endpoint: 0.0.0.0:4318
      
      processors:
        batch:
          
      exporters:
        awsxray: 
          region: ${this.region}
        logging:
          loglevel: debug
        awss3:
          s3uploader:
            region: '${this.region}'
            s3_bucket: '${contentBucket.bucketName}'
            s3_prefix: 'otel-traces'
            s3_partition: 'minute'

      extensions:
        sigv4auth:
          region: ${this.region}

      service:
        extensions: [sigv4auth]  
        pipelines:
          traces:
            receivers: [otlp]
            processors: [batch]    
            exporters: [awsxray, awss3]
    `
    })
    const adotContainer = adotTaskDefinition.addContainer("AdotContainer", {
      image: ecs.ContainerImage.fromRegistry("otel/opentelemetry-collector-contrib:0.95.0"),
      command: ["--config=env:OTEL_CONFIG"],
      secrets: {
        OTEL_CONFIG: ecs.Secret.fromSsmParameter(adotConfig)
      },
      logging: ecs.LogDriver.awsLogs({ streamPrefix: "adot" })
    });
    adotContainer.addPortMappings({
      containerPort: 4318,
      hostPort: 4318,
      protocol: ecs.Protocol.TCP,
      appProtocol: ecs.AppProtocol.http2,
      name: "adot-4318-tcp"
    });
    const adotService = new ecsPatterns.NetworkLoadBalancedFargateService(this, "ADOTService", {
      serviceName: "adsotsvc",
      cluster,
      taskDefinition: adotTaskDefinition,
      publicLoadBalancer: false
    });
    adotService.service.connections.securityGroups[0].addIngressRule(
      ec2.Peer.ipv4(vpc.vpcCidrBlock),
      ec2.Port.allTcp(),
      "Allow inbound from VPC for ADOT"
    );
    adotService.service.autoScaleTaskCount({ maxCapacity: 2 })
      .scaleOnCpuUtilization("AUTOSCALING", {
        targetUtilizationPercent: 70,
        scaleInCooldown: cdk.Duration.seconds(60),
        scaleOutCooldown: cdk.Duration.seconds(60)
      });

    // AWS Lambda for processing of open telemetry traces
    const lambdaTraceAnalyzer = new lambda.Function(this, 'lambdaTraceAnalyzer', {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'lambda_function.lambda_handler',
      code: lambda.Code.fromAsset('lambda/trace-analyzer'),
      timeout: cdk.Duration.seconds(30),
      environment: {
        'FIREHOSE_STREAM_NAME': fh_otel_analysis.ref,
      },
    });
    lambdaTraceAnalyzer.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        's3:*',
        'bedrock:*',
        'cloudformation:*',
        'firehose:*',
      ],
      resources: ['*']
    }))
    const lambdaTraceExtraction = new lambda.Function(this, 'lambdaTraceExtractor', {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'lambda_function.lambda_handler',
      code: lambda.Code.fromAsset('lambda/trace-extractor'),
      timeout: cdk.Duration.seconds(30),
      onSuccess: new lambdaDestinations.LambdaDestination(lambdaTraceAnalyzer, {
        responseOnly: true,
      }),
    });
    lambdaTraceExtraction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        's3:*',
        'lambda:InvokeFunction',
      ],
      resources: ['*']
    }));
    contentBucket.addObjectCreatedNotification(
      new s3Notifications.LambdaDestination(lambdaTraceExtraction),
      {prefix: 'otel-traces'}
    );

    // Amazon ECS Front-end Streamlit Application task
    const appImage = new DockerImageAsset(this, 'AppImage', {
      directory: 'container/front-end-app',
      platform: Platform.LINUX_AMD64
    });
    const appTaskDefinition = new ecs.FargateTaskDefinition(this, 'AppTaskDef', {
      cpu: 512,
      memoryLimitMiB: 2048,
      taskRole: appRole
    });
    const appContainer = appTaskDefinition.addContainer('StreamlitContainer', {
      image: ecs.ContainerImage.fromDockerImageAsset(appImage),
      cpu: 512,
      memoryLimitMiB: 2048,
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'streamlit-log-group', logRetention: 30 }),
      environment: {
        'TRACELOOP_BASE_URL': `http://${adotService.loadBalancer.loadBalancerDnsName}:80`
      }
    });
    appRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'bedrock:*',
        'comprehend:*'
      ],
      resources: ['*']
    }))
    appRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonS3FullAccess")
    );
    appContainer.addPortMappings({ containerPort: 8501, protocol: ecs.Protocol.TCP });
    
    // Amazon Route 53
    const appCustomDomainName = this.node.tryGetContext('appCustomDomainName');
    const loadBalancerOriginCustomDomainName = this.node.tryGetContext('loadBalancerOriginCustomDomainName');
    const customDomainRoute53HostedZoneID = this.node.tryGetContext('customDomainRoute53HostedZoneID');
    const customDomainRoute53HostedZoneName = this.node.tryGetContext('customDomainRoute53HostedZoneName');
    const customDomainCertificateArn = this.node.tryGetContext('customDomainCertificateArn');
    const hosted_zone = route53.HostedZone.fromHostedZoneAttributes(this, 'HostedZone', {
      hostedZoneId: customDomainRoute53HostedZoneID,
      zoneName: customDomainRoute53HostedZoneName
    });
    const certificate = acm.Certificate.fromCertificateArn(this, 'ACMCertificate', `${customDomainCertificateArn}`);
    
    // Front-end service and distribution 
    const feService = new ecsPatterns.ApplicationLoadBalancedFargateService(this, 'FeService', {
      cluster: cluster,
      taskDefinition: appTaskDefinition,
      protocol: ApplicationProtocol.HTTPS,
      certificate: certificate,
      domainName: loadBalancerOriginCustomDomainName,
      domainZone: hosted_zone
    });
    feService.loadBalancer.logAccessLogs(contentBucket, 'alblog')
    const alb_sg2 = feService.loadBalancer.connections.securityGroups[0];
    alb_sg2.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'Allow HTTPS');
    const customHeaderValue2 = '8p008a1738'
    const origin2 = new HttpOrigin(`${loadBalancerOriginCustomDomainName}`, {
      protocolPolicy: OriginProtocolPolicy.HTTPS_ONLY,
      customHeaders: {
        "X-Custom-Header": customHeaderValue2
      }
    });
    // Origin request policy
    const originRequestPolicy = new OriginRequestPolicy(this, 'OriginRequestPolicy', {
      originRequestPolicyName: 'ALBPolicy2',
      cookieBehavior: OriginRequestCookieBehavior.all(),
      headerBehavior: OriginRequestHeaderBehavior.all(),
      queryStringBehavior: OriginRequestQueryStringBehavior.all(),
    });
    const distribution = new Distribution(this, 'Distribution', {
      certificate: certificate,
      domainNames: [appCustomDomainName],
      defaultBehavior: {
        origin: origin2,
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        originRequestPolicy: originRequestPolicy,
        allowedMethods: AllowedMethods.ALLOW_ALL,
        cachePolicy: CachePolicy.CACHING_DISABLED,
      }
    });

    const cloudFrontDNS = new route53.ARecord(this, 'CloudFrontARecord', {
      zone: hosted_zone,
      target: route53.RecordTarget.fromAlias(new CloudFrontTarget(distribution)),
      recordName: appCustomDomainName
    });



    // Amazon Cognito
    const userPool = new UserPool(this, 'UserPool', {
      selfSignUpEnabled: true,
      signInAliases: { email: true },
    });
    const userPoolClient = userPool.addClient('UserPoolClient', {
      userPoolClientName: "alb-auth-client",
      generateSecret: true,
      oAuth: {
        flows: {
          authorizationCodeGrant: true,
        },
        scopes: [OAuthScope.OPENID],
        callbackUrls: [`https://${distribution.distributionDomainName}/oauth2/idpresponse`,
        `https://${distribution.distributionDomainName}`,
        `https://${appCustomDomainName}/oauth2/idpresponse`,
        `https://${appCustomDomainName}`
        ],
        logoutUrls: [`https://${distribution.distributionDomainName}`,
        `https://${appCustomDomainName}`,
        ]
      },
      supportedIdentityProviders: [
        UserPoolClientIdentityProvider.COGNITO
      ]
    });

    const domain_prefix = this.node.tryGetContext('domainPrefix');
    const userPoolDomain = userPool.addDomain('UserPoolDomain', {
      cognitoDomain: {
        domainPrefix: domain_prefix
      }
    });
    
    feService.listener.addAction(
      'cognito-auth', {
      priority: 1,
      conditions: [ListenerCondition.httpHeader("X-Custom-Header", [customHeaderValue2])],
      action: new AuthenticateCognitoAction({
        userPool,
        userPoolClient,
        userPoolDomain,
        next: ListenerAction.forward([feService.targetGroup])
      })
    }
    );
    feService.listener.addAction(
      'Default', {
      action: ListenerAction.fixedResponse(403, {
        contentType: 'text/plain',
        messageBody: 'Forbidden'
      })
    }
    );

    
    // CDK outputs
    new cdk.CfnOutput(this, 'CloudFrontDomain', {
      value: `https://${distribution.distributionDomainName}`
    });
    new cdk.CfnOutput(this, 'AppURL2', {
      value: `https://${appCustomDomainName}`
    });
    new cdk.CfnOutput(this, 'BucketName', {
      value: contentBucket.bucketName
    });
    new cdk.CfnOutput(this, 'BucketIngestPath', {
      value: `${contentBucket.bucketName}/ingest`
    });
  }
}
